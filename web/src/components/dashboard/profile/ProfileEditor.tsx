'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { saveProfile } from '@/app/biz/profile/actions';
import { CATEGORIES, categoryBySlug } from '@/lib/catalog';
import { ActionBar } from '../../shell/ActionBar';
import { haptic } from '../../shell/haptics';
import { revealFirstInvalid } from '../media';
import { ImageDrop } from './ImageDrop';
import {
  ABOUT_MAX, ABOUT_RECOMMENDED, DAY_NAMES, GAL_TAGS, MAX_GALLERY, validateProfile,
  type FieldKey, type GalleryItem, type HoursRow, type ProfileForm,
} from './shared';
import s from './ProfileEditor.module.css';

export interface Responsible {
  name: string;
  isDoctor: boolean;
  license: string | null;
  verified: boolean;
}

type FlagKey = 'accessible' | 'freeParking' | 'wazeOn' | 'onlineBooking';
const FLAGS: Array<{ key: FlagKey; name: string; note: string }> = [
  { key: 'accessible', name: 'נגישות לכיסא גלגלים', note: 'הצהרת נגישות מפורטת בפרופיל' },
  { key: 'freeParking', name: 'חניה בחינם', note: 'מוצג כתגית בכרטיס ובפרופיל' },
  { key: 'wazeOn', name: 'קישור Waze', note: 'מפחית שיחות של ״איך מגיעים״' },
  { key: 'onlineBooking', name: 'קביעת תור אונליין', note: 'כפתור בפרופיל הציבורי' },
];

