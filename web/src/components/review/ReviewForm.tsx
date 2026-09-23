'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ROUTES } from '@/lib/routes';
import { CheckIcon, ReviewDone } from './ReviewParts';
import {
  ASPECTS,
  BODY_MAX,
  BODY_MIN,
  DECLARATIONS,
  NAME_MODES,
  NAME_MODE_NOTES,
  PHOTO_MAX_BYTES,
  PHOTO_SLOTS,
  PHOTO_TYPES,
  RATING_LABELS,
  RULES,
  SUBMIT_ERRORS,
  TAGS,
  TITLE_MAX,
  checkReview,
  nameModeLabel,
  type AspectKey,
  type NameMode,
  type PhotoKind,
  type ReviewInput,
  type SubmitError,
  type SubmittedSummary,
} from './shared';
import styles from './Review.module.css';

// Design: project/BeautyFind Review.dc.html. Submits multipart to /review/[token]/submit.

export type ReviewVisit = {
  branch: string; // "ביוטי לאב · חיפה"
  treatment: string;
  practitioner: string | null;
  date: string; // dd/mm/yyyy
  ref: string;
  clientName: string;
};

type Draft = Pick<ReviewInput, 'rating' | 'aspects' | 'title' | 'body' | 'tags' | 'nameMode'>;
type Photo = { file: File; url: string };

