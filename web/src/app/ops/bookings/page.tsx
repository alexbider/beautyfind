import type { Metadata } from 'next';
import type { BookingStatus, Prisma } from '@prisma/client';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireArea } from '@/components/ops/guard';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, dayMonthIL, int, nisAgorot, pct, timeIL, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { bookingStats } from '@/lib/server/opsStats';

export const metadata: Metadata = { title: 'הזמנות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const FILTERS: Array<{ key: string; name: string; where: Prisma.BookingWhereInput }> = [
  { key: 'all', name: 'הכל', where: { status: { notIn: ['pending_payment', 'abandoned'] } } },
  { key: 'confirmed', name: 'מאושר', where: { status: { in: ['confirmed', 'checked_in', 'in_treatment'] } } },
  { key: 'consult', name: 'ייעוץ רפואי', where: { kind: 'consult', status: { notIn: ['pending_payment', 'abandoned'] } } },
  { key: 'completed', name: 'הושלם', where: { status: 'completed' } },
  { key: 'no_show', name: 'לא הגיעה', where: { status: 'no_show' } },
  { key: 'cancelled', name: 'בוטל', where: { status: { in: ['cancelled_client', 'cancelled_clinic'] } } },
];

const STATUS: Record<BookingStatus, { name: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  pending_payment: { name: 'ממתין לתשלום', tone: 'neutral' }, abandoned: { name: 'ננטש', tone: 'neutral' }, confirmed: { name: 'מאושר', tone: 'ok' }, checked_in: { name: 'בצ׳ק־אין', tone: 'info' },
  in_treatment: { name: 'בטיפול', tone: 'info' }, completed: { name: 'הושלם', tone: 'ok' }, cancelled_client: { name: 'בוטל', tone: 'neutral' }, cancelled_clinic: { name: 'בוטל ע״י הקליניקה', tone: 'warn' }, no_show: { name: 'לא הגיעה', tone: 'bad' },
};
const SOURCE: Record<string, string> = { online: 'אתר', phone: 'טלפון', walkin: 'הגעה', waitlist: 'רשימת המתנה', consult: 'ייעוץ' };

export default async function BookingsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('bookings', 'view', '/ops/bookings');
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 60);
  const filter = FILTERS.find(f => f.key === one(sp.filter)) ?? FILTERS[0];
  const where: Prisma.BookingWhereInput = {
    ...filter.where,
    ...(q ? { OR: [{ ref: { contains: q.toUpperCase() } }, { clientName: { contains: q, mode: 'insensitive' } }, { branch: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
  };
  const [stats, total, rows, deposits] = await Promise.all([
    bookingStats(),
    db.booking.count({ where }),
    db.booking.findMany({ where, orderBy: { startsAt: 'desc' }, take: 100, select: { id: true, ref: true, clientName: true, kind: true, startsAt: true, depositAgorot: true, source: true, status: true, treatment: { select: { name: true } }, branch: { select: { name: true, businessId: true } } } }),
    db.booking.count({ where: { depositAgorot: { gt: 0 }, status: { notIn: ['pending_payment', 'abandoned'] }, startsAt: { gte: new Date(Date.now() - 90 * 86_400_000) } } }).then(async n => ({ n, of: await db.booking.count({ where: { status: { notIn: ['pending_payment', 'abandoned'] }, startsAt: { gte: new Date(Date.now() - 90 * 86_400_000) } } }) })),
  ]);
  const href = (key: string) => `/ops/bookings?filter=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="תפעול" title="הזמנות" lead="כל התורים בפלטפורמה. כספי מקדמות עוברים ישירות לקליניקה; BeautyFind אינה מחזיקה אותם." />
      <Kpis
        items={[
          { label: 'הזמנות · החודש', value: int(stats.thisMonth), note: stats.deltaPct == null ? `${int(stats.lastMonth)} בחודש שעבר` : `${stats.deltaPct >= 0 ? '+' : ''}${pct(stats.deltaPct)}`, tone: stats.deltaPct == null ? undefined : stats.deltaPct >= 0 ? 'ok' : 'bad' },
          { label: 'שיעור ביטול', value: pct(stats.cancelRate), note: 'מתוך התורים ב־60 הימים האחרונים' },
          { label: 'לא הגיעו', value: pct(stats.noShowRate), note: deposits.of ? `מקדמה נגבתה ב־${pct((deposits.n / deposits.of) * 100, 0)}` : 'אין תורים ב־90 יום' },
          { label: 'ייעוצים רפואיים · החודש', value: int(stats.consults), note: 'הועברו לרופא/ה' },
        ]}
      />
      <div className={ui.toolbar}>
        <form method="get" action="/ops/bookings" className={ui.toolbarGrow} role="search">
          <input type="hidden" name="filter" value={filter.key} />
          <input name="q" defaultValue={q} className={ui.input} placeholder="מספר תור, שם לקוחה או עסק" aria-label="חיפוש הזמנות" />
        </form>
        <Pills current={filter.key} items={FILTERS.map(f => ({ key: f.key, name: f.name, href: href(f.key) }))} />
      </div>
      <Card flush>
        {rows.length ? (
          <Table head={['תור', 'לקוחה', 'עסק', 'טיפול', 'מועד', 'מקדמה', 'ערוץ', 'מצב']} foot={`${int(total)} תורים${total > rows.length ? ` · מוצגים ${int(rows.length)} האחרונים` : ''}`}>
            {rows.map(b => (
              <tr key={b.id}>
                <td className={`${ui.mono} ${ui.strong}`}>{b.ref}</td>
                <td>{b.clientName}</td>
                <td><Link href={`/ops/businesses/${b.branch.businessId}`} className={ui.rowLink}>{b.branch.name}</Link></td>
                <td>{b.kind === 'consult' ? `ייעוץ${b.treatment ? ` · ${b.treatment.name}` : ''}` : b.treatment?.name ?? '—'}</td>
                <td className={ui.num}>{dayMonthIL(b.startsAt)} · {timeIL(b.startsAt)}</td>
                <td className={ui.num}>{b.depositAgorot ? nisAgorot(b.depositAgorot) : '—'}</td>
                <td>{SOURCE[b.source] ?? b.source}</td>
                <td><Chip tone={STATUS[b.status].tone}>{STATUS[b.status].name}</Chip></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="אין תורים בסינון הזה" />}
      </Card>
    </AdminShell>
  );
}
