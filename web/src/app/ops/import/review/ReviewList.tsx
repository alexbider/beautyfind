'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CATEGORIES, CITIES, REGIONS } from '@/lib/catalog';
import { formatIlPhone } from '@/lib/import/phone';
import { BLOCKING, REASON_NAMES, type ImportedTreatment } from '@/lib/import/rules';
import { bulkApproveAction, placeAction } from '../actions';
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
  sources: Record<string, string>;
  facebook: string | null;
  note: string | null;
  match: { id: string; name: string; href: string; city: string; score: number; reasons: string[] } | null;
  dup: { id: string; name: string; address: string; status: string; reasons: string[] } | null;
  created: { name: string; href: string } | null;
}

const MATCH_WHY: Record<string, string> = {
  same_place_id: 'אותו מקום בגוגל', same_phone: 'אותו טלפון', same_email: 'אותו דוא״ל', same_website: 'אותו אתר', same_name: 'אותו שם',
  similar_name: 'שם דומה', same_address: 'אותה כתובת', nearby: 'קרוב מאוד', far_apart: 'רחוקים זה מזה',
};
const TYPE_NAME: Record<string, string> = { clinic: 'קליניקה רפואית', medspa: 'קוסמטיקה ורפואה', cosmetics: 'קוסמטיקה', salon: 'סלון' };
const SKIP_NAME: Record<string, string> = {
  no_website: 'אין אתר', social: 'רק רשת חברתית', robots: 'האתר חוסם סריקה ב־robots.txt', unreachable: 'האתר לא נטען', blocked: 'האתר חסם את הגישה', off_topic: 'לא עסק יופי',
};
const EMAIL_SRC: Record<string, string> = { manual: 'הוזן ידנית', site: 'מהאתר', social: 'מדף הפייסבוק או האינסטגרם', search: 'מחיפוש ברשת' };
const SOCIAL_STATUS: Record<string, string> = { ok: 'נקרא', login_wall: 'דורש התחברות', disabled: 'כבוי', no_browser: 'אין דפדפן' };
const ERR: Record<string, string> = {
  incomplete: 'חסרים פרטי חובה', exists: 'המקום כבר קיים באתר', state: 'הרשומה כבר טופלה', not_found: 'הרשומה לא נמצאה', phone: 'מספר טלפון לא תקין',
  email: 'כתובת דוא״ל לא תקינה', email_mx: 'הדומיין של הדוא״ל לא מקבל דואר', name: 'חסר שם', city: 'יישוב לא מוכר', forbidden: 'אין הרשאה', invalid: 'נתונים לא תקינים',
  no_branch: 'הדף הקיים לא נמצא',
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

function Record({ r, onDone }: { r: ReviewRow; onDone: (d: Done) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
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
        <h2 className={styles.recName}>{r.googleMapsUri ? <a href={r.googleMapsUri} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</h2>
        <div className={styles.note}>
          {r.address}
          {r.cityName ? ` · ${r.cityName}` : ''}
          {r.regionSlug ? ` · ${regionName(r.regionSlug)}` : ''}
          {r.googleRating ? <> · Google <span className={styles.ltr}>{r.googleRating.toFixed(1)} ({r.googleReviewCount ?? 0})</span></> : null}
        </div>
        <div className={styles.reasons}>
          {r.categories.map(c => <span key={c} className={`${styles.chip} ${styles.chipOk}`}>{catName(c)}</span>)}
          {r.businessType ? <span className={styles.chip}>{TYPE_NAME[r.businessType]}</span> : null}
          {r.reasons.map(x => (
            <span key={x} className={`${styles.chip} ${(BLOCKING as readonly string[]).includes(x) ? styles.chipBad : styles.chipWarn}`}>{REASON_NAMES[x] ?? x}</span>
          ))}
        </div>
        <dl className={styles.meta}>
          <div><dt>טלפון: </dt><dd className={styles.ltr}>{r.phone ? formatIlPhone(r.phone) : r.phoneRaw ? `${r.phoneRaw} (לא תקין)` : 'אין'}</dd></div>
          {r.whatsapp ? <div><dt>וואטסאפ: </dt><dd className={styles.ltr}>{formatIlPhone(r.whatsapp)}</dd></div> : null}
          <div>
            <dt>דוא״ל: </dt>
            <dd>
              {r.email ? <span className={styles.ltr}>{r.email}</span> : 'לא נמצא'}
              {r.email ? <span className={styles.note}> · {EMAIL_SRC[r.emailSource ?? ''] ?? 'מהאתר'}{r.emailMx === false ? ' · הדומיין לא מקבל דואר' : r.emailMx ? ' · הדומיין תקין' : ''}</span> : null}
              {r.emails.length > 1 ? <span className={styles.note}> · עוד {r.emails.length - 1} באתר</span> : null}
            </dd>
          </div>
          <div>
            <dt>אתר: </dt>
            <dd>
              {r.website ? <a href={r.website} target="_blank" rel="noreferrer" className={styles.ltr}>{r.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</a> : 'אין'}
              {r.crawlSkipped !== 'no_website' ? <span className={styles.note}> · {r.crawlSkipped ? SKIP_NAME[r.crawlSkipped] ?? r.crawlSkipped : `${r.pagesRead} עמודים נקראו${r.rendered ? `, ${r.rendered} בדפדפן` : ''}`}</span> : null}
            </dd>
          </div>
          {r.facebook ? (
            <div>
              <dt>פייסבוק: </dt>
              <dd>
                <a href={r.facebook} target="_blank" rel="noreferrer" className={styles.ltr}>{r.facebook.replace(/^https:\/\/(www\.)?facebook\.com\//, '')}</a>
                {r.sources.facebook ? <span className={styles.note}> · {SOCIAL_STATUS[r.sources.facebook] ?? r.sources.facebook}</span> : null}
              </dd>
            </div>
          ) : null}
          {r.instagram ? <div><dt>אינסטגרם: </dt><dd><a href={r.instagram} target="_blank" rel="noreferrer" className={styles.ltr}>{r.instagram.replace(/^https:\/\/www\.instagram\.com\//, '@')}</a></dd></div> : null}
        </dl>
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
              {showMenu ? 'הסתרת' : 'הצגת'} {r.treatments.length} טיפולים
            </button>
            {showMenu ? (
              <ul className={styles.treats}>
                {r.treatments.map((t, i) => (
                  <li key={i}>
                    <span>{t.name}{t.isMedical ? ' · רפואי' : ''}</span>
                    <span className={styles.ltr}>{t.priceNis ? `${t.priceType === 'from' ? 'מ־' : ''}₪${t.priceNis}` : 'ללא מחיר'}</span>
                    <span>{t.durationMin ? `${t.durationMin} דק׳` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : <p className={styles.note}>לא נמצא תפריט טיפולים.</p>}

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

export function ReviewList({ rows, bulk }: { rows: ReviewRow[]; bulk: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Done[]>([]);
  const log = (d: Done) => setDone(list => [d, ...list].slice(0, 6));
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
  return (
    <div className={styles.stack}>
      {recent}
      {bulk ? (
        <div className={styles.btnRow}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={approveAll}>
            {pending ? 'מפרסמים…' : `אישור ופרסום של ${rows.length} המוכנים בעמוד`}
          </button>
        </div>
      ) : null}
      {rows.map(r => <Record key={r.id} r={r} onDone={log} />)}
    </div>
  );
}
