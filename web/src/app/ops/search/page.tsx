import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { AREA_HREF, AREA_NAMES, AREAS } from '@/components/ops/roles';
import { Card, Chip, Empty, PageHead, Table, dateTimeIL, nisAgorot, ui } from '@/components/ops/ui';
import { fromE164, toE164 } from '@/lib/format';
import { db } from '@/lib/server/db';

export const metadata: Metadata = { title: 'חיפוש · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// The top bar's search: businesses (name, legal name, company number), client accounts (name, phone,
// email), bookings and documents by their number, and the admin's own screens by name. Only areas
// the signed-in role can open are searched.

export default async function OpsSearchPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('overview', 'view', '/ops/search');
  const q = one((await searchParams).q).trim().slice(0, 80);
  const digits = q.replace(/\D/g, '');
  const e164 = toE164(q);
  const levels = Object.fromEntries(await Promise.all(AREAS.map(async a => [a, await areaLevel(user, a)] as const)));
  const can = (a: keyof typeof levels) => levels[a] !== 'none';

  const screens = q ? AREAS.filter(a => can(a) && AREA_NAMES[a].includes(q)) : [];
  const [businesses, clients, bookings, documents] = q.length < 2 ? [[], [], [], []] : await Promise.all([
    can('businesses')
      ? db.business.findMany({
          where: { OR: [{ legalName: { contains: q, mode: 'insensitive' } }, { branches: { some: { name: { contains: q, mode: 'insensitive' } } } }, ...(digits.length >= 5 ? [{ companyNo: { contains: digits } }] : [])] },
          select: { id: true, legalName: true, companyNo: true, status: true, branches: { select: { name: true, cityName: true }, take: 3 } }, take: 12,
        })
      : [],
    can('clients')
      ? db.user.findMany({
          where: { kind: 'client', OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, ...(e164 ? [{ phone: e164 }] : digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] },
          select: { id: true, fullName: true, phone: true, email: true, blockedAt: true }, take: 12,
        })
      : [],
    can('bookings')
      ? db.booking.findMany({ where: { OR: [{ ref: { contains: q.toUpperCase() } }, { clientName: { contains: q, mode: 'insensitive' } }, ...(e164 ? [{ clientPhone: e164 }] : [])] }, select: { id: true, ref: true, clientName: true, startsAt: true, status: true, branch: { select: { name: true } } }, take: 12, orderBy: { startsAt: 'desc' } })
      : [],
    can('accounting')
      ? db.document.findMany({ where: { issuer: 'platform', number: { contains: q } }, select: { id: true, number: true, type: true, grossAgorot: true, issuedAt: true }, take: 12, orderBy: { issuedAt: 'desc' } })
      : [],
  ]);
  const total = screens.length + businesses.length + clients.length + bookings.length + documents.length;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="ראשי" title={q ? `חיפוש: ${q}` : 'חיפוש'} lead={q ? `${total.toLocaleString('he-IL')} תוצאות בעסקים, לקוחות, הזמנות, מסמכים ומסכים.` : 'הקלידו שם עסק, ע.מ., טלפון, מספר תור או מסמך בשורת החיפוש למעלה.'} />
      {!q ? null : total === 0 ? (
        <Card><Empty title="לא נמצא דבר" text="נסו חלק מהשם, מספר הטלפון בלי מקפים או את מספר המסמך המלא." /></Card>
      ) : (
        <div className={ui.stack}>
          {screens.length ? (
            <Card title="מסכים">
              <div className={ui.pills}>{screens.map(a => <Link key={a} href={AREA_HREF[a]} className={ui.pill}>{AREA_NAMES[a]}</Link>)}</div>
            </Card>
          ) : null}
          {businesses.length ? (
            <Card title="עסקים" flush>
              <Table head={['עסק', 'סניפים', 'ע.מ.', 'מצב']}>
                {businesses.map(b => (
                  <tr key={b.id}>
                    <td><Link href={`/ops/businesses/${b.id}`} className={ui.rowLink}>{b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם'}</Link>{b.legalName ? <span className={ui.sub}>{b.legalName}</span> : null}</td>
                    <td>{b.branches.map(x => `${x.name} · ${x.cityName}`).join(', ')}</td>
                    <td className={ui.mono} dir="ltr">{b.companyNo ?? '—'}</td>
                    <td><Chip tone={b.status === 'live' ? 'ok' : b.status === 'pending' ? 'warn' : 'bad'}>{b.status}</Chip></td>
                  </tr>
                ))}
              </Table>
            </Card>
          ) : null}
          {clients.length ? (
            <Card title="לקוחות" flush>
              <Table head={['לקוחה', 'טלפון', 'אימייל', 'מצב']}>
                {clients.map(c => (
                  <tr key={c.id}>
                    <td><Link href={`/ops/clients?q=${encodeURIComponent(c.phone ?? c.email ?? '')}`} className={ui.rowLink}>{c.fullName ?? 'ללא שם'}</Link></td>
                    <td dir="ltr">{c.phone ? fromE164(c.phone) : '—'}</td>
                    <td dir="ltr">{c.email ?? '—'}</td>
                    <td><Chip tone={c.blockedAt ? 'bad' : 'ok'}>{c.blockedAt ? 'חסומה' : 'פעילה'}</Chip></td>
                  </tr>
                ))}
              </Table>
            </Card>
          ) : null}
          {bookings.length ? (
            <Card title="הזמנות" flush>
              <Table head={['תור', 'לקוחה', 'עסק', 'מועד', 'מצב']}>
                {bookings.map(b => (
                  <tr key={b.id}>
                    <td className={ui.mono}><Link href={`/ops/bookings?q=${encodeURIComponent(b.ref)}`} className={ui.rowLink}>{b.ref}</Link></td>
                    <td>{b.clientName}</td>
                    <td>{b.branch.name}</td>
                    <td className={ui.num}>{dateTimeIL(b.startsAt)}</td>
                    <td><Chip>{b.status}</Chip></td>
                  </tr>
                ))}
              </Table>
            </Card>
          ) : null}
          {documents.length ? (
            <Card title="מסמכים" flush>
              <Table head={['מסמך', 'סוג', 'סה״כ', 'תאריך']}>
                {documents.map(d => (
                  <tr key={d.id}>
                    <td className={ui.mono}><Link href={`/ops/accounting?tab=ledger&q=${encodeURIComponent(d.number)}`} className={ui.rowLink}>{d.number}</Link></td>
                    <td>{d.type}</td>
                    <td className={ui.num}>{nisAgorot(d.grossAgorot)}</td>
                    <td className={ui.num}>{dateTimeIL(d.issuedAt)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          ) : null}
        </div>
      )}
    </AdminShell>
  );
}
