import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import type { User } from '@prisma/client';
import { AREA_NAMES, LEVEL_NAMES, atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, Tabs, dateTimeIL, int, relIL, ui } from '@/components/ops/ui';
import { AI_ACTION_NAMES } from '@/lib/server/aiActions';
import { ASSISTANT_MODEL, assistantConfigured } from '@/lib/server/assistant';
import { mcpOverview } from '@/lib/server/mcp';
import { ApprovalButtons } from './ApprovalButtons';
import { AssistantChat } from './AssistantChat';
import { RevokeButton, TokenCreator } from './McpPanel';
import styles from './ai.module.css';
import { AI_TABS, approvals, providers, usage, type AiTab, type QueueFilter } from './data';

export const metadata: Metadata = { title: 'AI ו־MCP · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // the assistant's tool loop can take a while on a long question

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const STATUS_NAME: Record<string, string> = { proposed: 'ממתין', approved: 'אושר', rejected: 'נדחה', executed: 'בוצע', failed: 'נכשל' };
const STATUS_TONE: Record<string, 'warn' | 'ok' | 'bad' | 'neutral'> = { proposed: 'warn', approved: 'ok', rejected: 'neutral', executed: 'ok', failed: 'bad' };
const SOURCE_NAME: Record<string, string> = { assistant: 'העוזר', 'mcp:claude': 'Claude · MCP', 'mcp:chatgpt': 'ChatGPT · MCP' };

export default async function AiPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('ai', 'view', '/ops/ai');
  const sp = await searchParams;
  const tab = (AI_TABS.some(t => t.key === one(sp.tab)) ? one(sp.tab) : 'assistant') as AiTab;
  const qf = (['proposed', 'decided', 'all'].includes(one(sp.filter)) ? one(sp.filter) : 'proposed') as QueueFilter;
  const level = await areaLevel(user, 'ai');
  const canEdit = atLeast(level, 'edit');
  const firstName = (user.fullName ?? user.email ?? 'צוות').split(/[\s@]/)[0];

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="AI ונתונים" title="AI ו־MCP" lead="ספקי מודלים, שרת MCP לניהול מתוך Claude, ותור אישורים לכל פעולת כתיבה." />
      <Tabs label="AI ו־MCP" current={tab} items={AI_TABS.map(t => ({ key: t.key, name: t.name, href: `/ops/ai?tab=${t.key}` }))} />

      {tab === 'assistant' ? (
        <div className={ui.split}>
          <Card title="עוזר התפעול" sub={assistantConfigured() ? `Claude · קריאה בלבד · כל שאלה נרשמת ביומן` : 'לא מוגדר'} flush>
            <AssistantChat configured={assistantConfigured()} firstName={firstName} model={ASSISTANT_MODEL} />
          </Card>
          <Card title="מה העוזר רואה">
            <div className={styles.sees}>
              {[
                ['עסקים וחיובים', 'קריאה', 'ok'], ['ספר הכנסות ומע״מ', 'קריאה', 'ok'], ['מחלוקות וממומנים', 'קריאה', 'ok'],
                ['תור אישורים', 'הצעה בלבד', 'warn'], ['פרטי בריאות של לקוחות', 'חסום', 'bad'],
              ].map(([k, v, t]) => (
                <div key={k} className={styles.seeRow}><span>{k}</span><Chip tone={t as 'ok' | 'warn' | 'bad'}>{v}</Chip></div>
              ))}
            </div>
            <p className={ui.hint} style={{ marginTop: 12 }}>העוזר לא מבצע פעולות. כשהוא ממליץ על הסתרה, החזרה לאוויר או הערה, הבקשה נכנסת לתור האישורים ומחכה לאדם. חיוב, זיכוי והודעות ללקוחות אינם זמינים לו כלל.</p>
            <p className={ui.hint} style={{ marginTop: 8 }}>מודל: <span dir="ltr">{ASSISTANT_MODEL}</span>. הבקשות נשלחות עם גיבוי צד־שרת של Anthropic, כך שעומס על המודל הראשי מופנה אוטומטית למודל חלופי.</p>
          </Card>
        </div>
      ) : null}

      {tab === 'providers' ? <ProvidersTab /> : null}
      {tab === 'mcp' ? <McpTab user={user} /> : null}
      {tab === 'queue' ? <QueueTab filter={qf} canEdit={canEdit} /> : null}
      {tab === 'usage' ? <UsageTab /> : null}
    </AdminShell>
  );
}

