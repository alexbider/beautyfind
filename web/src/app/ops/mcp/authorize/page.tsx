import type { Metadata } from 'next';
import { requireArea } from '@/components/ops/guard';
import { AREA_NAMES } from '@/components/ops/roles';
import { ui } from '@/components/ops/ui';
import { parseAuthorizeQuery, redirectAllowed } from '@/lib/mcp';
import { callerLevels, getClient, toolAllowed } from '@/lib/server/mcp';
import { toolsByArea } from '@/lib/server/mcpTools';
import { ConsentForm } from './ConsentForm';
import styles from './authorize.module.css';

// The OAuth authorization page of the MCP server: a signed-in staff member approves (or refuses) an
// app's request to act with their permissions. Signed out, the login page brings them back here.

export const metadata: Metadata = { title: 'אישור חיבור MCP · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuthorizePage({ searchParams }: { searchParams: SP }) {
  const raw = await searchParams;
  const q = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)]));
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === 'string')).toString();
  const user = await requireArea('ai', 'view', `/ops/mcp/authorize?${qs}`);
  const parsed = parseAuthorizeQuery(q);
  const client = parsed.ok ? await getClient(parsed.params.clientId) : null;
  const redirectOk = parsed.ok && !!client && redirectAllowed(client.redirectUris, parsed.params.redirectUri);
  const levels = await callerLevels(user);
  const groups = toolsByArea().map(g => {
    const allowed = g.tools.filter(t => toolAllowed(levels, t));
    return { area: AREA_NAMES[g.area], total: g.tools.length, reads: allowed.filter(t => !t.write).length, writes: allowed.filter(t => t.write).length, names: allowed.map(t => t.name) };
  });

  return (
    <main className={styles.wrap} dir="rtl" lang="he">
      <section className={styles.card}>
        <div className={styles.brand}><span dir="ltr" className={styles.mark}>beauty<span>find.</span></span><span className={styles.badge}>חיבור MCP</span></div>
        {!parsed.ok ? (
          <>
            <h1 className={styles.h1}>הבקשה לא תקינה</h1>
            <p className={ui.note}>{parsed.description} (<span className={ui.mono}>{parsed.error}</span>). סגרו את החלון ונסו להתחבר שוב מהאפליקציה.</p>
          </>
        ) : !client ? (
          <>
            <h1 className={styles.h1}>אפליקציה לא מוכרת</h1>
            <p className={ui.note}>האפליקציה לא נרשמה בשרת. סגרו את החלון ונסו להתחבר שוב מהאפליקציה; היא תירשם מחדש.</p>
          </>
        ) : !redirectOk ? (
          <>
            <h1 className={styles.h1}>כתובת חזרה לא מאושרת</h1>
            <p className={ui.note}>כתובת החזרה שהאפליקציה שלחה אינה מהכתובות שנרשמו עבורה. מטעמי אבטחה לא נמשיך.</p>
          </>
        ) : (
          <>
            <h1 className={styles.h1}>{client.name} מבקשת לעבוד עם ניהול BeautyFind</h1>
            <p className={ui.note}>אתם מחוברים כ־<b>{user.fullName || user.email}</b>. האפליקציה תוכל לקרוא ולשנות בניהול בדיוק מה שההרשאות שלכם מאפשרות, בשמכם: כל קריאה וכל שינוי נרשמים ביומן הפעולות על שמכם, ושינוי עובר את אותם אימותים כמו במסך.</p>
            <ul className={styles.tools}>
              {groups.map(g => (
                <li key={g.area} className={styles.tool} data-off={!g.names.length}>
                  <span className={ui.strong}>{g.area}</span>
                  <span className={styles.toolMeta}>{g.names.length ? `${g.reads} קריאה · ${g.writes} שינוי` : `אין לכם הרשאה · ${g.total} כלים לא יוצעו`}{g.names.length ? <> · <span dir="ltr">{g.names.join(', ')}</span></> : null}</span>
                </li>
              ))}
            </ul>
            <ConsentForm params={parsed.params} />
            <p className={styles.foot}>אפשר לנתק את האפליקציה בכל רגע ב־<span dir="ltr">/ops/ai</span>, לשונית ״שרת MCP״.</p>
          </>
        )}
      </section>
    </main>
  );
}
