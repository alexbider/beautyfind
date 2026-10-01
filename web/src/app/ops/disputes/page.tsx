import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, PageHead, Pills, nisAgorot, relIL, ui } from '@/components/ops/ui';
import { DecideButtons, OpenDisputeForm } from './DisputeForms';
import { KIND_NAME, listDisputes, STATUS_NAME, STATUS_TONE } from './data';

export const metadata: Metadata = { title: 'מחלוקות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function DisputesPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('disputes', 'view', '/ops/disputes');
  const filter = one((await searchParams).filter) === 'all' ? 'all' : 'open';
  const [level, rows] = await Promise.all([areaLevel(user, 'disputes'), listDisputes(filter)]);
  const canEdit = atLeast(level, 'edit');
  const policy = (d: (typeof rows)[number]) => ((d.policyShown ?? {}) as { line?: string }).line ?? '—';

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="תפעול" title="מחלוקות" lead="הקליניקה מחליטה על ההחזר. אנחנו בודקים שהמדיניות שהוצגה נאכפה כפי שנכתבה, ומתעדים." />
      <div className={ui.split}>
        <div className={ui.stack}>
          <Pills current={filter} items={[{ key: 'open', name: 'פתוחות', href: '/ops/disputes' }, { key: 'all', name: 'הכול', href: '/ops/disputes?filter=all' }]} />
          {rows.length ? rows.map(d => (
            <Card
              key={d.id}
              title={`${d.kind === 'deposit' ? 'מקדמה' : 'שובר'} · ${d.claim.length > 60 ? `${d.claim.slice(0, 60)}…` : d.claim}`}
              sub={<>{d.ref} · {d.clientName} מול <Link href={`/ops/businesses/${d.businessId}`} className={ui.rowLink}>{d.businessName}</Link> · {nisAgorot(d.amountAgorot)} · נפתח {relIL(d.createdAt)}</>}
              aside={<Chip tone={STATUS_TONE[d.status]}>{STATUS_NAME[d.status]}</Chip>}
            >
              <div className={ui.grid2}>
                <div>
                  <div className={ui.label}>טענת הלקוחה</div>
                  <p className={ui.note} style={{ margin: 0 }}>{d.claim}</p>
                </div>
                <div>
                  <div className={ui.label}>מה המערכת מראה</div>
                  <ul className={ui.list}>
                    {d.facts.map((f, i) => <li key={i} className={ui.note}><b>{f.label}:</b> {f.text}</li>)}
                  </ul>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className={ui.label}>מדיניות שהוצגה</div>
                <Chip tone="info">{policy(d)}</Chip>
              </div>
              {d.recommendation ? <p className={ui.ok} style={{ marginTop: 10 }}>{d.recommendation}{d.decidedBy ? ` · ${d.decidedBy}` : ''}</p> : null}
              {canEdit ? <div style={{ marginTop: 12 }}><DecideButtons id={d.id} status={d.status} /></div> : null}
            </Card>
          )) : (
            <Card><Empty title={filter === 'open' ? 'אין מחלוקות פתוחות' : 'עוד לא נפתחו מחלוקות'} text="מחלוקת נפתחת כאן מפנייה של לקוחה על מקדמה שלא הוחזרה או שובר שנדחה." /></Card>
          )}
        </div>
        <Card title="פתיחת מחלוקת" sub={KIND_NAME.deposit + ' או ' + KIND_NAME.gift_card}>
          {canEdit ? <OpenDisputeForm /> : <p className={ui.note}>לתפקיד שלך יש צפייה בלבד במחלוקות.</p>}
        </Card>
      </div>
    </AdminShell>
  );
}