async function ProvidersTab() {
  const rows = await providers();
  const at = rows[0]?.workerAt;
  return (
    <Card title="ספקי AI ונתונים" sub={at ? `דיווח העובד האחרון ${relIL(at)}` : 'העובד עוד לא דיווח'} flush>
      <Table head={['ספק', 'תפקיד', 'מפתח באתר', 'מפתח אצל העובד', 'מודל']}>
        {rows.map(r => (
          <tr key={r.key}>
            <td className={ui.strong}>{r.name}</td>
            <td>{r.role}</td>
            <td>{r.web === 'n/a' ? <span className={ui.note}>לא נדרש</span> : r.web === 'set' ? <Chip tone="ok">מוגדר</Chip> : <Chip tone="bad">חסר</Chip>}</td>
            <td>{r.worker === null ? <Chip tone="neutral">אין דיווח</Chip> : r.worker ? <Chip tone="ok">מוגדר</Chip> : <Chip tone="bad">חסר</Chip>}</td>
            <td className={ui.mono} dir="ltr">{r.model ?? '—'}</td>
          </tr>
        ))}
      </Table>
      <p className={`${ui.hint} ${ui.cardPad}`}>המפתחות עצמם נשמרים רק כסודות (Vercel לאתר, GitHub Actions לעובד) ולעולם לא מוצגים כאן. חיוב הייבוא נמדד בלשונית השימוש.</p>
    </Card>
  );
}