export function ProfileEditor({
  initial,
  canEdit,
  cityName,
  responsible,
}: {
  initial: ProfileForm;
  canEdit: boolean;
  cityName: string;
  responsible: Responsible | null;
}) {
  const router = useRouter();
  const [base, setBase] = useState(initial);
  const [f, setF] = useState(initial);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [serverFieldErrs, setServerFieldErrs] = useState<Partial<Record<FieldKey, string>>>({});
  const [uploads, setUploads] = useState(0);
  const [pending, startTransition] = useTransition();
  const sectionRef = useRef<HTMLElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(base), [f, base]);
  const v = useMemo(() => validateProfile(f), [f]);
  const err = (k: FieldKey) => (tried ? v.errors[k] ?? serverFieldErrs[k] : undefined);
  const ro = !canEdit;

  // Leaving with unpublished changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Functional updates: upload callbacks resolve after later edits, so never patch from a stale `f`.
  const patch = (p: Partial<ProfileForm> | ((prev: ProfileForm) => Partial<ProfileForm>)) => {
    if (ro) return;
    setF(prev => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) }));
    setSaved(false);
    setServerErr('');
    setServerFieldErrs({});
  };
  const setHour = (i: number, p: Partial<HoursRow>) => patch(prev => ({ hours: prev.hours.map((h, n) => (n === i ? { ...h, ...p } : h)) }));
  const setGal = (i: number, p: Partial<GalleryItem>) => patch(prev => ({ gallery: prev.gallery.map((g, n) => (n === i ? { ...g, ...p } : g)) }));
  const onBusy = (b: boolean) => setUploads(n => Math.max(0, n + (b ? 1 : -1)));

  const toggleCat = (slug: string) => patch(prev => ({ cats: prev.cats.includes(slug) ? prev.cats.filter(c => c !== slug) : [...prev.cats, slug] }));
  const toggleFlag = (k: FlagKey) => patch({ [k]: !f[k] } as Partial<ProfileForm>);
  const toggleDay = (i: number) => {
    const h = f.hours[i];
    // Reopening a closed day starts from the usual hours rather than two empty boxes.
    setHour(i, h.closed ? { closed: false, open: h.open || '09:00', close: h.close || '19:00' } : { closed: true });
  };

  const focusFirstInvalid = () => {
    haptic('warning');
    revealFirstInvalid(sectionRef.current, '[aria-invalid="true"]');
  };

  const publish = () => {
    if (ro || pending || uploads > 0) return;
    setTried(true);
    if (!v.ok) return focusFirstInvalid();
    const snapshot = f;
    startTransition(async () => {
      const res = await saveProfile(snapshot);
      if (res.ok) {
        setBase(snapshot);
        setTried(false);
        setSaved(true);
        haptic('success');
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 4000);
        router.refresh();
      } else {
        setServerErr(res.error);
        setServerFieldErrs(res.errors ?? {});
        if (res.errors) focusFirstInvalid();
      }
    });
  };
  const reset = () => {
    setF(base);
    setTried(false);
    setServerErr('');
    setServerFieldErrs({});
  };

  const pickedMedical = f.cats.some(c => categoryBySlug(c)?.isMedical);
  const needsDoctor = pickedMedical && !responsible?.isDoctor;
  const withAlt = f.gallery.filter(g => g.alt.trim()).length;
  const gaps = [
    !f.wazeOn && 'קישור Waze חסר',
    !f.onlineBooking && 'קביעת תור אונליין כבויה',
    f.description.trim().length < ABOUT_RECOMMENDED && 'תיאור העסק קצר מהמומלץ',
    !f.coverUrl && 'תמונת כיסוי חסרה',
  ].filter((g): g is string => !!g);

  return (
    <section ref={sectionRef} aria-labelledby="h-prof" className={s.section}>
      <div className={s.head}>
        <div className={s.headText}>
          <h1 id="h-prof" className={s.h1}>עריכת פרופיל<span>.</span></h1>
          <p className={s.sub}>כל שדה כאן מוצג בפרופיל הציבורי. החלפת האחראי הרפואי נעשית במסך צוות והרשאות ועוברת אימות רישיון.</p>
        </div>
        {canEdit && dirty && (
          <div className={`${s.saveBar} bf-desk-only`}>
            {(serverErr || (tried && !v.ok)) && (
              <span role="alert" className={s.unsaved}>{serverErr || 'יש שדות שדורשים תיקון'}</span>
            )}
            <button type="button" onClick={reset} disabled={pending} className={s.ghostBtn}>ביטול השינויים</button>
            <button type="button" onClick={publish} disabled={pending || uploads > 0} aria-busy={pending || undefined} className={s.primaryBtn}>
              {pending ? 'מפרסם…' : uploads > 0 ? 'ממתין לסיום ההעלאה…' : 'פרסום השינויים'}
            </button>
          </div>
        )}
        {!dirty && saved && (
          <span role="status" className={s.savedChip}>
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#0B7A87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.8 7.6 6.6 11.4 15 3" />
            </svg>
            פורסם · הפרופיל עודכן
          </span>
        )}
      </div>

      <div className={s.twoCols}>
        <div className={s.card}>
          <h2 className={s.h2}>פרטי העסק</h2>
          <div className={s.stack}>
            <Field label="שם העסק" error={err('name')}>
              {p => <input {...p} type="text" value={f.name} disabled={ro} maxLength={120} autoComplete="organization" onChange={e => patch({ name: e.target.value })} className={`${s.input} ${s.inputStrong}`} />}
            </Field>

            <fieldset className={s.fieldset} tabIndex={-1} aria-describedby="prof-cats-note" aria-invalid={!!err('cats') || undefined}>
              <legend className={s.label}>קטגוריות</legend>
              <div className={s.chips}>
                {CATEGORIES.map(c => {
                  const on = f.cats.includes(c.slug);
                  return (
                    <button key={c.slug} type="button" aria-pressed={on} disabled={ro} onClick={() => toggleCat(c.slug)} className={s.chip} data-on={on || undefined}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <span id="prof-cats-note" className={s.hint}>הקטגוריה קובעת באילו חיפושים תופיעו ואילו כללים מתקן הרישום חלים עליכם.</span>
              {err('cats') && <span className={s.err}>{err('cats')}</span>}
              {needsDoctor && (
                <p role="status" className={s.warnBox}>
                  <strong>נדרש אימות רפואי.</strong> קטגוריה רפואית מחייבת אחראי/ת רפואי/ת: רופא/ה עם רישיון מאומת מול משרד הבריאות. הוסיפו רופא/ה במסך צוות והרשאות, והרישיון יעבור אימות.
                </p>
              )}
            </fieldset>

            <Field label="כתובת" error={err('address')} hint={<>העיר: {cityName}. מעבר לעיר אחרת נעשה במסך הסניפים.</>}>
              {p => <input {...p} type="text" value={f.address} disabled={ro} maxLength={200} autoComplete="street-address" onChange={e => patch({ address: e.target.value })} className={s.input} />}
            </Field>

            <div className={s.row}>
              <Field label="טלפון הקליניקה" error={err('phone')} className={s.rowItem}>
                {p => <input {...p} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={f.phone} disabled={ro} maxLength={20} onChange={e => patch({ phone: e.target.value })} className={`${s.input} ${s.inputLtr} tnum`} />}
              </Field>
              <Field label="WhatsApp" error={err('whatsapp')} className={s.rowItem}>
                {p => <input {...p} type="tel" dir="ltr" inputMode="tel" value={f.whatsapp} disabled={ro} maxLength={20} onChange={e => patch({ whatsapp: e.target.value })} className={`${s.input} ${s.inputLtr} tnum`} />}
              </Field>
            </div>
          </div>
        </div>

        <div className={s.colStack}>
          <div className={s.card}>
            <h2 className={s.h2}>תיאור ואחריות רפואית</h2>
            <Field
              label="תיאור העסק"
              error={err('description')}
              className={s.mb13}
              hint={<><span className="ltr">{f.description.length} / {ABOUT_MAX}</span> תווים · מומלץ לפרט מי מבצע את הטיפולים ומה כלול במחיר</>}
            >
              {p => <textarea {...p} rows={5} value={f.description} disabled={ro} maxLength={ABOUT_MAX} onChange={e => patch({ description: e.target.value })} className={s.textarea} />}
            </Field>
            <div className={s.field}>
              <span className={s.label} id="prof-resp">{responsible && !responsible.isDoctor ? 'איש מקצוע אחראי' : 'אחראי רפואי'}</span>
              <div className={s.readBox} aria-labelledby="prof-resp" role="group">
                {responsible ? (
                  <>
                    <span>
                      {responsible.name}
                      {responsible.license && <> · רישיון <span className="ltr tnum">{responsible.license}</span></>}
                    </span>
                    <span className={s.tag} data-tone={responsible.verified ? 'ok' : 'warn'}>{responsible.verified ? 'מאומת' : 'ממתין לאימות'}</span>
                  </>
                ) : (
                  <span className={s.muted}>לא הוגדר</span>
                )}
              </div>
              <span className={s.hint}>חובה בכל עסק שמבצע הזרקות. קוסמטיקאית אינה מוסמכת להזריק. שינוי האחראי נעשה במסך צוות והרשאות.</span>
            </div>
          </div>

          <div className={s.card}>
            <h2 className={`${s.h2} ${s.h2Tight}`}>מה מוצג בכרטיס</h2>
            <ul className={s.flags}>
              {FLAGS.map(fl => {
                const on = f[fl.key];
                return (
                  <li key={fl.key}>
                    <button type="button" role="checkbox" aria-checked={on} disabled={ro} onClick={() => toggleFlag(fl.key)} className={s.flag}>
                      <span aria-hidden="true" className={s.box} data-on={on || undefined}>{on ? '✓' : ''}</span>
                      <span className={s.flagText}>
                        <span className={s.flagName}>{fl.name}</span>
                        <span className={s.flagNote}>{fl.note}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {f.wazeOn && (
              <Field label="קישור Waze" error={err('wazeUrl')} small className={s.mt13} hint="ב־Waze: חיפוש הכתובת, שיתוף, העתקת קישור">
                {p => <input {...p} type="url" dir="ltr" value={f.wazeUrl} disabled={ro} placeholder="https://waze.com/ul?..." onChange={e => patch({ wazeUrl: e.target.value })} className={`${s.input} ${s.inputSmall} ${s.inputLtr}`} />}
              </Field>
            )}
          </div>
        </div>
      </div>

      <div className={`${s.card} ${s.mb14}`}>
        <div className={s.cardHead}>
          <h2 className={s.h2Flat}>תמונות הפרופיל</h2>
          <span className={s.meta}>גררו תמונה לכל מסגרת · JPG, PNG או WebP · עד <span className="ltr">8MB</span></span>
        </div>
        <p className={s.lead}>תמונת הכיסוי והלוגו מופיעים בכרטיס בתוצאות החיפוש ובראש הפרופיל. תמונות לפני ואחרי מחייבות הסכמה חתומה של הלקוח/ה. ההסכמה מנוהלת בכרטיס הלקוח.</p>
        {err('media') && <p role="alert" className={`${s.err} ${s.mb14}`}>{err('media')}</p>}

        <div className={`${s.twoCols} ${s.mb16}`}>
          <div className={s.minw0}>
            <span className={s.slotLabel}>תמונת כיסוי</span>
            <ImageDrop
              label="תמונת כיסוי"
              placeholder="תמונת חזית הקליניקה · 1600×900"
              url={f.coverUrl}
              alt={f.coverAlt}
              frameClass={s.coverFrame}
              disabled={ro}
              onBusy={onBusy}
              onUploaded={url => patch({ coverUrl: url })}
              onRemove={() => patch({ coverUrl: '' })}
            />
            <Field label="תיאור נגישות לתמונה" error={err('coverAlt')} small className={s.mt9}>
              {p => <input {...p} type="text" value={f.coverAlt} disabled={ro} maxLength={200} placeholder="למשל: חזית הקליניקה עם שלט הכניסה" onChange={e => patch({ coverAlt: e.target.value })} className={`${s.input} ${s.inputSmall}`} />}
            </Field>
          </div>
          <div className={s.logoRow}>
            <div className={s.logoCol}>
              <span className={s.slotLabel}>לוגו</span>
              <ImageDrop
                label="לוגו"
                placeholder="לוגו · 600×600"
                url={f.logoUrl}
                alt={`הלוגו של ${f.name}`}
                fit="contain"
                frameClass={s.logoFrame}
                disabled={ro}
                onBusy={onBusy}
                onUploaded={url => patch({ logoUrl: url })}
                onRemove={() => patch({ logoUrl: '' })}
              />
            </div>
            <div className={s.logoSide}>
              <Field label="כתובת דוא״ל לפניות" error={err('email')} small>
                {p => <input {...p} type="email" dir="ltr" autoComplete="email" value={f.email} disabled={ro} maxLength={160} onChange={e => patch({ email: e.target.value })} className={`${s.input} ${s.inputSmall} ${s.inputLtr}`} />}
              </Field>
              <Field label="אינסטגרם" error={err('instagram')} small>
                {p => <input {...p} type="text" dir="ltr" value={f.instagram} disabled={ro} maxLength={31} placeholder="@noaclinic" onChange={e => patch({ instagram: e.target.value })} className={`${s.input} ${s.inputSmall} ${s.inputLtr}`} />}
              </Field>
            </div>
          </div>
        </div>

        <div className={`${s.cardHead} ${s.mb10}`}>
          <h3 className={s.h3}>גלריית הקליניקה</h3>
          <span className={s.meta}>
            {f.gallery.length === 0 ? 'אין עדיין תמונות' : <><span className="ltr">{withAlt} מתוך {f.gallery.length}</span> עם תיאור</>} · מומלצות לפחות ארבע תמונות
          </span>
        </div>
        {err('gallery') && <p role="alert" className={`${s.err} ${s.mb10}`}>{err('gallery')}</p>}
        <div className={s.galGrid}>
          {f.gallery.map((g, i) => {
            const bad = tried && v.badGallery.includes(i);
            return (
              <div key={g.url} className={s.galItem}>
                <ImageDrop
                  label={`תמונה ${i + 1} בגלריה`}
                  placeholder="תמונה"
                  url={g.url}
                  alt={g.alt}
                  frameClass={s.galFrame}
                  disabled={ro}
                  onBusy={onBusy}
                  onUploaded={url => patch(prev => ({ gallery: prev.gallery.map(x => (x.url === g.url ? { ...x, url } : x)) }))}
                  onRemove={() => patch(prev => ({ gallery: prev.gallery.filter((_, n) => n !== i) }))}
                />
                <input
                  type="text"
                  value={g.alt}
                  disabled={ro}
                  maxLength={200}
                  aria-label={`תיאור תמונה ${i + 1} (חובה)`}
                  aria-invalid={bad || undefined}
                  placeholder="תיאור התמונה"
                  onChange={e => setGal(i, { alt: e.target.value })}
                  className={`${s.input} ${s.inputCaption}`}
                />
                <div className={s.tags} role="group" aria-label={`סוג תמונה ${i + 1}`}>
                  {GAL_TAGS.map(t => (
                    <button key={t} type="button" aria-pressed={g.tag === t} disabled={ro} onClick={() => setGal(i, { tag: t })} className={s.tagBtn} data-on={g.tag === t || undefined}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {canEdit && f.gallery.length < MAX_GALLERY && (
            <div className={s.galItem}>
              <ImageDrop
                label="תמונה חדשה לגלריה"
                placeholder="הוספת תמונה"
                url=""
                alt=""
                frameClass={s.galFrame}
                disabled={ro}
                onBusy={onBusy}
                onUploaded={url => patch(prev => ({ gallery: [...prev.gallery, { url, alt: '', tag: GAL_TAGS[0] }] }))}
              />
            </div>
          )}
        </div>
      </div>

      <div className={`${s.card} ${s.mb14}`}>
        <div className={`${s.cardHead} ${s.mb14}`}>
          <h2 className={s.h2Flat}>שעות פעילות</h2>
          <span className={s.meta}>סגירה בשבת מוצגת בפרופיל במפורש</span>
        </div>
        <ul className={s.hours}>
          {f.hours.map((h, i) => {
            const bad = tried && v.badHours.includes(i);
            return (
              <li key={DAY_NAMES[i]} className={s.hourRow}>
                <span className={s.day}>{DAY_NAMES[i]}</span>
                <button type="button" role="switch" aria-checked={!h.closed} aria-label={`${DAY_NAMES[i]}: פתוח`} disabled={ro} onClick={() => toggleDay(i)} className={s.dayToggle} data-open={!h.closed || undefined}>
                  {h.closed ? 'סגור' : 'פתוח'}
                </button>
                {!h.closed && (
                  <span className={s.times}>
                    <label>
                      <span className="sr-only">שעת פתיחה {DAY_NAMES[i]}</span>
                      <input type="text" dir="ltr" inputMode="numeric" maxLength={5} placeholder="09:00" value={h.open} disabled={ro} aria-invalid={bad || undefined} onChange={e => setHour(i, { open: e.target.value })} className={s.time} />
                    </label>
                    <span aria-hidden="true" className={s.dash}>–</span>
                    <label>
                      <span className="sr-only">שעת סגירה {DAY_NAMES[i]}</span>
                      <input type="text" dir="ltr" inputMode="numeric" maxLength={5} placeholder="19:00" value={h.close} disabled={ro} aria-invalid={bad || undefined} onChange={e => setHour(i, { close: e.target.value })} className={s.time} />
                    </label>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {err('hours') && <p role="alert" className={`${s.err} ${s.mt9}`}>{err('hours')}</p>}
      </div>

      {gaps.length > 0 && (
        <div className={s.gaps}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#A8432C" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7.6" />
            <path d="M10 6.2v4.4M10 13.6v.2" />
          </svg>
          <div className={s.minw0}>
            <p className={s.gapsTitle}>מה עוד חסר בפרופיל</p>
            <ul className={s.gapList}>
              {gaps.map(g => <li key={g}>{g}</li>)}
            </ul>
          </div>
        </div>
      )}

      {canEdit && dirty && (
        <ActionBar
          mobileOnly
          error={serverErr || (tried && !v.ok ? 'יש שדות שדורשים תיקון' : undefined)}
          hint={serverErr || (tried && !v.ok) ? undefined : uploads > 0 ? 'ממתין לסיום ההעלאה' : 'יש שינויים שעדיין לא פורסמו'}
        >
          <button type="button" onClick={reset} disabled={pending} className={s.ghostBtn}>ביטול</button>
          <button type="button" onClick={publish} disabled={pending || uploads > 0} aria-busy={pending || undefined} className={s.primaryBtn}>
            {pending ? 'מפרסם…' : 'פרסום השינויים'}
          </button>
        </ActionBar>
      )}
    </section>
  );
}

function Field({
  label,
  error,
  hint,
  small,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  small?: boolean;
  className?: string;
  children: (p: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const described = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`${s.field} ${className ?? ''}`}>
      <label htmlFor={id} className={small ? s.labelSmall : s.label}>{label}</label>
      {children({ id, ...(error ? { 'aria-invalid': true as const } : {}), 'aria-describedby': described })}
      {hint && <span id={`${id}-hint`} className={s.hint}>{hint}</span>}
      {error && <span id={`${id}-err`} className={s.err}>{error}</span>}
    </div>
  );
}
