import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, Tabs, dateIL, dueIL, int, pct, ui } from '@/components/ops/ui';
import { fromE164 } from '@/lib/format';
import { BlockButton, PrivacyButtons } from './ClientActions';
import { CLIENT_FILTERS, clientStats, listClients, PRIVACY_DAYS, privacyRequests, type ClientFilter } from './data';

export const metadata: Metadata = { title: 'לקוחות ופרטיות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const KIND_NAME = { delete: 'מחיקת חשבון', access: 'עיון וייצוא מידע', correction: 'תיקון מידע' } as const;

const mask = (phone: string | null) => {
  if (!phone) return null;
  const local = fromE164(phone);
  return local.length > 7 ? `${local.slice(0, 3)}-•••-${local.slice(-4)}` : local;
};

export default async function ClientsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('clients', 'view', '/ops/clients');
  const sp = await searchParams;
  const tab = one(sp.tab) === 'privacy' ? 'privacy' : 'accounts';
  const q = one(sp.q).slice(0, 80);
  const filter = (CLIENT_FILTERS.some(f => f.key === one(sp.filter)) ? one(sp.filter) : 'all') as ClientFilter;
  const [level, stats, list, privacy] = await Promise.all([areaLevel(user, 'clients'), clientStats(), listClients({ filter, q }), privacyRequests()]);
  const canEdit = atLeast(level, 'edit');
  const open = privacy.filter(p => !p.done);
  const nearest = open[0];

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="תפעול" title="לקוחות ופרטיות" lead="חשבונות לקוחה, הסכמות דיוור ובקשות לפי חוק הגנת הפרטיות." />
      <Kpis
        items={[
          { label: 'חשבונות לקוחה', value: int(stats.total), note: stats.newThisMonth ? `+${int(stats.newThisMonth)} החודש` : 'ללא חדשים החודש', tone: stats.newThisMonth ? 'ok' : undefined },
          { label: 'הסכמה לדיוור', value: pct(stats.consentPct, 0), note: 'ערוץ אחד לפחות' },
          { label: 'בקשות פרטיות פתוחות', value: int(open.length), note: nearest ? `הקרובה ${dueIL(nearest.dueAt)}` : `מענה תוך ${PRIVACY_DAYS} יום`, tone: open.length ? 'warn' : undefined },
          { label: 'חשבונות חסומים', value: int(stats.blocked), note: 'הונאה או הטרדה', tone: stats.blocked ? 'bad' : undefined },
        ]}
      />
      <Tabs label="לקוחות" current={tab} items={[{ key: 'accounts', name: 'חשבונות', href: '/ops/clients' }, { key: 'privacy', name: `בקשות פרטיות${open.length ? ` · ${int(open.length)}` : ''}`, href: '/ops/clients?tab=privacy' }]} />

      {tab === 'accounts' ? (
        <>
          <div className={ui.toolbar}>
            <form method="get" action="/ops/clients" className={ui.toolbarGrow} role="search">
              <input type="hidden" name="filter" value={filter} />
              <input name="q" defaultValue={q} className={ui.input} placeholder="שם, טלפון או אימייל" aria-label="חיפוש לקוחות" />
            </form>
            <Pills current={filter} items={CLIENT_FILTERS.map(f => ({ key: f.key, name: f.name, href: `/ops/clients?filter=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ''}` }))} />
          </div>
          <Card flush>
            {list.rows.length ? (
              <Table head={['לקוחה', 'עיר', 'תורים', 'ביקור אחרון', 'דיוור', 'מצב', '']} foot={`${int(list.total)} חשבונות${list.total > list.rows.length ? ` · מוצגים ${int(list.rows.length)}` : ''} · טלפונים מוסתרים חלקית; הפרטים המלאים בחשבון הלקוחה בלבד`}>
                {list.rows.map(c => (
                  <tr key={c.id}>
                    <td className={ui.strong}>{c.name}<span className={ui.sub} dir="ltr">{mask(c.phone) ?? c.email ?? '—'}</span></td>
                    <td>{c.city ?? '—'}</td>
                    <td className={ui.num}>{int(c.bookings)}</td>
                    <td className={ui.num}>{dateIL(c.lastVisit)}</td>
                    <td>{c.consent ? 'מסכימה' : 'לא'}</td>
                    <td><Chip tone={c.blockedAt ? 'bad' : 'ok'}>{c.blockedAt ? 'חסומה' : 'פעילה'}</Chip>{c.blockedReason ? <span className={ui.sub}>{c.blockedReason}</span> : null}</td>
                    <td><BlockButton id={c.id} blocked={!!c.blockedAt} canEdit={canEdit} /></td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="אין חשבונות בסינון הזה" />}
          </Card>
        </>
      ) : (
        <Card title="בקשות לפי חוק הגנת הפרטיות" sub={`מענה תוך ${PRIVACY_DAYS} יום. הצהרות בריאות ותיעוד קליני שייכים לקליניקה; מחיקה מתואמת מולה.`} flush>
          {privacy.length ? (
            <ul className={ui.list}>
              {privacy.map(p => (
                <li key={p.id} className={ui.listItem}>
                  <span className={ui.dot} data-tone={p.done ? 'ok' : p.dueAt.getTime() - Date.now() < 7 * 86_400_000 ? 'bad' : undefined} aria-hidden="true" />
                  <div className={ui.listText}>
                    <div className={ui.listTitle}>{KIND_NAME[p.kind]} · {p.who}</div>
                    <div className={ui.listSub}>{p.ref} · התקבלה {dateIL(p.receivedAt)} · {p.done ? `בוצעה ${dateIL(p.doneAt)}` : dueIL(p.dueAt)}{p.contact ? <> · <span dir="ltr">{p.contact}</span></> : ''}</div>
                    {p.text ? <div className={ui.note} style={{ marginTop: 4 }}>{p.text}</div> : null}
                  </div>
                  {p.done ? <Chip tone="ok">טופל</Chip> : <PrivacyButtons id={p.id} kind={p.kind} canEdit={canEdit} />}
                </li>
              ))}
            </ul>
          ) : <Empty title="אין בקשות פרטיות" text="בקשות מחיקה מגיעות מחשבון הלקוחה; עיון ותיקון מגיעים מטופס יצירת הקשר." />}
        </Card>
      )}
    </AdminShell>
  );
}