async function McpTab({ user }: { user: User }) {
  const m = await mcpOverview(user);
  const allowed = m.tools.filter(t => t.allowed).length;
  return (
    <div className={ui.stack}>
      <Kpis items={[
        { label: 'שרת MCP', value: 'פעיל', tone: 'ok', note: 'Streamable HTTP · OAuth 2.1 עם PKCE' },
        { label: 'כלים זמינים לכם', value: `${int(allowed)} / ${int(m.tools.length)}`, note: 'לפי ההרשאות שלכם במטריצת התפקידים' },
        { label: 'אסימונים אישיים', value: int(m.personal.length), note: 'פעילים, שלכם' },
        { label: 'אפליקציות מחוברות', value: int(m.apps.length), note: 'דרך OAuth, שלכם' },
      ]} />
      <div className={ui.grid2}>
        <Card title="חיבור מ־Claude" sub="כתובת השרת">
          <p className={ui.mono} dir="ltr" style={{ margin: 0, wordBreak: 'break-all', fontSize: 15 }}>{m.url}</p>
          <ul className={ui.list} style={{ marginTop: 12 }}>
            <li className={ui.note}><b>claude.ai ו־Claude Desktop:</b> הגדרות ← Connectors ← Add custom connector ← הדביקו את הכתובת. Claude יפתח את עמוד האישור של BeautyFind; היכנסו עם חשבון הצוות שלכם ואשרו. אין צורך במפתח.</li>
            <li className={ui.note}><b>Claude Code:</b> <span className={ui.mono} dir="ltr">claude mcp add --transport http beautyfind {m.url}</span> ואז <span className={ui.mono} dir="ltr">/mcp</span> כדי להתחבר, או צרו אסימון אישי למטה והוסיפו <span className={ui.mono} dir="ltr">--header &quot;Authorization: Bearer ...&quot;</span>.</li>
            <li className={ui.note}><b>מה Claude יוכל לעשות:</b> רק מה שההרשאות שלכם מאפשרות. קריאת נתונים חיה; כל פעולת כתיבה נכנסת ל<Link href="/ops/ai?tab=queue" className={ui.rowLink}>תור האישורים</Link> עם המקור <span className={ui.mono}>mcp:claude</span>, ואדם מחליט.</li>
          </ul>
        </Card>
        <Card title="הכלים" sub="אותם כלים של העוזר; ההרשאה הנדרשת לכל כלי" flush>
          <Table head={['כלי', 'אזור', 'סוג', 'לכם']}>
            {m.tools.map(t => (
              <tr key={t.name}>
                <td><span className={ui.mono} dir="ltr">{t.name}</span><span className={ui.sub}>{t.description}</span></td>
                <td>{AREA_NAMES[t.area]} · {LEVEL_NAMES[t.level]}</td>
                <td>{t.write ? <Chip tone="warn">הצעה לאישור</Chip> : <Chip tone="neutral">קריאה</Chip>}</td>
                <td>{t.allowed ? <Chip tone="ok">זמין</Chip> : <Chip tone="bad">אין הרשאה</Chip>}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="אסימונים אישיים" sub="לחיבורים בלי OAuth (Claude Code, סקריפטים). האסימון נושא את ההרשאות שלכם ומוצג פעם אחת" flush>
        <div className={ui.cardPad}><TokenCreator canEdit /></div>
        {m.personal.length ? (
          <Table head={['שם', 'נוצר', 'שימוש אחרון', '']}>
            {m.personal.map(t => (
              <tr key={t.id}><td className={ui.strong}>{t.name}</td><td className={ui.num}>{dateTimeIL(t.createdAt)}</td><td className={ui.num}>{t.lastUsedAt ? relIL(t.lastUsedAt) : 'עוד לא'}</td><td><RevokeButton kind="token" id={t.id} label={t.name} /></td></tr>
            ))}
          </Table>
        ) : <Empty title="אין אסימונים אישיים" text="ל־claude.ai ול־Claude Desktop לא צריך אסימון: החיבור עובר דרך OAuth." />}
      </Card>
      <Card title="אפליקציות מחוברות" sub="אפליקציות שאישרתם דרך OAuth. ניתוק מבטל את כל האסימונים שלהן בשמכם" flush>
        {m.apps.length ? (
          <Table head={['אפליקציה', 'מאז', 'שימוש אחרון', 'אסימונים', '']}>
            {m.apps.map(a => (
              <tr key={a.id}><td className={ui.strong}>{a.name}<span className={ui.sub} dir="ltr">{a.host}</span></td><td className={ui.num}>{dateTimeIL(a.since)}</td><td className={ui.num}>{a.lastUsedAt ? relIL(a.lastUsedAt) : 'עוד לא'}</td><td className={ui.num}>{int(a.tokens)}</td><td><RevokeButton kind="app" id={a.id} label={a.name} /></td></tr>
            ))}
          </Table>
        ) : <Empty title="עוד אין אפליקציות מחוברות" text="אחרי שתאשרו את Claude בעמוד האישור, היא תופיע כאן." />}
      </Card>
      <Card title="קריאות אחרונות" sub="20 הקריאות האחרונות דרך השרת, מכל הצוות. הרשימה המלאה ביומן הפעולות" flush>
        {m.recent.length ? (
          <Table head={['מתי', 'מי', 'כלי', 'תוצאה']}>
            {m.recent.map((r, i) => <tr key={i}><td className={ui.num}>{dateTimeIL(r.at)}</td><td>{r.who}</td><td className={ui.mono} dir="ltr">{r.tool}</td><td>{r.error ? <Chip tone="bad">שגיאה</Chip> : <Chip tone="ok">הצליח</Chip>}</td></tr>)}
          </Table>
        ) : <Empty title="עוד לא היו קריאות" />}
      </Card>
    </div>
  );
}

async function QueueTab({ filter, canEdit }: { filter: QueueFilter; canEdit: boolean }) {
  const rows = await approvals(filter);
  const pending = filter === 'proposed' ? rows.length : rows.filter(r => r.status === 'proposed').length;
  return (
    <>
      <div className={ui.toolbar}>
        <Pills current={filter} items={[{ key: 'proposed', name: 'ממתינים', count: pending, href: '/ops/ai?tab=queue&filter=proposed' }, { key: 'decided', name: 'הוחלטו', href: '/ops/ai?tab=queue&filter=decided' }, { key: 'all', name: 'הכול', href: '/ops/ai?tab=queue&filter=all' }]} />
      </div>
      <Card title="תור אישורים" sub="כל פעולת כתיבה שהעוזר או שרת MCP מציעים; אדם מאשר, והאישור מבצע" flush>
        {rows.length ? rows.map(r => (
          <div key={r.id} className={styles.queueRow}>
            <div>
              <div className={ui.strong}><span className={ui.mono}>{r.ref}</span> · {AI_ACTION_NAMES[r.action] ?? r.action}{r.subjectLabel ? <> · {r.subjectId ? <Link href={`/ops/businesses/${r.subjectId}`} className={ui.rowLink}>{r.subjectLabel}</Link> : r.subjectLabel}</> : null}</div>
              <div className={ui.sub}>{SOURCE_NAME[r.source] ?? r.source} · {dateTimeIL(r.createdAt)} · <Chip tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_NAME[r.status] ?? r.status}</Chip>{r.decidedBy ? ` · ${r.decidedBy} · ${dateTimeIL(r.decidedAt)}` : ''}</div>
              {r.reason ? <p className={styles.queueReason}>{r.reason}</p> : null}
              {r.result ? <p className={ui.hint}>תוצאה: {r.result}</p> : null}
            </div>
            {r.status === 'proposed' && canEdit ? <ApprovalButtons id={r.id} /> : null}
          </div>
        )) : <Empty title={filter === 'proposed' ? 'אין בקשות ממתינות' : 'אין בקשות'} text="בקשות נוצרות כשהעוזר מציע הסתרה, החזרה לאוויר או הערה." />}
      </Card>
    </>
  );
}

async function UsageTab() {
  const u = await usage();
  const providersSeen = [...new Set(u.months.flatMap(m => Object.keys(m.providers)))].sort();
  const thisMonth = u.months[u.months.length - 1];
  const usdThisMonth = Object.values(thisMonth.providers).reduce((a, p) => a + p.usd, 0);
  return (
    <>
      <Kpis items={[
        { label: 'הוצאה מדודה · החודש', value: `$${usdThisMonth.toFixed(2)}`, note: 'ספר ההוצאות של הייבוא (DataForSEO, Apify, OpenAI, Anthropic, Google)' },
        { label: 'שאלות לעוזר · החודש', value: int(u.assistant.questions), note: `${int(u.assistant.proposals)} הצעות לתור` },
        { label: 'טוקנים לעוזר · קלט', value: int(u.assistant.input), note: 'כולל קריאות ממטמון' },
        { label: 'טוקנים לעוזר · פלט', value: int(u.assistant.output), note: 'נמדד מתשובות ה־API' },
      ]} />
      <Card title="הוצאה לפי ספק וחודש" sub="דולר ארה״ב, מתוך רשומות שאושרו בספר ההוצאות; מספר הקריאות בסוגריים" flush>
        {providersSeen.length ? (
          <Table head={['חודש', ...providersSeen, 'סה״כ']}>
            {u.months.map(m => {
              const total = Object.values(m.providers).reduce((a, p) => a + p.usd, 0);
              return (
                <tr key={m.label}>
                  <td className={ui.strong}>{m.label}</td>
                  {providersSeen.map(p => <td key={p} className={ui.num}>{m.providers[p] ? `$${m.providers[p].usd.toFixed(2)} (${int(m.providers[p].calls)})` : '—'}</td>)}
                  <td className={`${ui.num} ${ui.strong}`}>${total.toFixed(2)}</td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty title="אין הוצאות מדודות" text="ספר ההוצאות מתמלא מריצות ייבוא. עלות העוזר נמדדת בטוקנים למעלה." />}
      </Card>
    </>
  );
}
