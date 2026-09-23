import type { Metadata } from 'next';
import Link from 'next/link';
import { businessDays, isContactReason, reasonInfo, type ContactReason } from '@/components/contact/reasons';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { fromE164, nis, telHref } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { currentUser } from '@/lib/server/session';
import { ContactForm, type ContactPrefill } from './ContactForm';
import { LIMITS } from './shared';
import styles from './page.module.css';

// Design: project/BeautyFind Contact.dc.html

export const metadata: Metadata = {
  title: 'יצירת קשר',
  description:
    'יצירת קשר עם BeautyFind: פנייה כללית, רישום עסק, דיווח על טעות או על מחיר שאינו תואם, פניות נגישות ופניות תקשורת, עם זמני מענה מוצהרים.',
  alternates: { canonical: ROUTES.contact },
};

// Israfind Group (Delaware) corresponds by email. Set these to show a phone line or a postal address card.
const SUPPORT_PHONE_E164: string | null = null;
const POSTAL_ADDRESS: { company: string; lines: string[]; zip: string } | null = null;

// Route from 01-flows.md that is not in ROUTES yet.
const METHODOLOGY = ROUTES.methodology;

const CHANNELS: Array<{ name: string; value: string; who: string; href: string }> = [
  { name: 'פנייה כללית', value: 'hello@beautyfind.co.il', who: 'מגיע לצוות המערכת', href: 'mailto:hello@beautyfind.co.il' },
  { name: 'רישום ופרסום', value: 'business@beautyfind.co.il', who: 'צוות הרישום ומכירות', href: 'mailto:business@beautyfind.co.il' },
  // Contacts are roles, never personal names.
  { name: 'תיקונים ותלונות', value: 'corrections@beautyfind.co.il', who: 'צוות העריכה', href: 'mailto:corrections@beautyfind.co.il' },
  { name: 'נגישות', value: 'access@beautyfind.co.il', who: 'רכז/ת הנגישות', href: 'mailto:access@beautyfind.co.il' },
  { name: 'פרטיות', value: 'privacy@beautyfind.co.il', who: 'בקשות עיון, תיקון ומחיקה', href: 'mailto:privacy@beautyfind.co.il' },
  ...(SUPPORT_PHONE_E164
    ? [{ name: 'טלפון', value: fromE164(SUPPORT_PHONE_E164), who: 'ראשון–חמישי, 9:00–17:00', href: telHref(SUPPORT_PHONE_E164) }]
    : []),
];

const HOURS = [
  { day: 'ראשון–חמישי', value: '9:00–17:00', closed: false },
  { day: 'שישי', value: '9:00–13:00', closed: false },
  { day: 'שבת', value: 'סגור', closed: true },
];

const STATS: Array<{ label: string; value: string }> = [
  { label: 'מענה לפנייה כללית', value: businessDays(reasonInfo('general').days) },
  { label: 'דיווח על טעות', value: businessDays(reasonInfo('correction').days) },
  { label: 'תלונה על עסק', value: businessDays(reasonInfo('complaint').days) },
  { label: 'שעות מענה', value: '9:00–17:00' },
];

const SHORTCUTS = [
  {
    q: 'איך רושמים עסק?',
    a: `התהליך, מה נדרש, ומה זה עולה: ${nis(PLAN_MONTHLY_NIS.basic)} או ${nis(PLAN_MONTHLY_NIS.advanced)} לסניף לחודש, ללא מע״מ ישראלי.`,
    label: 'לעמוד הרישום',
    href: ROUTES.forBusiness,
  },
  { q: 'למה המחיר באתר שונה מהמחיר בקליניקה?', a: 'המחירים לפני מע״מ ונושאים תאריך עדכון. כך הם נאספים.', label: 'למתודולוגיה', href: METHODOLOGY },
  { q: 'אפשר להסיר ביקורת?', a: 'ביקורת שמפרה את הכללים: כן. ביקורת שלילית ואמיתית: לא.', label: 'לתקן הרישום', href: ROUTES.listingStandards },
];

