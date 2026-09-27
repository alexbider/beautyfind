'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ImportSettings } from '@/lib/import/settings';
import { saveSettingsAction } from './actions';
import styles from './import.module.css';

export interface ServerFlags {
  canDispatch: boolean; // GITHUB_DISPATCH_TOKEN on Vercel
  mapKey: boolean; // NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY on Vercel
  googleAvailable: boolean; // legacy Google display lookups
}

type Known = boolean | null; // null: the worker has not reported yet

function Status({ ok, optional }: { ok: Known; optional?: boolean }) {
  if (ok === null) return <span className={styles.chip}>יתעדכן אחרי הריצה הראשונה</span>;
  if (ok) return <span className={`${styles.chip} ${styles.chipOk}`}>מחובר</span>;
  return <span className={`${styles.chip} ${optional ? '' : styles.chipWarn}`}>{optional ? 'לא מוגדר (רשות)' : 'לא מוגדר'}</span>;
}

/**
 * Every source the import uses, in one place: is it connected, is it on, what it does, where its key
 * lives. The worker reports which keys it has at every start (settings.workerStatus); Vercel keys are
 * read here.
 */
export function Sources({ settings, flags }: { settings: ImportSettings; flags: ServerFlags }) {
  const router = useRouter();
  const [v, setV] = useState(settings);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState('');
  const ws = settings.workerStatus ?? null;
  const known = (k: keyof NonNullable<ImportSettings['workerStatus']>): Known => (ws ? Boolean(ws[k]) : null);
  const set = <K extends keyof ImportSettings>(k: K, val: ImportSettings[K]) => setV(o => ({ ...o, [k]: val }));
  const flag = (k: keyof ImportSettings, label: string, disabled = false) => (
    <label className={styles.check}><input type="checkbox" disabled={disabled} checked={Boolean(v[k])} onChange={e => set(k, e.target.checked as never)} />{label}</label>
  );
  const num = (k: keyof ImportSettings, label: string, step = '1') => (
    <label>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} dir="ltr" type="number" step={step} value={String(v[k])} onChange={e => set(k, Number(e.target.value) as never)} />
    </label>
  );
  const save = (patch?: Partial<ImportSettings>) =>
    start(async () => {
      const r = await saveSettingsAction({ ...v, ...patch });
      if (r.ok && r.settings) setV(r.settings);
      setSaved(r.ok ? 'נשמר' : 'השמירה נכשלה');
      router.refresh();
    });
  const Row = ({ title, status, what, where, children }: { title: string; status: React.ReactNode; what: string; where: string; children?: React.ReactNode }) => (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className={styles.btnRow} style={{ alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{title}</span>
        {status}
      </div>
      <p className={styles.note} style={{ margin: '0 0 6px' }}>{what} <span className={styles.ltr} style={{ display: 'inline' }}>{where}</span></p>
      {children ? <div className={styles.checks}>{children}</div> : null}
    </div>
  );

  return (
    <section className={`${styles.card} ${styles.stack}`} aria-labelledby="sources-h">
      <div className={styles.btnRow} style={{ alignItems: 'center' }}>
        <h2 id="sources-h" className={styles.h2} style={{ margin: 0, flex: 1 }}>מקורות וחיבורים</h2>
        <button type="button" className={`${styles.btn} ${v.killSwitch ? styles.teal : styles.danger}`} disabled={pending} onClick={() => save({ killSwitch: !v.killSwitch })}>
          {v.killSwitch ? 'כיבוי מתג החירום' : 'מתג חירום: עצירת כל הקריאות בתשלום'}
        </button>
      </div>
      {v.killSwitch ? <p className={styles.error} style={{ margin: 0 }}>מתג החירום פעיל: אף קריאה בתשלום לא נשלחת עד שמכבים אותו.</p> : null}
      <p className={styles.note} style={{ margin: 0 }}>
        {ws ? `העובד דיווח לאחרונה ב־${new Date(ws.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}.` : 'העובד עוד לא רץ, לכן מצב החיבורים שלו לא ידוע.'} מפתחות של העובד נמצאים ב־GitHub Actions (Secrets), מפתחות של האתר ב־Vercel. שום מפתח לא מוצג כאן.
      </p>

      <Row title="DataForSEO: איתור העסקים ופרטי פרופיל Google" status={<Status ok={known('dataforseo')} />} what="השלב הראשון של כל ייבוא: שם, כתובת, טלפון, שעות, דירוג, תמונות ומאפיינים. בתשלום לפי רשומה." where="GitHub: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD">
        {flag('dataforseoEnabled', 'פעיל')}
        {flag('publishProviderRatings', 'פרסום דירוג Google ומספר הביקורות')}
        {flag('useProviderImages', 'לוגו ותמונות מפרופיל Google')}
      </Row>
      <Row title="אתר העסק" status={<span className={`${styles.chip} ${styles.chipOk}`}>תמיד</span>} what="הסורק שלנו קורא את האתר הרשמי: דוא״ל, שירותים ומחירים, שעות, צוות, סרטונים, תמונות. ללא עלות ספק, מכבד robots.txt ולא עוקף חסימות." where="">
        {flag('useWebsiteImages', 'לוגו ותמונות מאתר העסק')}
      </Row>
      <Row title="Apify: Google Maps, פייסבוק, אינסטגרם ואתרים בדפדפן" status={<Status ok={known('apify')} />} what="משלים מה שהספק והאתר השאירו חסר. פרופילים ברשתות נלקחים רק כשהפרופיל עצמו מאשר את העסק. בתשלום לפי פריט." where="GitHub: APIFY_TOKEN">
        {flag('apifyEnabled', 'פעיל')}
        {flag('apifyMaps', 'Google Maps', !v.apifyEnabled)}
        {flag('apifyFacebook', 'פייסבוק', !v.apifyEnabled)}
        {flag('apifyInstagram', 'אינסטגרם', !v.apifyEnabled)}
        {flag('apifyRender', 'אתרים שדורשים JavaScript', !v.apifyEnabled)}
      </Row>
      <Row title="כתיבת התיאור והשאלות הנפוצות (Claude)" status={<Status ok={known('anthropic')} />} what="קריאה אחת לעסק על חבילת הראיות: 450 עד 550 מילים, 5 עד 8 שאלות, כותרות. בלי המפתח העסקים נשארים עם הטקסט מהמקורות." where="GitHub: ANTHROPIC_API_KEY">
        {flag('editorialEnabled', 'פעיל')}
      </Row>
      <Row title="YouTube" status={<Status ok={known('youtube')} optional />} what="סרטונים רשמיים מהאתר (בלי מפתח) ומהערוץ המאומת (עם מפתח)." where="GitHub: YOUTUBE_API_KEY (רשות)">
        {flag('youtubeEnabled', 'פעיל')}
      </Row>
      <Row title="אחסון תמונות של העובד" status={<Status ok={known('blob')} optional />} what="בלי הטוקן העובד לא מעתיק תמונות בריצות העשרה; כפתור ״העתקת תמונות ממתינות״ עושה זאת מהאתר." where="GitHub: BLOB_READ_WRITE_TOKEN (רשות)" />
      <Row title="מפה בעמוד העסק" status={<Status ok={flags.mapKey} />} what="Google Maps Embed, ללא חיוב. בלי המפתח העמוד מציג מפה סכמטית וקישורי Waze וניווט, ו״מפה והגעה״ מסומן כחסר." where="Vercel: NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY">
        {flag('mapsEmbedEnabled', 'פעיל')}
      </Row>
      <Row title="הפעלת העובד מהמסך הזה" status={<Status ok={flags.canDispatch} />} what="בלי הטוקן ריצה חדשה מחכה עד שמפעילים את ״Import worker״ ב־GitHub Actions ידנית." where="Vercel: GITHUB_DISPATCH_TOKEN" />

      <details>
        <summary className={styles.label} style={{ cursor: 'pointer' }}>תקרות וכללי פרסום</summary>
        <div className={styles.editGrid}>
          {num('pilotRecordLimit', 'ברירת מחדל: עסקים לריצה')}
          {num('editorialBudgetUsd', 'כתיבה: תקרה לריצה (USD)', '0.01')}
          {num('editorialMaxPerRun', 'כתיבה: קריאות לריצה')}
          {num('apifyBudgetUsd', 'Apify: תקרה לריצה (USD)', '0.01')}
          {num('apifyMonthlyUsd', 'Apify: תקרה חודשית (USD)', '0.01')}
          {num('maxListingPhotos', 'תמונות לעסק (עד 20)')}
        </div>
        <div className={styles.checks} style={{ marginTop: 10 }}>
          {flag('requirePhoneOrEmail', 'טלפון או דוא״ל חובה לפרסום')}
          {flag('requireEmail', 'דוא״ל חובה לפרסום')}
          {flag('requirePhoneOrWebsite', 'טלפון או אתר חובה לפרסום')}
        </div>
      </details>
      <details>
        <summary className={styles.label} style={{ cursor: 'pointer' }}>הגדרות מתקדמות</summary>
        <div className={styles.checks} style={{ marginTop: 8 }}>
          {flag('browserFallback', 'דפדפן של העובד לאתרים שדורשים JavaScript (מוגבל)')}
          {flag('llmEnabled', 'חילוץ טיפולים עם Claude (עם ציטוט מהאתר)')}
          {flag('imageDerivatives', 'נגזרות WebP לתמונות')}
          {flag('googlePostPhotos', 'תמונות מפוסטים בפרופיל Google (DataForSEO)')}
          {flag('googleEnabled', 'Google Places: תצוגה נפרדת בלבד', !flags.googleAvailable)}
        </div>
        <div className={styles.editGrid}>
          {num('pilotBudgetUsd', 'ברירת מחדל: תקרה לריצה (USD)', '0.01')}
          {num('dfsPageSize', 'גודל עמוד DataForSEO (עד 1,000)')}
          {num('crawlMaxPages', 'עמודים לאתר בשלב הראשון (עד 12)')}
          {num('crawlMaxPagesExtended', 'עמודים לאתר כשחסרים שדות (עד 20)')}
          {num('recheckOkDays', 'ימים עד בדיקה חוזרת של אתר')}
          {num('recheckFailDays', 'ימים עד ניסיון חוזר אחרי כישלון')}
          {num('browserMaxPerRun', 'עמודי דפדפן לריצה')}
          {num('apifyMaxImages', 'Apify: תמונות מפרופיל Google לעסק')}
          {num('apifyMaxPosts', 'Apify: פוסטי אינסטגרם לעסק')}
          {num('apifyRenderPages', 'Apify: עמודים לאתר בדפדפן')}
          {num('youtubeQuotaPerRun', 'YouTube: יחידות מכסה לריצה')}
          {num('youtubeMaxVideos', 'סרטונים לעסק (עד 6)')}
          {num('llmBudgetUsd', 'חילוץ Claude: תקרה לריצה (USD)', '0.01')}
          {num('googleRunCallCap', 'Google Places: קריאות לריצה')}
          {num('googleDailyUsd', 'Google Places: תקרה יומית (USD)', '0.01')}
          {num('googleMonthlyUsd', 'Google Places: תקרה חודשית (USD)', '0.01')}
          {num('googlePhotoCap', 'Google Places: תמונות ביום')}
        </div>
      </details>
      <div className={styles.btnRow}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={() => save()}>שמירת ההגדרות</button>
        {saved ? <span className={styles.result} role="status">{saved}</span> : null}
      </div>
    </section>
  );
}
