'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMedia } from '@/components/search/useMedia';
import { BottomSheet } from '@/components/shell/BottomSheet';
import { SHELL_MQ } from '@/lib/ui/shell';
import styles from './CookieConsent.module.css';

// Real consent storage (kept per 02-data-model.md): localStorage['bf-cookie-consent'].
export const CONSENT_KEY = 'bf-cookie-consent';
export const OPEN_PREFS_EVENT = 'bf-open-cookie-prefs';

export interface Consent {
  essential: true;
  analytics: boolean;
  embeds: boolean;
}

const CATS: Array<{ key: keyof Consent; name: string; note: string; locked: boolean }> = [
  { key: 'essential', name: 'הכרחיים', note: 'אזור, סינון שמור, כניסה לחשבון ואבטחה. בלעדיהם האתר לא עובד.', locked: true },
  { key: 'analytics', name: 'מדידה מצטברת', note: 'אילו עמודים נקראים ואיפה החיפוש נתקע, ללא זיהוי אישי.', locked: false },
  { key: 'embeds', name: 'תוכן מוטמע', note: 'מפות, סרטוני הקליניקות ווידג׳טים של ביקורות מגוגל.', locked: false },
];

const NONE: Consent = { essential: true, analytics: false, embeds: false };
const ALL: Consent = { essential: true, analytics: true, embeds: true };

export function readConsent(): Consent | null {
  try {
    return JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
  } catch {
    return null;
  }
}

/**
 * Global consent banner, preferences dialog and the floating "change" pill. Layout: bar.
 * App shell (spec §6 Cookie Consent): the banner is a bottom sheet above the tab bar, the
 * preferences open in a full-height BottomSheet, and the pill is left out (the "עוד" tab has the link).
 */
export function CookieConsent() {
  // undefined = not read yet (SSR / first paint): render nothing to avoid a flash.
  const [saved, setSaved] = useState<Consent | null | undefined>(undefined);
  const [prefs, setPrefs] = useState(false);
  const [draft, setDraft] = useState<Consent>(NONE);
  const shell = useMedia(SHELL_MQ);

  useEffect(() => {
    const s = readConsent();
    setSaved(s);
    if (s) setDraft(s);
  }, []);

  // Any page can reopen the preferences (e.g. the privacy policy) by dispatching this event.
  useEffect(() => {
    const open = () => setPrefs(true);
    window.addEventListener(OPEN_PREFS_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFS_EVENT, open);
  }, []);

  useEffect(() => {
    if (!prefs || shell) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPrefs(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prefs, shell]);

  if (saved === undefined) return null;

  const save = (v: Consent) => {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(v));
    } catch {}
    setSaved(v);
    setDraft(v);
    setPrefs(false);
  };

  const catList = (
    <ul className={styles.cats}>
      {CATS.map(c => {
        const on = c.locked || !!draft[c.key];
        return (
          <li key={c.key}>
            <span className={styles.catText}>
              <span className={styles.catName}>{c.name}</span>
              <span className={styles.catNote}>{c.note}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={c.name}
              disabled={c.locked}
              className={styles.switch}
              data-on={on || undefined}
              onClick={() => !c.locked && setDraft(d => ({ ...d, [c.key]: !d[c.key] }))}
            >
              <span aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
  const foot = (
    <div className={styles.dialogFoot}>
      <button type="button" className={styles.save} onClick={() => save(draft)}>שמירת הבחירה</button>
      <button type="button" className={styles.secondary} onClick={() => save(ALL)}>אישור הכול</button>
    </div>
  );

  const n = saved ? CATS.filter(c => saved[c.key]).length : 0;
  const decidedLabel = n === CATS.length ? 'כל קובצי ה־Cookie מאושרים' : n === 1 ? 'הכרחיים בלבד' : 'בחירה מותאמת';

  return (
    <div dir="rtl" lang="he">
      {!saved && !prefs && (
        <section role="region" aria-labelledby="ck-h" className={styles.banner}>
          <span aria-hidden="true" className={styles.handle} />
          <div className={styles.bannerRow}>
            <div className={styles.bannerText}>
              <h2 id="ck-h">קובצי Cookie באתר</h2>
              <p>
                אנחנו משתמשים בקבצים הכרחיים כדי לזכור את האזור והסינון שבחרתם, ובקובצי מדידה מצטברת רק אם תאשרו זאת. איננו משתמשים במידע לפרסום מותאם אישית.{' '}
                <Link href="/privacy">מדיניות הפרטיות</Link>
              </p>
            </div>
            <div className={styles.bannerBtns}>
              <button type="button" className={styles.primary} onClick={() => save(ALL)}>אישור הכול</button>
              <button type="button" className={styles.outline} onClick={() => save(NONE)}>הכרחיים בלבד</button>
              <button type="button" className={styles.linkBtn} onClick={() => setPrefs(true)}>בחירה מפורטת</button>
            </div>
          </div>
        </section>
      )}

      {prefs && shell && (
        <BottomSheet open onClose={() => setPrefs(false)} title="העדפות Cookie" size="full" footer={foot}>
          {catList}
        </BottomSheet>
      )}

      {prefs && !shell && (
        <div className={styles.scrim} onClick={e => e.target === e.currentTarget && setPrefs(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="ck-ph" className={styles.dialog}>
            <div className={styles.dialogHead}>
              <h2 id="ck-ph">העדפות Cookie</h2>
              <button type="button" aria-label="סגירה" className={styles.close} onClick={() => setPrefs(false)}>×</button>
            </div>
            {catList}
            {foot}
          </section>
        </div>
      )}

      {saved && !prefs && (
        <button type="button" className={`${styles.pill} bf-desk-only`} onClick={() => setPrefs(true)}>
          {decidedLabel} · שינוי
        </button>
      )}
    </div>
  );
}