const hasHebrew = (s: string) => /[֐-׿]/.test(s);
const param = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawReason = param(sp.reason);
  const reason: ContactReason = isContactReason(rawReason) ? rawReason : 'general';

  // ?page= (a broken link or a listing to correct) prefills the page field; ?code= an error code from the error page.
  const page = (param(sp.page) ?? '').trim().slice(0, LIMITS.extra);
  const code = (param(sp.code) ?? '').replace(/[^A-Za-z0-9\-_.: /]/g, '').slice(0, 60);

  const user = await currentUser().catch(() => null);
  const prefill: ContactPrefill = {
    name: user?.fullName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ? fromE164(user.phone) : '',
    extra: page,
    msg: code ? `קוד תקלה: ${code}\n` : '',
  };

  return (
    <div className={styles.root}>
      <SiteHeader variant="public" />

      <nav aria-label="נתיב ניווט" className={styles.crumbs}>
        <ol>
          <li><Link href={ROUTES.home}>ראשי</Link></li>
          <li aria-hidden="true" className={styles.crumbSep}>/</li>
          <li aria-current="page">יצירת קשר</li>
        </ol>
      </nav>

      <section aria-labelledby="h-title" className={styles.intro}>
        <div className={styles.introInner}>
          <div className={styles.introCopy}>
            <span className={styles.eyebrow}>
              <span aria-hidden="true" />
              יצירת קשר
            </span>
            <h1 id="h-title" className={styles.h1}>
              נשמח לשמוע מכם<span className={styles.dot}>.</span>
            </h1>
            <p className={styles.lede}>
              בחרו את סוג הפנייה כדי שהיא תגיע ישר לאדם הנכון. אנחנו עונים על כל פנייה: גם על תלונות, גם על תיקונים, וגם כשהתשובה היא לא.
            </p>
          </div>
          <dl className={styles.stats}>
            {STATS.map(s => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd className={hasHebrew(s.value) ? undefined : 'ltr'}>{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main className={styles.main}>
        <div className={styles.grid}>
          <div className={styles.col}>
            <ContactForm key={`${reason}|${page}|${code}`} initialReason={reason} prefill={prefill} />

            <section aria-labelledby="h-before" className={styles.before}>
              <h2 id="h-before" className={styles.h2}>לפני שכותבים</h2>
              <p className={styles.beforeLede}>שלוש שאלות שמגיעות אלינו הרבה, ויש להן תשובה מלאה באתר.</p>
              <div className={styles.shortcuts}>
                {SHORTCUTS.map(s => (
                  <Link key={s.q} href={s.href} className={styles.shortcut}>
                    <span className={styles.shortcutQ}>{s.q}</span>
                    <span className={styles.shortcutA}>{s.a}</span>
                    <span className={styles.shortcutGo}>
                      {s.label}
                      <ArrowForward size={13} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <aside aria-label="ערוצי פנייה" className={styles.rail}>
            <div className={styles.card}>
              <div className={styles.cardHead}>ישר לאדם הנכון</div>
              {CHANNELS.map(c => (
                <a key={c.href} href={c.href} className={styles.channel}>
                  <span className={styles.channelName}>{c.name}</span>
                  <span className={`${styles.channelValue} ltr`}>{c.value}</span>
                  <span className={styles.channelWho}>{c.who}</span>
                </a>
              ))}
            </div>

            <div className={styles.hoursCard}>
              <div className={styles.cardLabel}>שעות מענה</div>
              <ul className={styles.hours}>
                {HOURS.map(h => (
                  <li key={h.day}>
                    <span>{h.day}</span>
                    <span className={h.closed ? styles.closed : 'ltr'}>{h.value}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.hoursNote}>
                פניות שמגיעות בשבת או בחג נענות ביום ראשון.
                {POSTAL_ADDRESS && ' אין לנו משרד שמקבל קהל. הכתובת למשלוח דואר בלבד.'}
              </p>
            </div>

            {POSTAL_ADDRESS && (
              <div className={styles.addressCard}>
                <div className={styles.addressLabel}>כתובת למשלוח דואר</div>
                <p>
                  {POSTAL_ADDRESS.company}
                  {POSTAL_ADDRESS.lines.map(l => (
                    <span key={l}>
                      <br />
                      {l}
                    </span>
                  ))}
                  <br />
                  <span className="ltr">{POSTAL_ADDRESS.zip}</span>
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
