'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CATEGORIES, CITIES, REGIONS } from '@/lib/catalog';
import { formatIlPhone } from '@/lib/import/phone';
import { BLOCKING, REASON_NAMES, type ImportedTreatment } from '@/lib/import/rules';
import { bulkApproveAction, enhanceApprovedAction, enrichSelectedAction, googleLookupAction, placeAction, publishEligibleAction } from '../actions';
import styles from '../import.module.css';

export interface ReviewRow {
  id: string;
  status: string;
  reasons: string[];
  name: string;
  address: string;
  cityName: string | null;
  citySlug: string | null;
  regionSlug: string | null;
  phone: string | null;
  phoneRaw: string | null;
  whatsapp: string | null;
  email: string | null;
  emailSource: string | null;
  emailMx: boolean | null;
  emails: string[];
  website: string | null;
  instagram: string | null;
  googleRating: number | null;
  ratingProvider: string | null;
  googleReviewCount: number | null;
  googleMapsUri: string | null;
  categories: string[];
  businessType: string | null;
  description: string | null;
  treatments: ImportedTreatment[];
  pagesRead: number;
  crawlSkipped: string | null;
  extractError: string | null;
  rendered: number;
  facebook: string | null;
  note: string | null;
  provider: string;
  placeId: string | null;
  emailStatus: string | null;
  bookingUrl: string | null;
  websiteKind: string | null;
  template: { score: number; missing: Array<{ key: string; label: string }> };
  rejectedWebsite: string | null;
  viaLinkhub: string | null;
  logoUrl: string | null;
  photoUrls: string[];
  imageCandidates: { logos: string[]; photos: string[] };
  conflicts: string[];
  agencyEmails: string[];
  observations: Obs[];
  match: { id: string; name: string; href: string; city: string; score: number; reasons: string[] } | null;
  dup: { id: string; name: string; address: string; status: string; reasons: string[] } | null;
  created: { name: string; href: string } | null;
}

export interface Obs {
  field: string;
  value: unknown;
  provider: string;
  url: string | null;
  at: string;
  confidence: number;
  evidence: string | null;
  publishable: boolean;
  status: string | null;
}

const MATCH_WHY: Record<string, string> = {
  same_place_id: 'אותו מקום בגוגל', same_phone: 'אותו טלפון', same_email: 'אותו דוא״ל', same_website: 'אותו אתר', same_name: 'אותו שם',
  similar_name: 'שם דומה', same_address: 'אותה כתובת', nearby: 'קרוב מאוד', far_apart: 'רחוקים זה מזה',
};
const TYPE_NAME: Record<string, string> = { clinic: 'קליניקה רפואית', medspa: 'קוסמטיקה ורפואה', cosmetics: 'קוסמטיקה', salon: 'סלון' };
const KIND_NAME: Record<string, string> = { own: 'אתר העסק', social: 'פרופיל ברשת חברתית', linkhub: 'דף קישורים', google_profile: 'פרופיל Google (אין אתר אחר)' };
const SKIP_NAME: Record<string, string> = {
  directory: 'הקישור הוא אינדקס או אתר צד שלישי, לא נשמר', google_profile: 'פרופיל Google, לא נסרק', unrelated: 'האתר שייך לעסק אחר, לא נשמר', social_profile: 'פרופיל ברשת חברתית, לא נסרק', linkhub: 'דף קישורים, לא נמצא אתר עסק',
  no_website: 'אין אתר', social: 'רק רשת חברתית', robots: 'האתר חוסם סריקה ב־robots.txt', unreachable: 'האתר לא נטען', blocked: 'האתר חסם את הגישה', off_topic: 'לא עסק יופי',
  no_email: 'נקרא, לא נמצא דוא״ל', failed: 'האתר לא נטען', unsafe: 'כתובת לא בטוחה, לא נסרקה', not_modified: 'לא השתנה מאז הבדיקה הקודמת', skipped_complete: 'לא נדרש, הפרטים כבר מלאים',
};
const EMAIL_SRC: Record<string, string> = { manual: 'הוזן ידנית', site: 'מהאתר', social: 'מדף הפייסבוק או האינסטגרם', search: 'מחיפוש ברשת', provider: 'מפרופיל Google' };
const EMAIL_STATUS: Record<string, string> = { dns_valid: 'הדומיין מקבל דואר', syntax_valid: 'תקין בתחביר בלבד', published: 'מופיע באתר העסק' };
const PROVIDER: Record<string, string> = { dataforseo: 'DataForSEO', google: 'Google', website: 'אתר העסק', llm: 'חילוץ AI', staff: 'צוות', owner: 'בעל העסק' };
const FIELD: Record<string, string> = {
  email: 'דוא״ל', phone: 'טלפון', whatsapp: 'וואטסאפ', social: 'רשת חברתית', booking: 'הזמנת תור', hours: 'שעות', address: 'כתובת', service: 'טיפול', logo: 'לוגו', website: 'אתר',
  name: 'שם', category: 'תחום', categories: 'תחומים', rating: 'דירוג',
};
const G_ERR: Record<string, string> = {
  google_disabled: 'Google כבוי', kill_switch: 'מתג העצירה פעיל', no_place_id: 'אין מזהה Google לרשומה', photos_disabled: 'תמונות כבויות', no_answer: 'אין תשובה מ־Google',
  'budget:day': 'הגעתם לתקרה היומית', 'budget:month': 'הגעתם לתקרה החודשית', forbidden: 'אין הרשאה',
};