export function ReviewForm({ token, visit, profileHref }: { token: string; visit: ReviewVisit; profileHref: string }) {
  const draftKey = `bf-review-draft:${visit.ref}`;
  const [rating, setRating] = useState(0);
  const [aspects, setAspects] = useState<Partial<Record<AspectKey, number>>>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [nameMode, setNameMode] = useState<NameMode>('initial');
  const [photoConsent, setPhotoConsent] = useState(false);
  const [decl, setDecl] = useState({ real: false, nointerest: false });
  const [photos, setPhotos] = useState<Partial<Record<PhotoKind, Photo>>>({});
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<SubmittedSummary | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const flash = (t: string) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  // Restore a draft saved on this device (per booking). Photos and declarations are never kept.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<Draft>;
      if (typeof d.rating === 'number') setRating(d.rating);
      if (d.aspects && typeof d.aspects === 'object') setAspects(d.aspects);
      if (typeof d.title === 'string') setTitle(d.title);
      if (typeof d.body === 'string') setBody(d.body);
      if (Array.isArray(d.tags)) setTags(d.tags.filter(t => (TAGS as readonly string[]).includes(t)));
      if (d.nameMode && NAME_MODES.includes(d.nameMode)) setNameMode(d.nameMode);
    } catch {
      /* storage unavailable */
    }
  }, [draftKey]);

  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      Object.values(photosRef.current).forEach(p => p && URL.revokeObjectURL(p.url));
    },
    [],
  );

  const input: ReviewInput = { rating, aspects, title, body, tags, nameMode, photoConsent, declarations: decl };
  const bad = checkReview(input);
  const error = tried && bad ? bad.error : serverErr;
  const bodyLen = body.trim().length;
  const titleBad = tried && bad?.field === 'title';
  const bodyBad = tried && bodyLen < BODY_MIN;
  const declBad = tried && !(decl.real && decl.nointerest);
  const ratingBad = tried && !rating;

  const lenClass = bodyLen === 0 ? styles.lenNone : bodyLen < BODY_MIN ? styles.lenShort : bodyLen < 120 ? styles.lenOk : styles.lenGreat;
  const ratingClass = !rating ? (tried ? styles.ratingBad : '') : rating >= 4 ? styles.ratingGood : rating === 3 ? styles.ratingMid : styles.ratingLow;

  const pickPhoto = (kind: PhotoKind, file: File | undefined) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return flash(SUBMIT_ERRORS.photo_type);
    if (file.size > PHOTO_MAX_BYTES) return flash(SUBMIT_ERRORS.photo_size);
    setPhotos(p => {
      if (p[kind]) URL.revokeObjectURL(p[kind]!.url);
      return { ...p, [kind]: { file, url: URL.createObjectURL(file) } };
    });
  };
  const dropPhoto = (kind: PhotoKind) =>
    setPhotos(p => {
      if (p[kind]) URL.revokeObjectURL(p[kind]!.url);
      const n = { ...p };
      delete n[kind];
      return n;
    });

  const saveDraft = () => {
    try {
      const d: Draft = { rating, aspects, title, body, tags, nameMode };
      localStorage.setItem(draftKey, JSON.stringify(d));
      flash('הטיוטה נשמרה במכשיר הזה');
    } catch {
      flash('לא הצלחנו לשמור טיוטה בדפדפן הזה');
    }
  };

  const submit = async () => {
    setServerErr(null);
    if (bad) {
      setTried(true);
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    setSending(true);
    const fd = new FormData();
    fd.set('data', JSON.stringify(input));
    for (const s of PHOTO_SLOTS) {
      const p = photos[s.kind];
      if (p) fd.set(`photo_${s.kind}`, p.file);
    }
    let res: { ok: true; summary: SubmittedSummary } | { ok: false; error: SubmitError; message?: string };
    try {
      const r = await fetch(`/review/${token}/submit`, { method: 'POST', body: fd });
      res = await r.json();
    } catch {
      res = { ok: false, error: 'server' };
    }
    setSending(false);
    if (!res.ok) {
      setServerErr(res.message ?? SUBMIT_ERRORS[res.error] ?? SUBMIT_ERRORS.server);
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setDone(res.summary);
    flash('הביקורת נשלחה לבדיקה');
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => doneRef.current?.focus());
  };

  const toastEl = (
    <div role="status" aria-live="polite">
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );

  if (done) {
    return (
      <div>
        {toastEl}
        <ReviewDone summary={done} clientName={visit.clientName} profileHref={profileHref} headingRef={doneRef} />
      </div>
    );
  }

  return (
    <div>
      {toastEl}
      <div className={styles.fade}>
        <h1 className={styles.h1}>איך היה הטיפול?</h1>
        <p className={styles.lead}>הביקורת שלכם עוזרת ללקוחות הבאות לבחור נכון. אפשר לכתוב רק על טיפול שהיה בפועל: הביקור שלכם אומת מול היומן של הקליניקה.</p>

        <div className={styles.shell}>
          <div className={styles.main}>
            <section aria-labelledby="rv-h1" className={styles.card}>
              <h2 id="rv-h1" className={styles.h2}>
                דירוג כללי
              </h2>
              <div dir="ltr" role="radiogroup" aria-labelledby="rv-h1" aria-required="true" aria-invalid={ratingBad || undefined} className={styles.stars}>
                {[1, 2, 3, 4, 5].map(n => (
                  <label key={n} className={`${styles.star} ${n <= rating ? styles.starOn : ''} ${ratingBad ? styles.starBad : ''}`}>
                    <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className={styles.radio} aria-label={`${n} מתוך 5`} />
                    <span aria-hidden="true">★</span>
                  </label>
                ))}
              </div>
              <p className={`${styles.ratingLabel} ${ratingClass}`}>{rating ? RATING_LABELS[rating] : 'בחרו דירוג (חובה)'}</p>

              <h3 className={styles.h3}>מה בלט בטיפול?</h3>
              <div className={styles.aspects}>
                {ASPECTS.map(a => {
                  const val = aspects[a.key] ?? 0;
                  return (
                    <fieldset key={a.key} className={`${styles.aspect} ${val ? styles.aspectOn : ''}`}>
                      <legend className={styles.aspectName}>{a.name}</legend>
                      <div dir="ltr" className={styles.aStars}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <label key={n} className={`${styles.aStar} ${n <= val ? styles.aStarOn : ''}`}>
                            <input
                              type="radio"
                              name={`aspect-${a.key}`}
                              value={n}
                              checked={val === n}
                              onChange={() => setAspects(s => ({ ...s, [a.key]: n }))}
                              className={styles.radio}
                              aria-label={`${a.name} ${n} מתוך 5`}
                            />
                            <span aria-hidden="true">★</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="rv-h2" className={styles.card}>
              <h2 id="rv-h2" className={`${styles.h2} ${styles.h2Tight}`}>
                הביקורת שלכם
              </h2>
              <p className={styles.sub}>ספרו מה עשו, איך הרגשתם ומה הייתם רוצות לדעת מראש. אין צורך בשמות של אנשי צוות בהקשר שלילי. אנחנו לא מפרסמים אותם.</p>

              <label className={styles.field}>
                כותרת
                <input
                  className={`${styles.input} ${titleBad ? styles.inputBad : ''}`}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="למשל: ייעוץ כנה בלי לחץ למכור"
                  maxLength={TITLE_MAX}
                  aria-invalid={titleBad || undefined}
                />
              </label>
              <label className={styles.field}>
                מה חשוב לדעת
                <textarea
                  className={`${styles.textarea} ${bodyBad ? styles.inputBad : ''}`}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={6}
                  maxLength={BODY_MAX}
                  placeholder="הגעתי לייעוץ, הוסבר לי מה מתאים ומה לא, ולא לחצו עליי לקבוע טיפול באותו יום."
                  aria-invalid={bodyBad || undefined}
                  aria-describedby="rv-len"
                />
              </label>
              <div className={styles.meter}>
                <span aria-hidden="true" className={styles.meterBar}>
                  <span className={`${styles.meterFill} ${lenClass}`} style={{ width: `${Math.min(100, bodyLen / 2)}%` }} />
                </span>
                <span id="rv-len" dir="ltr" className={`ltr ${styles.meterText} ${lenClass}`}>
                  {bodyLen < BODY_MIN ? `${bodyLen} / ${BODY_MIN} תווים` : `${bodyLen} תווים`}
                </span>
              </div>

              <h3 id="rv-h2b" className={styles.h3}>
                מה מתאר את הביקור?
              </h3>
              <div className={styles.tags} role="group" aria-labelledby="rv-h2b">
                {TAGS.map(t => {
                  const on = tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      className={`${styles.tag} ${on ? styles.tagOn : ''}`}
                      onClick={() => setTags(v => (on ? v.filter(x => x !== t) : [...v, t]))}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="rv-h3" className={styles.card}>
              <h2 id="rv-h3" className={`${styles.h2} ${styles.h2Tight}`}>
                תמונות <span className={styles.h2Note}>· לא חובה</span>
              </h2>
              <p className={styles.sub}>תמונות לפני/אחרי מתפרסמות רק באישור מפורש שלכם, ותמיד בלי פרטים מזהים. אפשר לבקש הסרה בכל זמן.</p>
              <div className={styles.photos}>
                {PHOTO_SLOTS.map(s => {
                  const p = photos[s.kind];
                  return (
                    <div key={s.kind} className={styles.photo}>
                      <span className={styles.photoLabel} id={`rv-ph-${s.kind}`}>
                        {s.label}
                      </span>
                      <div className={styles.slot}>
                        {p ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) */}
                            <img src={p.url} alt={`תמונת ${s.label} שנבחרה`} className={styles.slotImg} />
                            <button type="button" className={styles.slotRemove} onClick={() => dropPhoto(s.kind)} aria-label={`הסרת תמונת ${s.label}`}>
                              <span aria-hidden="true">×</span>
                            </button>
                          </>
                        ) : (
                          <label className={styles.slotPick}>
                            <input
                              type="file"
                              accept={PHOTO_TYPES.join(',')}
                              className={styles.radio}
                              aria-labelledby={`rv-ph-${s.kind}`}
                              onChange={e => {
                                pickPhoto(s.kind, e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            <span>{s.placeholder}</span>
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <label className={`${styles.consent} ${photoConsent ? styles.optionOn : ''}`}>
                <input type="checkbox" checked={photoConsent} onChange={e => setPhotoConsent(e.target.checked)} className={styles.radio} />
                <span aria-hidden="true" className={`${styles.box} ${photoConsent ? styles.boxOn : ''}`}>
                  {photoConsent && <CheckIcon />}
                </span>
                <span className={styles.optText}>
                  <span className={styles.consentName}>אני מאשרת פרסום התמונות בפרופיל הקליניקה</span>
                  <span className={styles.optNote}>ללא אישור התמונות נשמרות בביקורת אך לא מתפרסמות</span>
                </span>
              </label>
            </section>

            <section aria-labelledby="rv-h4" className={styles.card}>
              <h2 id="rv-h4" className={styles.h2}>
                איך לפרסם
              </h2>
              <fieldset className={styles.options}>
                <legend className="sr-only">איך יופיע השם</legend>
                {NAME_MODES.map(m => {
                  const on = nameMode === m;
                  return (
                    <label key={m} className={`${styles.option} ${on ? styles.optionOn : ''}`}>
                      <input type="radio" name="nameMode" value={m} checked={on} onChange={() => setNameMode(m)} className={styles.radio} />
                      <span aria-hidden="true" className={`${styles.dot} ${on ? styles.dotOn : ''}`} />
                      <span className={styles.optText}>
                        <span className={styles.optName}>{nameModeLabel(m, visit.clientName)}</span>
                        <span className={styles.optNote}>{NAME_MODE_NOTES[m]}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <ul className={styles.decls}>
                {DECLARATIONS.map(d => {
                  const on = decl[d.key];
                  return (
                    <li key={d.key}>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={e => setDecl(s => ({ ...s, [d.key]: e.target.checked }))}
                          className={styles.radio}
                          aria-invalid={(declBad && !on) || undefined}
                        />
                        <span aria-hidden="true" className={`${styles.box} ${on ? styles.boxOn : declBad ? styles.boxBad : ''}`}>
                          {on && <CheckIcon />}
                        </span>
                        <span className={styles.optText}>
                          <span className={styles.checkLabel}>{d.label}</span>
                          <span className={styles.checkNote}>{d.note}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>

            {error && (
              <p role="alert" ref={errRef} tabIndex={-1} className={styles.alert}>
                {error}
              </p>
            )}

            <div className={styles.submitRow}>
              <button type="button" className={styles.submit} onClick={submit} disabled={sending}>
                {sending ? 'שולחת…' : 'שליחת הביקורת'}
              </button>
              <button type="button" className={styles.draft} onClick={saveDraft}>
                שמירה כטיוטה
              </button>
            </div>
            <p className={styles.fine}>
              הביקורת נבדקת לפני פרסום, בדרך כלל בתוך <span dir="ltr" className="ltr">6</span> שעות. לא נפרסם ביקורת שכוללת האשמה פלילית ללא אסמכתה, ולא נמחק ביקורת רק מפני שהיא שלילית.
            </p>
          </div>

          <aside className={styles.aside} aria-label="הביקור">
            <div className={styles.verified}>
              <div className={styles.verifiedHead}>
                <span aria-hidden="true" className={styles.verifiedIcon}>
                  <CheckIcon size={14} />
                </span>
                <span className={styles.verifiedTitle}>הביקור אומת</span>
              </div>
              <dl className={styles.dl}>
                <dt>קליניקה</dt>
                <dd className={styles.strong}>{visit.branch}</dd>
                <dt>טיפול</dt>
                <dd>{visit.treatment}</dd>
                {visit.practitioner && (
                  <>
                    <dt>מטפלת</dt>
                    <dd>{visit.practitioner}</dd>
                  </>
                )}
                <dt>תאריך</dt>
                <dd>
                  <span dir="ltr" className={`ltr ${styles.num}`}>
                    {visit.date}
                  </span>
                </dd>
                <dt>אסמכתא</dt>
                <dd>
                  <span dir="ltr" className={`ltr ${styles.num}`}>
                    {visit.ref}
                  </span>
                </dd>
              </dl>
            </div>

            <div className={styles.rulesCard}>
              <h2 className={styles.rulesH}>מה מתפרסם ומה לא</h2>
              <ul className={styles.rules}>
                {RULES.map(r => (
                  <li key={r.text} className={styles.rule}>
                    <span aria-hidden="true" className={`${styles.mark} ${r.ok ? styles.markOk : styles.markNo}`}>
                      {r.ok ? '+' : '×'}
                    </span>
                    <span className={styles.ruleText}>
                      <span className="sr-only">{r.ok ? 'מתפרסם: ' : 'לא מתפרסם: '}</span>
                      {r.text}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.rulesFoot}>
                מלא הכללים ב־<Link href={ROUTES.listingStandards}>תקן הרישום</Link>.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
