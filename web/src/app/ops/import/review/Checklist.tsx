'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SECTION_NAME, STATUS_NAME, type Coverage, type ProfileStatus } from '@/lib/import/coverage';
import { regenerateEditorialAction } from '../actions';
import styles from '../import.module.css';

export interface ProfileInfo {
  status: ProfileStatus | null;
  coverage: Coverage | null;
  editorial: {
    words: number;
    faqs: number;
    needsMoreInfo: boolean;
    missing: string[];
    model: string;
    violations: string[];
    repairs: number;
    costUsd: number;
    generatedAt: string;
    description: string;
    heading: string;
    error: string | null;
    skipped: string | null;
    faqList: Array<{ q: string; a: string; basis?: string }>;
  } | null;
  team: Array<{ name: string; role: string; bio: string | null; sourceUrl: string | null }>;
  languages: string[];
  establishedYear: number | null;
  videos: { checked: number; playable: number; channel: string | null; unverifiedChannel: string | null; list: Array<{ id: string; title: string | null; status: string }> };
  socials: Array<{ network: string; url: string; verified: boolean; via: string }>;
  media: { candidates: number; copied: number; beforeAfterPending: number; heroMissing: boolean };
  crawl: { pages: number; sitemapUrls: number; extended: boolean } | null;
  map: 'configured' | 'not_configured';
  costs: Record<string, number>;
  conflicts: string[];
  retries: Array<{ at: string; what: string }>;
}

const STATUS_CHIP: Record<ProfileStatus, string> = { ready: styles.chipOk, ready_with_disclosed_gaps: styles.chipOk, needs_owner_information: styles.chipWarn, needs_review: styles.chipBad };
const STATE_NAME: Record<string, string> = { populated: 'מלא', fallback: 'מצב חסר גלוי', missing: 'חסר' };
const VIA: Record<string, string> = { backlink: 'קישור מאתר העסק', handle_matches_domain: 'שם החשבון תואם לדומיין', provider_and_linkhub: 'Google וגם דף הקישורים', owner: 'בעל העסק', staff: 'צוות', unverified: 'לא מאומת, לא מתפרסם' };
const usd = (x: number) => `$${x < 1 ? x.toFixed(4) : x.toFixed(2)}`;