function show(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(v)) return v.every(x => typeof x === 'string') ? v.join(', ') : `${v.length} ימים`;
    if (typeof o.name === 'string') return `${o.name}${o.priceNis ? ` · ₪${o.priceNis}` : ''}`;
    if (typeof o.url === 'string') return o.url;
    if (typeof o.e164 === 'string' || typeof o.raw === 'string') return String(o.raw ?? o.e164);
  }
  return JSON.stringify(v).slice(0, 80);
}

function Evidence({ r }: { r: ReviewRow }) {
  if (!r.observations.length) return <p className={styles.note}>אין תצפיות שמורות לרשומה.</p>;
  return (
    <table className={styles.obs}>
      <thead>
        <tr><th>שדה</th><th>ערך</th><th>מקור</th><th>ביטחון</th><th>ראיה</th></tr>
      </thead>
      <tbody>
        {r.observations.map((o, i) => {
          const conflict = (o.field === 'phone' && r.conflicts.includes('phone')) || (o.field === 'hours' && r.conflicts.includes('hours'));
          return (
            <tr key={i} className={conflict ? styles.obsConflict : undefined}>
              <td>{FIELD[o.field] ?? o.field}{o.publishable ? '' : ' · לא לפרסום'}</td>
              <td className={styles.ltr}>{show(o.value)}</td>
              <td>
                {o.url ? <a href={o.url} target="_blank" rel="noreferrer">{PROVIDER[o.provider] ?? o.provider}</a> : PROVIDER[o.provider] ?? o.provider}
                <span className={styles.note}> · {new Date(o.at).toLocaleDateString('he-IL')}</span>
              </td>
              <td className={styles.ltr}>{Math.round(o.confidence * 100)}%</td>
              <td className={styles.note}>{o.evidence ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const isGoogle = (u: string) => /googleusercontent\.com|ggpht\.com/.test(u);

function Images({ r }: { r: ReviewRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [logo, setLogo] = useState<string | null>(r.logoUrl);
  const [photos, setPhotos] = useState<string[]>(r.photoUrls);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (u: string) => setPhotos(ps => (ps.includes(u) ? ps.filter(x => x !== u) : [...ps, u]));
  const save = () =>
    start(async () => {
      const res = await placeAction(r.id, { op: 'edit', fields: { logoUrl: logo, photoUrls: photos } });
      setMsg(res.ok ? 'נשמר' : 'השמירה נכשלה');
      router.refresh();
    });
  const thumb = (u: string) => <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.thumbImg} />;
  return (
    <div>
      <button type="button" className={styles.btn} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'הסתרת תמונות' : `לוגו ותמונות מהאתר (${r.logoUrl ? 'לוגו, ' : ''}${r.photoUrls.length} נבחרו)`}
      </button>
      {open ? (
        <div className={styles.stack} style={{ marginTop: 8 }}>
          <p className={styles.note}>התמונות שנבחרו יועתקו לאתר שלנו באישור. הראשונה תהיה תמונת השער. תמונות מסומנות Google הגיעו מפרופיל Google של העסק. בעל העסק יוכל להחליף אותן.</p>
          {r.imageCandidates.logos.length ? (
            <fieldset className={styles.thumbs}>
              <legend className={styles.label}>לוגו</legend>
              {r.imageCandidates.logos.map(u => (
                <label key={u} className={styles.thumb} data-on={logo === u || undefined}>
                  <input type="radio" name={`logo-${r.id}`} checked={logo === u} onChange={() => setLogo(u)} />
                  {thumb(u)}
                  {isGoogle(u) ? <span className={styles.srcTag}>Google</span> : null}
                </label>
              ))}
              <label className={styles.thumb} data-on={logo === null || undefined}>
                <input type="radio" name={`logo-${r.id}`} checked={logo === null} onChange={() => setLogo(null)} />
                בלי לוגו
              </label>
            </fieldset>
          ) : null}
          {r.imageCandidates.photos.length ? (
            <fieldset className={styles.thumbs}>
              <legend className={styles.label}>תמונות ({photos.length} נבחרו)</legend>
              {r.imageCandidates.photos.map(u => (
                <label key={u} className={styles.thumb} data-on={photos.includes(u) || undefined}>
                  <input type="checkbox" checked={photos.includes(u)} onChange={() => toggle(u)} />
                  {thumb(u)}
                  {photos[0] === u ? <span className={styles.coverTag}>שער</span> : null}
                  {isGoogle(u) ? <span className={styles.srcTag}>Google</span> : null}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className={styles.btnRow}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={save}>{pending ? 'שומרים…' : 'שמירת הבחירה'}</button>
            {msg ? <span className={styles.note} role="status">{msg}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GoogleView({ placeId }: { placeId: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Awaited<ReturnType<typeof googleLookupAction>> | null>(null);
  const go = (feature: 'verify' | 'rating') => start(async () => setRes(await googleLookupAction(placeId, feature)));
  return (
    <div className={styles.panel}>
      <p className={styles.note}>תצוגת Google נפרדת. בתשלום לפי קריאה, לא נשמרת ברשומה ולא מתפרסמת.</p>
      <div className={styles.btnRow}>
        <button type="button" className={styles.btn} disabled={pending} onClick={() => go('verify')}>אימות מול Google</button>
        <button type="button" className={styles.btn} disabled={pending} onClick={() => go('rating')}>דירוג ב־Google</button>
      </div>
      {res ? (
        res.ok ? (
            <dl className={styles.meta}>
            {Object.entries(res.fields).filter(([k]) => k !== 'attributions' && k !== 'photos').map(([k, v]) => (
              <div key={k}><dt>{k}: </dt><dd className={styles.ltr}>{typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v)}</dd></div>
            ))}
            <div><dt>מקור: </dt><dd>Google Maps{res.cached ? ' · מהמטמון' : ''}</dd></div>
          </dl>
        ) : <p className={`${styles.result} ${styles.resultBad}`}>{G_ERR[res.error] ?? res.error}</p>
      ) : null}
    </div>
  );
}
const ERR: Record<string, string> = {
  incomplete: 'חסרים פרטי חובה', exists: 'המקום כבר קיים באתר', state: 'הרשומה כבר טופלה', not_found: 'הרשומה לא נמצאה', phone: 'מספר טלפון לא תקין',
  email: 'כתובת דוא״ל לא תקינה', email_mx: 'הדומיין של הדוא״ל לא מקבל דואר', name: 'חסר שם', city: 'יישוב לא מוכר', forbidden: 'אין הרשאה', invalid: 'נתונים לא תקינים',
  no_branch: 'הדף הקיים לא נמצא', website_directory: 'זה אינדקס או אתר צד שלישי, לא אתר העסק', website_booking: 'זה דף הזמנת תורים, לא אתר העסק',
};
const catName = (s: string) => CATEGORIES.find(c => c.slug === s)?.name ?? s;
const regionName = (s: string | null) => REGIONS.find(r => r.slug === s)?.name ?? '';

function Edit({ r, onDone }: { r: ReviewRow; onDone: (msg: string, ok: boolean) => void }) {
  const [name, setName] = useState(r.name);
  const [phone, setPhone] = useState(r.phone ? formatIlPhone(r.phone) : '');
  const [email, setEmail] = useState(r.email ?? '');
  const [website, setWebsite] = useState(r.website ?? '');
  const [city, setCity] = useState(r.citySlug ?? '');
  const [cats, setCats] = useState(r.categories);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await placeAction(r.id, { op: 'edit', fields: { name, phone, email, website, categories: cats, citySlug: city || null } });
      onDone(res.ok ? 'נשמר ונבדק מחדש' : ERR[res.error] ?? 'השמירה נכשלה', res.ok);
    });
  return (
    <div>
      <div className={styles.editGrid}>
        <label><span className={styles.label}>שם</span><input className={styles.input} value={name} onChange={e => setName(e.target.value)} /></label>
        <label><span className={styles.label}>טלפון</span><input className={styles.input} dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label>
          <span className={styles.label}>דוא״ל</span>
          <input className={styles.input} dir="ltr" value={email} onChange={e => setEmail(e.target.value)} list={`em-${r.id}`} />
          <datalist id={`em-${r.id}`}>{r.emails.map(e => <option key={e} value={e} />)}</datalist>
        </label>
        <label><span className={styles.label}>אתר</span><input className={styles.input} dir="ltr" value={website} onChange={e => setWebsite(e.target.value)} /></label>
        <label>
          <span className={styles.label}>יישוב</span>
          <select className={styles.select} value={city} onChange={e => setCity(e.target.value)}>
            <option value="">{r.cityName && !r.citySlug ? `${r.cityName} (לא ברשימה)` : 'בחרו יישוב'}</option>
            {CITIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <span className={styles.label} style={{ marginTop: 10 }}>תחומים</span>
      <div className={styles.checks}>
        {CATEGORIES.map(c => (
          <label key={c.slug} className={styles.check}>
            <input type="checkbox" checked={cats.includes(c.slug)} onChange={() => setCats(cats.includes(c.slug) ? cats.filter(x => x !== c.slug) : [...cats, c.slug])} />
            {c.name}
          </label>
        ))}
      </div>
      <div className={styles.btnRow} style={{ marginTop: 10 }}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={save}>{pending ? 'שומרים…' : 'שמירה ובדיקה מחדש'}</button>
      </div>
    </div>
  );
}

type Done = { ok: boolean; text: string; href?: string; name: string };

function Record({ r, onDone, selected, onSelect, google }: { r: ReviewRow; onDone: (d: Done) => void; selected: boolean; onSelect: () => void; google: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const blocked = r.reasons.some(x => (BLOCKING as readonly string[]).includes(x));
  const open = r.status === 'ready' || r.status === 'needs_review';
  const decided = ['approved', 'merged'].includes(r.status);

  const run = (input: Parameters<typeof placeAction>[1], okText: string) =>
    start(async () => {
      const res = await placeAction(r.id, input);
      if (res.ok) {
        // The record usually leaves this tab after a decision, so the confirmation lives on the list.
        const href = res.slug && r.regionSlug ? `/${r.regionSlug}/biz/${res.slug}` : undefined;
        onDone({ ok: true, text: okText, href, name: r.name });
        setResult(null);
      } else setResult({ ok: false, text: ERR[res.error] ?? 'הפעולה נכשלה' });
      router.refresh();
    });

  return (
    <article className={`${styles.card} ${styles.rec}`}>
      <div>
        <h2 className={styles.recName}>
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`בחירת ${r.name}`} className={styles.pick} />
          {r.googleMapsUri ? <a href={r.googleMapsUri} target="_blank" rel="noreferrer">{r.name}</a> : r.name}
        </h2>
        <div className={styles.note}>
          {r.address}
          {r.cityName ? ` · ${r.cityName}` : ''}
          {r.regionSlug ? ` · ${regionName(r.regionSlug)}` : ''}
          {r.googleRating ? <> · Google <span className={styles.ltr}>★{r.googleRating.toFixed(1)} ({r.googleReviewCount ?? 0} ביקורות)</span></> : <> · Google: אין ביקורות</>}
          {' · '}מקור: {PROVIDER[r.provider] ?? r.provider}
        </div>
        <div className={styles.reasons}>
          {r.categories.map(c => <span key={c} className={`${styles.chip} ${styles.chipOk}`}>{catName(c)}</span>)}
          {r.businessType ? <span className={styles.chip}>{TYPE_NAME[r.businessType]}</span> : null}
          {r.reasons.map(x => (
            <span key={x} className={`${styles.chip} ${(BLOCKING as readonly string[]).includes(x) ? styles.chipBad : styles.chipWarn}`}>{REASON_NAMES[x] ?? x}</span>
          ))}
        </div>
        <p className={styles.note} style={{ marginTop: 6 }}>
          שלמות הכרטיס: <span className={styles.ltr}>{r.template.score}%</span>
          {r.template.missing.length ? <> · חסר: {r.template.missing.map(m => m.label).join(', ')}</> : ' · הכול מלא'}
        </p>
        <dl className={styles.meta}>
          <div><dt>טלפון: </dt><dd className={styles.ltr}>{r.phone ? formatIlPhone(r.phone) : r.phoneRaw ? `${r.phoneRaw} (לא תקין)` : 'אין'}</dd></div>
          {r.whatsapp ? <div><dt>וואטסאפ: </dt><dd className={styles.ltr}>{formatIlPhone(r.whatsapp)}</dd></div> : null}
          <div>
            <dt>דוא״ל: </dt>
            <dd>
              {r.email ? <span className={styles.ltr}>{r.email}</span> : 'לא נמצא'}
              {r.email ? <span className={styles.note}> · {EMAIL_SRC[r.emailSource ?? ''] ?? 'מהאתר'}{r.emailStatus ? ` · ${EMAIL_STATUS[r.emailStatus] ?? r.emailStatus}` : r.emailMx === false ? ' · הדומיין לא מקבל דואר' : r.emailMx ? ' · הדומיין תקין' : ''}</span> : null}
              {r.agencyEmails.length ? <span className={styles.note}> · הושמט דוא״ל של בונה האתר</span> : null}
              {r.emails.length > 1 ? <span className={styles.note}> · עוד {r.emails.length - 1} באתר</span> : null}
            </dd>
          </div>
          <div>
            <dt>אתר: </dt>
            <dd>
              {r.website ? <a href={r.website} target="_blank" rel="noreferrer" className={styles.ltr}>{r.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</a> : 'אין'}
              {r.website && r.websiteKind ? <span className={styles.note}> · {KIND_NAME[r.websiteKind] ?? r.websiteKind}</span> : null}
              {r.viaLinkhub ? <span className={styles.note}> · נמצא דרך דף הקישורים</span> : null}
              {r.crawlSkipped !== 'no_website' ? <span className={styles.note}> · {r.crawlSkipped ? SKIP_NAME[r.crawlSkipped] ?? r.crawlSkipped : `${r.pagesRead} עמודים נקראו${r.rendered ? `, ${r.rendered} בדפדפן` : ''}`}</span> : null}
            </dd>
          </div>
          {r.facebook ? (
            <div>
              <dt>פייסבוק: </dt>
              <dd>
                <a href={r.facebook} target="_blank" rel="noreferrer" className={styles.ltr}>{r.facebook.replace(/^https:\/\/(www\.)?facebook\.com\//, '')}</a>
              </dd>
            </div>
          ) : null}
          {r.instagram ? <div><dt>אינסטגרם: </dt><dd><a href={r.instagram} target="_blank" rel="noreferrer" className={styles.ltr}>{r.instagram.replace(/^https:\/\/www\.instagram\.com\//, '@')}</a></dd></div> : null}
        </dl>
        {r.rejectedWebsite ? <p className={styles.note}>קישור שלא נשמר כאתר: <span className={styles.ltr}>{r.rejectedWebsite.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</span></p> : null}
        {r.bookingUrl ? <p className={styles.note}>הזמנת תור: <a href={r.bookingUrl} target="_blank" rel="noreferrer" className={styles.ltr}>{r.bookingUrl.replace(/^https?:\/\//, '').slice(0, 50)}</a></p> : null}
        {r.conflicts.length ? <p className={`${styles.result} ${styles.resultBad}`}>סתירה בין המקורות: {r.conflicts.map(c => (c === 'phone' ? 'טלפון' : 'שעות')).join(', ')}. ראו ראיות.</p> : null}
        {r.description ? <p className={styles.desc}>{r.description}</p> : null}
        {r.extractError ? <p className={styles.note}>שגיאת חילוץ: <span className={styles.ltr}>{r.extractError}</span></p> : null}
        {r.note ? <p className={styles.note}>הערה: {r.note}</p> : null}
      </div>

      <div className={styles.stack}>
        {r.match && !decided ? (
          <div className={styles.panel}>
            <p>
              ייתכן שכבר קיים באתר: <Link href={r.match.href} target="_blank">{r.match.name}</Link> ({r.match.city})
            </p>
            <p className={styles.note}>{r.match.reasons.map(x => MATCH_WHY[x] ?? x).join(' · ')}</p>
            <button type="button" className={`${styles.btn} ${styles.teal}`} disabled={pending} onClick={() => run({ op: 'merge', branchId: r.match!.id }, 'מוזג לדף הקיים')}>
              מיזוג לדף הקיים
            </button>
          </div>
        ) : null}
        {r.dup && !decided ? (
          <div className={styles.panel}>
            <p>{r.status === 'duplicate' ? 'כפול של' : 'ייתכן שכפול של'}: {r.dup.name}, {r.dup.address}</p>
            <p className={styles.note}>{r.dup.reasons.map(x => MATCH_WHY[x] ?? x).join(' · ')}</p>
            {r.status !== 'duplicate' ? (
              <button type="button" className={styles.btn} disabled={pending} onClick={() => run({ op: 'duplicate', ofId: r.dup!.id }, 'סומן ככפול')}>סימון ככפול</button>
            ) : null}
          </div>
        ) : null}

        {r.treatments.length ? (
          <div>
            <button type="button" className={styles.btn} onClick={() => setShowMenu(!showMenu)} aria-expanded={showMenu}>
              {showMenu ? 'הסתרת' : 'הצגת'} {r.treatments.length} טיפולים ({r.treatments.filter(t => t.priceNis).length} עם מחיר)
            </button>
            {showMenu ? (
              <ul className={styles.treats}>
                {r.treatments.map((t, i) => (
                  <li key={i}>
                    <span title={(t as { sourceText?: string }).sourceText}>{t.name}{t.category ? ` · ${catName(t.category)}` : ''}{t.isMedical ? ' · רפואי' : ''}</span>
                    <span className={styles.ltr}>{t.priceNis ? `${t.priceType === 'from' ? 'מ־' : ''}₪${t.priceNis}` : 'ללא מחיר'}</span>
                    <span>{t.durationMin ? `${t.durationMin} דק׳` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : <p className={styles.note}>לא נמצא תפריט טיפולים.</p>}

        {!decided && (r.imageCandidates.logos.length || r.imageCandidates.photos.length) ? <Images r={r} /> : null}
        {decided ? null : !r.imageCandidates.logos.length && !r.imageCandidates.photos.length ? <p className={styles.note}>לא נמצאו לוגו או תמונות באתר העסק.</p> : null}

        <div>
          <button type="button" className={styles.btn} onClick={() => setShowEvidence(!showEvidence)} aria-expanded={showEvidence}>
            {showEvidence ? 'הסתרת ראיות' : `ראיות ומקורות (${r.observations.length})`}
          </button>
          {showEvidence ? <Evidence r={r} /> : null}
        </div>
        {google && r.placeId && !decided ? <GoogleView placeId={r.placeId} /> : null}

        {r.created ? <p className={styles.note}>דף באתר: <Link href={r.created.href} target="_blank">{r.created.name}</Link></p> : null}

        <div className={styles.btnRow}>
          {open ? (
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending || blocked} onClick={() => run({ op: 'approve' }, 'פורסם באתר')}>
              אישור ופרסום
            </button>
          ) : null}
          {!decided ? <button type="button" className={styles.btn} onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? 'סגירת עריכה' : 'עריכה'}</button> : null}
          {!decided && r.status !== 'rejected' ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.danger}`}
              disabled={pending}
              onClick={() => {
                const note = prompt('סיבת הדחייה (לא חובה)');
                if (note !== null) run({ op: 'reject', note: note || null }, 'נדחה');
              }}
            >
              דחייה
            </button>
          ) : null}
          {['rejected', 'duplicate', 'closed'].includes(r.status) ? (
            <button type="button" className={styles.btn} disabled={pending} onClick={() => run({ op: 'restore' }, 'הוחזר לתור')}>החזרה לתור</button>
          ) : null}
        </div>
        {result ? (
          <p className={`${styles.result} ${result.ok ? styles.resultOk : styles.resultBad}`} role="status">
            {result.text}
            {result.href ? <> · <Link href={result.href} target="_blank">לדף העסק</Link></> : null}
          </p>
        ) : null}
        {editing ? (
          <Edit
            r={r}
            onDone={(text, ok) => {
              if (ok) {
                onDone({ ok, text, name: r.name });
                setEditing(false);
                setResult(null);
              } else setResult({ ok, text });
              router.refresh();
            }}
          />
        ) : null}
      </div>
    </article>
  );
}

export function ReviewList({ rows, tab, bulk, runId, readyInRun, google }: { rows: ReviewRow[]; tab: string; bulk: boolean; runId: string | null; readyInRun: number; google: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Done[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const log = (d: Done) => setDone(list => [d, ...list].slice(0, 6));
  const toggle = (id: string) => setPicked(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const recent = done.length ? (
    <div className={`${styles.card} ${styles.stack}`} role="status" aria-live="polite" style={{ gap: 4 }}>
      {done.map((d, i) => (
        <p key={i} className={`${styles.result} ${d.ok ? styles.resultOk : styles.resultBad}`} style={{ margin: 0 }}>
          {d.name}: {d.text}
          {d.href ? <> · <Link href={d.href} target="_blank">לדף העסק</Link></> : null}
        </p>
      ))}
    </div>
  ) : null;
  if (!rows.length) return <div className={styles.stack}>{recent}<p className={`${styles.card} ${styles.empty}`}>אין רשומות במצב הזה.</p></div>;
  const approveAll = () => {
    if (!confirm(`לפרסם ${rows.length} עסקים מהעמוד הזה? רק רשומות במצב ״מוכן״ יפורסמו.`)) return;
    start(async () => {
      const r = await bulkApproveAction(rows.map(x => x.id));
      log({ ok: r.ok, name: 'אישור מרוכז', text: r.ok ? `פורסמו ${r.approved} עסקים${r.skipped ? `, ${r.skipped} דולגו` : ''}` : 'הפעולה נכשלה' });
      router.refresh();
    });
  };
  const publishRun = () => {
    if (!runId || !confirm(`לפרסם את כל ${readyInRun} הרשומות המוכנות בריצה הזו? רשומות ״לבדיקה״ לא יפורסמו.`)) return;
    start(async () => {
      const r = await publishEligibleAction(runId);
      log({ ok: r.ok, name: 'פרסום הריצה', text: r.ok ? `פורסמו ${r.approved} עסקים${r.left ? `, נשארו ${r.left} (הפעילו שוב)` : ''}` : 'הפעולה נכשלה' });
      router.refresh();
    });
  };
  const enhancePicked = (refresh: boolean) =>
    start(async () => {
      const r = await enhanceApprovedAction([...picked], refresh);
      log({ ok: r.ok, name: 'העשרת עסקים שפורסמו', text: r.ok ? (r.count ? `${r.count} עסקים נשלחו להעשרה${r.dispatched === false ? ' (העובד לא הופעל, הפעילו אותו מדף הריצות)' : ''}` : 'אין בבחירה עסקים שפורסמו ולא נתבעו') : 'הפעולה נכשלה' });
      setPicked(new Set());
      router.refresh();
    });
  const enrichPicked = () =>
    start(async () => {
      const r = await enrichSelectedAction([...picked]);
      log({ ok: r.ok, name: 'העשרה מהאתר', text: r.ok ? `${r.count} רשומות נשלחו לבדיקה חוזרת${r.dispatched === false ? ' (העובד לא הופעל, הפעילו אותו מדף הריצות)' : ''}` : 'הפעולה נכשלה' });
      setPicked(new Set());
      router.refresh();
    });
  return (
    <div className={styles.stack}>
      {recent}
      <div className={styles.btnRow}>
        <button type="button" className={styles.btn} onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))}>
          {picked.size === rows.length ? 'ניקוי הבחירה' : 'בחירת כל העמוד'}
        </button>
        {tab === 'done' ? (
          <>
            <button type="button" className={styles.btn} disabled={pending || !picked.size} onClick={() => enhancePicked(false)}>
              {`העשרת הכרטיסים מהאתר (${picked.size})`}
            </button>
            <button type="button" className={styles.btn} disabled={pending || !picked.size} onClick={() => enhancePicked(true)}>
              {`העשרה עם רענון מ־DataForSEO (${picked.size})`}
            </button>
          </>
        ) : (
          <button type="button" className={styles.btn} disabled={pending || !picked.size} onClick={enrichPicked}>
            {`בדיקה חוזרת של האתר (${picked.size})`}
          </button>
        )}
        {bulk ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={approveAll}>
            {pending ? 'מפרסמים…' : `אישור ופרסום של ${rows.length} המוכנים בעמוד`}
          </button>
        ) : null}
        {bulk && runId && readyInRun > rows.length ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={publishRun}>
            {`פרסום כל ${readyInRun} המוכנים בריצה`}
          </button>
        ) : null}
      </div>
      {rows.map(r => <Record key={r.id} r={r} onDone={log} selected={picked.has(r.id)} onSelect={() => toggle(r.id)} google={google} />)}
    </div>
  );
}
