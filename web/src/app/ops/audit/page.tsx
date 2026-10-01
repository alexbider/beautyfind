import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireArea } from '@/components/ops/guard';
import { ACTOR_KIND_NAMES, type ActorKind } from '@/components/ops/activity';
import { Btn, Card, Chip, Empty, PageHead, Pills, dateIL, timeIL, ui } from '@/components/ops/ui';
import { recentActivity } from '@/lib/server/opsStats';

export const metadata: Metadata = { title: 'יומן פעולות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const KINDS: ActorKind[] = ['person', 'ai', 'system'];
const TONE: Record<ActorKind, 'navy' | 'info' | 'neutral'> = { person: 'navy', ai: 'info', system: 'neutral' };

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('audit', 'view', '/ops/audit');
  const f = one((await searchParams).filter);
  const filter = (KINDS as string[]).includes(f) ? (f as ActorKind) : undefined;
  const rows = await recentActivity(150, filter);
  let lastDay = '';
  return (
    <AdminShell user={user}>
      <PageHead eyebrow="מערכת" title="יומן פעולות" lead="כל פעולה של אדם, AI או מערכת, מיומן הביקורת ומרשומות ההחלטות. לא ניתן לעריכה או למחיקה." actions={<Btn href={`/ops/audit/export${filter ? `?filter=${filter}` : ''}`} small>ייצוא CSV</Btn>} />
      <div className={ui.toolbar}>
        <Pills current={filter ?? 'all'} items={[{ key: 'all', name: 'הכול', href: '/ops/audit' }, ...KINDS.map(k => ({ key: k, name: k === 'person' ? 'אנשים' : ACTOR_KIND_NAMES[k], href: `/ops/audit?filter=${k}` }))]} />
      </div>
      <Card title="פעולות אחרונות" sub={`${rows.length} רשומות אחרונות`} flush>
        {rows.length ? (
          <ul className={ui.list}>
            {rows.map((r, i) => {
              const day = dateIL(r.at);
              const head = day !== lastDay;
              lastDay = day;
              return (
                <li key={i} className={ui.listItem} style={head ? { borderTop: '2px solid #E6E6E6' } : undefined}>
                  <span className={ui.time} title={day}>{head ? day : ''}<br />{timeIL(r.at)}</span>
                  <Chip tone={TONE[r.kind]}>{ACTOR_KIND_NAMES[r.kind]}</Chip>
                  <div className={ui.listText}>
                    <div className={ui.listTitle}>{r.who} · {r.text}</div>
                    <div className={ui.listSub}>{r.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <Empty title="אין רשומות" text="הפעולות הראשונות יופיעו כאן ברגע שמישהו יעשה משהו." />}
      </Card>
    </AdminShell>
  );
}
