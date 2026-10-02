import type { Metadata } from 'next';
import { requireArea } from '@/components/ops/guard';
import { AREA_NAMES } from '@/components/ops/roles';
import { ui } from '@/components/ops/ui';
import { parseAuthorizeQuery, redirectAllowed } from '@/lib/mcp';
import { TOOL_CATALOG } from '@/lib/server/assistant';
import { callerLevels, getClient, toolAllowed } from '@/lib/server/mcp';
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
  const tools = TOOL_CATALOG.map(t => ({ name: t.name, description: t.description, area: AREA_NAMES[t.area], write: t.write, allowed: toolAllowed(levels, t) }));

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
            <p className={ui.note}>אתם מחוברים כ־<b>{user.fullName || user.email}</b>. האפליקציה תוכל להפעיל את הכלים שההרשאות שלכם מאפשרות, בשמכם. כל קריאה נרשמת ביומן הפעולות, וכל פעולת כתיבה נכנסת לתור האישורים ומחכה לאדם.</p>
            <ul className={styles.tools}>
              {tools.map(t => (
                <li key={t.name} className={styles.tool} data-off={!t.allowed}>
                  <span className={ui.mono} dir="ltr">{t.name}</span>
                  <span className={styles.toolMeta}>{t.area} · {t.write ? 'הצעה לתור האישורים' : 'קריאה'}{t.allowed ? '' : ' · אין לכם הרשאה, הכלי לא יוצע'}</span>
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