/** Per-profile checklist (feature request §12): coverage, missing fields, evidence, draft, media, video, map, costs. */
export function Checklist({ id, decided, info }: { id: string; decided: boolean; info: ProfileInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const cov = info.coverage;
  const ed = info.editorial;
  const regenerate = () =>
    start(async () => {
      const r = await regenerateEditorialAction([id]);
      setMsg(r.ok ? (r.count ? `נשלח לכתיבה מחדש${r.dispatched === false ? ' (העובד לא הופעל, הפעילו אותו מדף הריצות)' : ''}` : 'אין מה לשלוח') : 'הפעולה נכשלה');
      router.refresh();
    });
  return (
    <div>
      <div className={styles.btnRow}>
        <button type="button" className={styles.btn} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'הסתרת רשימת הבדיקה' : 'רשימת בדיקה של הכרטיס'}
        </button>
        {info.status ? <span className={`${styles.chip} ${STATUS_CHIP[info.status]}`}>{STATUS_NAME[info.status]}</span> : null}
        {cov ? <span className={styles.note}>כיסוי תבנית <span className={styles.ltr}>{cov.templateCoverage}%</span> · מוכנות תוכן <span className={styles.ltr}>{cov.readiness}%</span></span> : null}
        {ed ? <span className={styles.note}>תיאור <span className={styles.ltr}>{ed.words}</span> מילים · <span className={styles.ltr}>{ed.faqs}</span> שאלות{ed.needsMoreInfo ? ' · חסר מידע מהעסק' : ''}</span> : <span className={styles.note}>אין טיוטת תיאור</span>}
      </div>
      {open ? (
        <div className={styles.stack} style={{ marginTop: 8 }}>
          {cov ? (
            <table className={styles.obs}>
              <thead><tr><th>מדור</th><th>מצב</th><th>פרטים</th></tr></thead>
              <tbody>
                {cov.rows.map(r => (
                  <tr key={r.id} className={r.state === 'missing' ? styles.obsConflict : undefined}>
                    <td>{SECTION_NAME[r.id] ?? r.id}</td>
                    <td>{STATE_NAME[r.state] ?? r.state}</td>
                    <td className={styles.note}>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className={styles.note}>הכיסוי מחושב באישור הכרטיס.</p>}
          {cov?.ownerMissing.length ? <p className={styles.note}>רק בעל העסק יכול להשלים: {cov.ownerMissing.map(x => SECTION_NAME[x] ?? x).join(', ')}</p> : null}
          {info.conflicts.length ? <p className={`${styles.result} ${styles.resultBad}`}>סתירות בין מקורות: {info.conflicts.join(', ')}</p> : null}

          <div className={styles.panel}>
            <p className={styles.label}>תיאור ושאלות (טיוטה)</p>
            {ed ? (
              <>
                <p className={styles.note}>
                  מודל {ed.model} · {new Date(ed.generatedAt).toLocaleString('he-IL')} · {ed.repairs ? `תיקון אחד · ` : ''}עלות {usd(ed.costUsd)}
                  {ed.violations.length ? ` · בעיות שנותרו: ${ed.violations.join(', ')}` : ' · עבר את כל הבדיקות'}
                  {ed.error ? ` · שגיאה: ${ed.error}` : ''}
                </p>
                {ed.needsMoreInfo ? <p className={`${styles.result} ${styles.resultBad}`}>needs_more_business_information: {ed.missing.length ? ed.missing.join(', ') : 'הראיות לא מספיקות ל־450 מילים'}</p> : null}
                <button type="button" className={styles.btn} onClick={() => setDraft(!draft)} aria-expanded={draft}>{draft ? 'הסתרת הטיוטה' : 'הצגת הטיוטה'}</button>
                {draft ? (
                  <div className={styles.stack}>
                    <p className={styles.label}>{ed.heading}</p>
                    {ed.description.split(/\n\s*\n/).map((para, i) => <p key={i} className={styles.desc}>{para}</p>)}
                    <ul className={styles.treats}>
                      {ed.faqList.map((f, i) => <li key={i}><span><b>{f.q}</b> {f.a}</span><span className={styles.note}>{f.basis ?? ''}</span><span /></li>)}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : <p className={styles.note}>{info.editorial === null ? 'הכתיבה עדיין לא רצה (או כבויה בהגדרות).' : ''}</p>}
            <div className={styles.btnRow}>
              <button type="button" className={styles.btn} disabled={pending || !decided} onClick={regenerate} title={decided ? '' : 'כתיבה מחדש זמינה אחרי הפרסום (ריצת העשרה)'}>כתיבה מחדש של התיאור והשאלות</button>
              {msg ? <span className={styles.note} role="status">{msg}</span> : null}
            </div>
          </div>

          <dl className={styles.meta}>
            <div><dt>צוות מהאתר: </dt><dd>{info.team.length ? info.team.map(t => `${t.name} (${t.role})`).join(', ') : 'לא נמצא'}</dd></div>
            <div><dt>שפות: </dt><dd>{info.languages.length ? info.languages.join(', ') : 'לא צוין'}</dd></div>
            <div><dt>פועל מאז: </dt><dd className={styles.ltr}>{info.establishedYear ?? 'לא צוין'}</dd></div>
            <div><dt>סרטונים: </dt><dd>{info.videos.checked ? `${info.videos.playable} ניתנים להטמעה מתוך ${info.videos.checked} שנבדקו` : 'לא נמצאו'}{info.videos.channel ? ' · ערוץ מאומת' : info.videos.unverifiedChannel ? ' · ערוץ לא מאומת (לא מתפרסם)' : ''}</dd></div>
            <div><dt>רשתות: </dt><dd>{info.socials.length ? info.socials.map(s => `${s.network}: ${VIA[s.via] ?? s.via}`).join(' · ') : 'אין'}</dd></div>
            <div><dt>תמונות: </dt><dd>{info.media.copied ? `${info.media.copied} הועתקו` : `${info.media.candidates} מועמדות`}{info.media.heroMissing ? ' · hero_media_missing' : ''}{info.media.beforeAfterPending ? ` · ${info.media.beforeAfterPending} תמונות לפני/אחרי ממתינות לאישור בעל העסק` : ''}</dd></div>
            <div><dt>סריקה: </dt><dd>{info.crawl ? `${info.crawl.pages} עמודים${info.crawl.sitemapUrls ? `, ${info.crawl.sitemapUrls} מה־sitemap` : ''}${info.crawl.extended ? ', התקציב הורחב' : ''}` : 'לא נסרק'}</dd></div>
            <div><dt>מפה: </dt><dd>{info.map === 'configured' ? 'Google Maps Embed מוגדר' : 'מפתח Maps Embed לא מוגדר (מוצגת מפה סכמטית וקישורי ניווט)'}</dd></div>
            <div><dt>עלויות הרשומה: </dt><dd className={styles.ltr}>{Object.entries(info.costs).length ? Object.entries(info.costs).map(([k, v]) => `${k} ${typeof v === 'number' && k.endsWith('Usd') ? usd(v) : v}`).join(', ') : '0'}</dd></div>
            {info.retries.length ? <div><dt>ניסיונות: </dt><dd>{info.retries.map(r => `${r.what} (${new Date(r.at).toLocaleDateString('he-IL')})`).join(', ')}</dd></div> : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
