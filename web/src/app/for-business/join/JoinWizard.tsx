'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { CATEGORIES, CITIES, REGIONS, regionBySlug, type RegionSlug } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS, type PlanKey } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { submitJoin } from './actions';
import { PhotoSlot } from './PhotoSlot';
import {
  BIZ_TYPES, DAY_NAMES, DEFAULT_HOURS, EMPTY_FIELDS, STEPS, matchCity, validate,
  type BizType, type DeclKey, type Fields, type HoursRow, type ServiceRow, type StepKey,
} from './shared';
import styles from './JoinWizard.module.css';

const TIPS: Record<StepKey, [string, string]> = {
  basics: ['למה אנחנו מבקשים ח״פ', 'הח״פ מאומת מול רשם החברות ואינו מוצג בכרטיס. עסק ללא ח״פ תקף לא מתפרסם. זה מה שמונע מהמדריך להתמלא בעסקים פיקטיביים.'],
  cats: ['בחרו רק מה שאתם מבצעים', 'קטגוריה שנבחרה ולא מבוצעת בפועל היא עילה להסרה. עדיף ארבע קטגוריות מדויקות מעשר רחבות.'],
  medical: ['הזרקות הן פעולה רפואית', 'בוטוקס, מלאנים ומזותרפיה מחייבים רופא/ה. קוסמטיקאית אינה מוסמכת להזריק, ואנחנו בודקים את הרישיון מול משרד הבריאות.'],
  services: ['מחיר גלוי מכניס פניות', 'שקיפות מחיר היא הסיבה הראשונה שלקוחה פונה. טווח מחירים עדיף על "לפי ייעוץ".'],
  hours: ['שעות מדויקות חוסכות פניות מבוזבזות', 'לקוחות מסננות לפי "פתוח עכשיו". שעות שגויות מייצרות פניות שלא נענות, וזה פוגע בדירוג התגובה שלכם.'],
  photos: ['תמונות אמיתיות, לא סטוק', 'תמונות סטוק מזוהות ומוסרות. צילום טלפון של חדר נקי ומואר עובד טוב יותר מתמונה כללית מהאינטרנט.'],
  verify: ['מה קורה אחרי השליחה', 'בודקים ח״פ, רישיון רופא אם נדרש, וכתובת. בדרך כלל תוך יומיים. אם משהו חסר נפנה בוואטסאפ במקום לדחות.'],
};

const GALLERY = ['חדר טיפולים', 'פינת המתנה', 'מכשור', 'הצוות', 'תמונה נוספת', 'תמונה נוספת'];

const NEXT_STEPS = [
  { n: '1', name: 'אימות פרטים', note: 'בודקים ח״פ, כתובת ורישיון רופא אם נדרש. אם חסר משהו נפנה בוואטסאפ.' },
  { n: '2', name: 'פרסום הכרטיס', note: 'עם האישור הכרטיס עולה לאוויר ומתחיל להופיע בחיפושים באזור שלכם.' },
  { n: '3', name: 'חיבור היומן', note: 'אפשר לחבר יומן קיים או להשתמש ביומן שלנו, כדי שלקוחות יקבעו תור ישירות.' },
];

const PLAN_NAMES: Record<PlanKey, string> = { basic: 'רישום בסיסי', advanced: 'רישום מתקדם + CRM' };

const TOTAL = STEPS.length;
const EMPTY = 'לא צוין';

type PhotoKey = 'license' | 'cover' | 'logo' | `gal${number}`;

interface Draft {
  step: number;
  f: Fields;
  cats: string[];
  svcs: ServiceRow[];
  hours: HoursRow[];
  decl: DeclKey[];
}

const initialDraft = (): Draft => ({
  step: 0,
  f: EMPTY_FIELDS,
  cats: [],
  svcs: [1, 2, 3].map(id => ({ id, name: '', price: '', dur: '' })),
  hours: DEFAULT_HOURS.map(h => ({ ...h })),
  decl: [],
});

function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (!d.f || !Array.isArray(d.cats) || !Array.isArray(d.svcs) || !Array.isArray(d.hours) || d.hours.length !== 7 || !Array.isArray(d.decl)) return null;
    return {
      step: Math.min(Math.max(Number(d.step) || 0, 0), TOTAL - 1),
      f: { ...EMPTY_FIELDS, ...d.f },
      cats: d.cats,
      svcs: d.svcs.length ? d.svcs : initialDraft().svcs,
      hours: d.hours,
      decl: d.decl,
    };
  } catch {
    return null;
  }
}

function writeDraft(key: string, d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(key, JSON.stringify(d));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be blocked (private mode). The draft is a convenience only.
  }
}

function Field({ label, bad, className, children }: { label: string; bad?: boolean; className?: string; children: (p: { 'aria-invalid'?: boolean }) => ReactNode }) {
  return (
    <label className={`${styles.field} ${className ?? ''}`}>
      {label}
      {children(bad ? { 'aria-invalid': true } : {})}
    </label>
  );
}

export function JoinWizard({ initialPlan, draftKey, initialName = '' }: { initialPlan: PlanKey; draftKey: string; initialName?: string }) {
  const router = useRouter();
  // Business name typed at signup (passed as ?bizName=) seeds the first field.
  const [draft, setDraft] = useState<Draft>(() => {
    const d = initialDraft();
    return initialName && !d.f.name ? { ...d, f: { ...d.f, name: initialName } } : d;
  });
  const [plan, setPlan] = useState<PlanKey>(initialPlan);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  const [ref, setRef] = useState('');
  const [toast, setToast] = useState('');
  const [serverError, setServerError] = useState('');
  const [photos, setPhotos] = useState<Partial<Record<PhotoKey, string>>>({});
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const photoUrls = useRef(photos);
  photoUrls.current = photos;

  const { step, f, cats, svcs, hours, decl } = draft;
  const st = STEPS[step];
  const v = useMemo(() => validate({ f, cats, svcs, hours, decl }), [f, cats, svcs, hours, decl]);
  const stepOk = v.stepOk[st.key];

  // Restore a saved draft once, then keep it in sync.
  useEffect(() => {
    const saved = readDraft(draftKey);
    if (saved) setDraft(saved);
    setHydrated(true);
  }, [draftKey]);

  useEffect(() => {
    if (hydrated && !done) writeDraft(draftKey, draft);
  }, [hydrated, draftKey, draft, done]);

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    Object.values(photoUrls.current).forEach(u => u && URL.revokeObjectURL(u));
  }, []);

  const flash = useCallback((t: string) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  const goTo = (i: number) => {
    setDraft(d => ({ ...d, step: i }));
    setTried(false);
    setServerError('');
    requestAnimationFrame(() => {
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
      headingRef.current?.focus({ preventScroll: true });
    });
  };

  const setF = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDraft(d => ({ ...d, f: { ...d.f, [k]: val } }));
  };

  const onCity = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const hit = matchCity(val);
    setDraft(d => ({ ...d, f: { ...d.f, city: val, region: hit ? hit.region : d.f.region } }));
  };

  const setSvc = (id: number, k: 'name' | 'price' | 'dur', val: string) =>
    setDraft(d => ({ ...d, svcs: d.svcs.map(s => (s.id === id ? { ...s, [k]: val } : s)) }));

  const setHour = (i: number, patch: Partial<HoursRow>) =>
    setDraft(d => ({ ...d, hours: d.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) }));

  const toggleDay = (i: number) => {
    const h = hours[i];
    // Reopening a day with no times starts from the usual weekday hours.
    if (h.closed && !h.open && !h.close) setHour(i, { closed: false, open: '09:00', close: '19:00' });
    else setHour(i, { closed: !h.closed });
  };

  const pickPhoto = (k: PhotoKey, file: File) => {
    const old = photos[k];
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(file);
    setPhotos(p => ({ ...p, [k]: url }));
  };
  const clearPhoto = (k: PhotoKey) => {
    const old = photos[k];
    if (old) URL.revokeObjectURL(old);
    setPhotos(p => {
      const n = { ...p };
      delete n[k];
      return n;
    });
  };

  const switchPlan = () => {
    const nextPlan: PlanKey = plan === 'basic' ? 'advanced' : 'basic';
    setPlan(nextPlan);
    window.history.replaceState(null, '', `${ROUTES.join}?plan=${nextPlan}`);
  };

  const submit = () => {
    setServerError('');
    startTransition(async () => {
      const res = await submitJoin({ plan, f, cats, svcs, hours, decl });
      if (res.ok) {
        writeDraft(draftKey, null);
        setRef(res.ref);
        setDone(true);
        window.scrollTo({ top: 0 });
        flash('הבקשה נשלחה. נעדכן בוואטסאפ');
        return;
      }
      if (res.reason === 'auth') {
        router.push(`${ROUTES.login}?role=biz&next=${encodeURIComponent(`${ROUTES.join}?plan=${plan}`)}`);
        return;
      }
      if (res.reason === 'invalid' && res.step !== step) {
        goTo(res.step);
        setTried(true);
      }
      setServerError(res.error);
    });
  };

  const next = () => {
    if (pending) return;
    if (!stepOk) {
      setTried(true);
      return;
    }
    if (st.key === 'verify') {
      submit();
      return;
    }
    goTo(step + 1);
  };

  const saveExit = () => {
    writeDraft(draftKey, draft);
    flash('הטופס נשמר. אפשר להמשיך מאותה נקודה בכניסה הבאה');
    setTimeout(() => router.push(ROUTES.forBusiness), 1400);
  };

  const err = serverError || (tried && !stepOk ? v.errors[st.key] : '');
  const bad = tried ? v.bad : null;
  const hasMedical = v.hasMedical;
  const openDays = hours.filter(h => !h.closed).length;

  const progressPct = Math.round(((step + (done ? 1 : 0)) / TOTAL) * 100);
  const stepCount = (
    <>
      שלב <span className="ltr">{step + 1}</span> מתוך <span className="ltr">{TOTAL}</span>
    </>
  );

  const summary: Array<{ label: string; value: ReactNode; tone?: 'strong' | 'teal'; ltr?: boolean }> = [
    { label: 'שם מסחרי', value: f.name.trim() || EMPTY, tone: 'strong' },
    {
      label: 'מיקום',
      value: (f.address.trim() || EMPTY) + (f.city.trim() ? ', ' + f.city.trim() : '') + (f.region ? ' · ' + regionBySlug(f.region)!.name : ''),
    },
    { label: 'ח״פ', value: f.hp.trim() || EMPTY, ltr: true },
    { label: 'קטגוריות', value: v.pickedCats.length ? v.pickedCats.map(c => c.name).join(', ') : EMPTY },
    hasMedical
      ? {
          label: 'אחריות רפואית',
          tone: 'teal',
          value: (
            <>
              {f.docName.trim() || EMPTY}
              {f.docLic.trim() && (
                <>
                  {' · רישיון '}
                  <span className="ltr">{f.docLic.trim()}</span>
                </>
              )}
            </>
          ),
        }
      : { label: 'איש מקצוע אחראי', value: (f.proName.trim() || EMPTY) + (f.proCert.trim() ? ' · ' + f.proCert.trim() : '') },
    {
      label: 'טיפולים',
      value: v.filledSvcs.length ? (
        <>
          <span className="ltr">{v.filledSvcs.length}</span> טיפולים · {v.filledSvcs.map(x => x.name.trim()).slice(0, 3).join(', ')}
        </>
      ) : (
        EMPTY
      ),
    },
    {
      label: 'שעות',
      value: (
        <>
          {openDays === 1 ? 'יום פעילות אחד' : openDays === 0 ? 'אין ימי פעילות' : <><span className="ltr">{openDays}</span> ימי פעילות</>}
          {' · שבת '}
          {hours[6].closed ? 'סגור' : 'פתוח'}
        </>
      ),
    },
    {
      label: 'מסלול',
      value: (
        <>
          {PLAN_NAMES[plan]} · <span className="ltr">{nis(PLAN_MONTHLY_NIS[plan])}</span> לחודש לסניף
        </>
      ),
    },
  ];

  return (
    <div className={styles.root} dir="rtl" lang="he">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href={ROUTES.home} className={styles.brand} aria-label="BeautyFind, לדף הבית">
            <Wordmark size={21} />
          </Link>
          <span className={styles.headerText}>
            <span className={styles.headerTitle}>רישום עסק למדריך</span>
            <span className={styles.headerLine}>
              {done ? 'הושלם' : <>{stepCount} · {st.name}</>}
            </span>
          </span>
          {!done && (
            <button type="button" onClick={saveExit} className={styles.saveExit}>
              שמירה ויציאה
            </button>
          )}
        </div>
        <div aria-hidden="true" className={styles.progress}>
          <span style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <div className={styles.page}>
        {!done ? (
          <div className={styles.shell}>
            <main className={styles.main}>
              {step === 0 && (
                <p className={styles.claimLine}>
                  העסק כבר מופיע ב־BeautyFind? <Link href={ROUTES.claim}>אישור בעלות על רישום קיים</Link>
                </p>
              )}

              <div>
                <span className={styles.stepBadge}>{stepCount}</span>
                <h1 ref={headingRef} tabIndex={-1} className={styles.h1}>
                  {st.title}
                </h1>
                <p className={styles.stepSub}>{st.sub}</p>
              </div>

              {st.key === 'basics' && (
                <section key="basics" className={styles.card}>
                  <div className={styles.two}>
                    <Field label="שם מסחרי" bad={bad?.name}>
                      {a => <input {...a} value={f.name} onChange={setF('name')} placeholder="השם שהלקוחות מכירות" autoComplete="organization" className={styles.input} />}
                    </Field>
                    <Field label="שם משפטי">
                      {a => <input {...a} value={f.legal} onChange={setF('legal')} placeholder="כפי שמופיע ברשם" className={styles.input} />}
                    </Field>
                    <Field label="ח״פ או עוסק מורשה" bad={bad?.hp}>
                      {a => <input {...a} value={f.hp} onChange={setF('hp')} dir="ltr" inputMode="numeric" className={`${styles.input} ${styles.inputLtr}`} />}
                    </Field>
                    <Field label="טלפון" bad={bad?.phone}>
                      {a => <input {...a} value={f.phone} onChange={setF('phone')} dir="ltr" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="09-000-0000" className={`${styles.input} ${styles.inputLtr}`} />}
                    </Field>
                    <Field label="וואטסאפ לפניות" bad={bad?.wa}>
                      {a => <input {...a} value={f.wa} onChange={setF('wa')} dir="ltr" type="tel" inputMode="tel" placeholder="052-000-0000" className={`${styles.input} ${styles.inputLtr}`} />}
                    </Field>
                    <Field label="דוא״ל" bad={bad?.email}>
                      {a => <input {...a} value={f.email} onChange={setF('email')} dir="ltr" type="email" inputMode="email" autoComplete="email" className={`${styles.input} ${styles.inputLtr}`} />}
                    </Field>
                    <Field label="כתובת" bad={bad?.address}>
                      {a => <input {...a} value={f.address} onChange={setF('address')} placeholder="רחוב, מספר" autoComplete="street-address" className={styles.input} />}
                    </Field>
                    <Field label="עיר" bad={bad?.city}>
                      {a => <input {...a} value={f.city} onChange={onCity} list="ob-cities" autoComplete="off" className={styles.input} />}
                    </Field>
                  </div>
                  <datalist id="ob-cities">
                    {CITIES.map(ct => (
                      <option key={ct.slug} value={ct.name} />
                    ))}
                  </datalist>

                  <div className={styles.block}>
                    <span id="ob-region" className={styles.blockLabel}>אזור</span>
                    <div role="group" aria-labelledby="ob-region" className={styles.chips}>
                      {REGIONS.map(rg => (
                        <button
                          key={rg.slug}
                          type="button"
                          aria-pressed={f.region === rg.slug}
                          data-bad={bad?.region || undefined}
                          onClick={() => setDraft(d => ({ ...d, f: { ...d.f, region: rg.slug as RegionSlug } }))}
                          className={styles.chip}
                        >
                          {rg.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.block}>
                    <span id="ob-type" className={styles.blockLabel}>סוג העסק</span>
                    <div role="radiogroup" aria-labelledby="ob-type" className={styles.types}>
                      {BIZ_TYPES.map(bt => {
                        const on = f.bizType === bt.key;
                        return (
                          <button
                            key={bt.key}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            data-bad={bad?.bizType || undefined}
                            onClick={() => setDraft(d => ({ ...d, f: { ...d.f, bizType: bt.key as BizType } }))}
                            className={styles.type}
                          >
                            <span aria-hidden="true" className={styles.radioDot}>
                              {on && <span />}
                            </span>
                            <span className={styles.typeText}>
                              <span className={styles.typeName}>{bt.name}</span>
                              <span className={styles.typeNote}>{bt.note}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}

              {st.key === 'cats' && (
                <section key="cats" className={styles.card}>
                  <div className={styles.catGrid}>
                    {CATEGORIES.map(ca => {
                      const on = cats.includes(ca.slug);
                      return (
                        <button
                          key={ca.slug}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDraft(d => ({ ...d, cats: on ? d.cats.filter(c => c !== ca.slug) : [...d.cats, ca.slug] }))}
                          className={styles.cat}
                        >
                          <span className={styles.catName}>{ca.name}</span>
                          {ca.isMedical && <span className={styles.medTag}>פעולה רפואית</span>}
                        </button>
                      );
                    })}
                  </div>
                  {hasMedical && (
                    <p className={styles.warn}>בחרתם קטגוריות שהן פעולה רפואית. בשלב הבא תידרשו להצהיר על רופא/ה אחראי/ת. קוסמטיקאית אינה מוסמכת להזריק.</p>
                  )}
                </section>
              )}

              {st.key === 'medical' && (
                <section key="medical" className={styles.card}>
                  {hasMedical ? (
                    <>
                      <div className={styles.infoTeal}>
                        <p>הקטגוריות שבחרתם, {v.medCats.map(c => c.name).join(', ')}, מחייבות רופא/ה. הפרטים יוצגו בכרטיס תחת &quot;אחריות רפואית&quot;.</p>
                      </div>
                      <div className={styles.two}>
                        <Field label="שם הרופא/ה האחראי/ת" bad={bad?.docName}>
                          {a => <input {...a} value={f.docName} onChange={setF('docName')} className={styles.input} />}
                        </Field>
                        <Field label="מספר רישיון" bad={bad?.docLic}>
                          {a => <input {...a} value={f.docLic} onChange={setF('docLic')} dir="ltr" placeholder="34-82115" className={`${styles.input} ${styles.inputLtr}`} />}
                        </Field>
                        <Field label="התמחות">
                          {a => <input {...a} value={f.docSpec} onChange={setF('docSpec')} placeholder="רפואת עור, אסתטיקה רפואית" className={styles.input} />}
                        </Field>
                        <Field label="נוכחות בקליניקה">
                          {a => <input {...a} value={f.docPresence} onChange={setF('docPresence')} placeholder="בכל טיפול הזרקה" className={styles.input} />}
                        </Field>
                      </div>
                      <div className={styles.block}>
                        <span className={styles.blockLabel}>העלאת רישיון</span>
                        <PhotoSlot
                          label="העלאת רישיון"
                          placeholder="צילום או סריקה של הרישיון"
                          url={photos.license}
                          className={styles.slotLicense}
                          onPick={file => pickPhoto('license', file)}
                          onClear={() => clearPhoto('license')}
                        />
                        <p className={styles.fine}>המסמך נבדק על ידי צוות המערכת ואינו מוצג בכרטיס הפומבי.</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.infoOk}>
                        <p>הקטגוריות שבחרתם אינן פעולות רפואיות, ולכן אין צורך ברופא/ה. בכרטיס יופיע &quot;איש מקצוע אחראי&quot;.</p>
                      </div>
                      <div className={styles.two}>
                        <Field label="שם איש/אשת המקצוע האחראי/ת" bad={bad?.proName}>
                          {a => <input {...a} value={f.proName} onChange={setF('proName')} className={styles.input} />}
                        </Field>
                        <Field label="הכשרה או תעודה">
                          {a => <input {...a} value={f.proCert} onChange={setF('proCert')} placeholder="קוסמטיקאית רפואית · מכון וייצמן" className={styles.input} />}
                        </Field>
                        <Field label="שנות ניסיון">
                          {a => <input {...a} value={f.proYears} onChange={setF('proYears')} dir="ltr" inputMode="numeric" className={`${styles.input} ${styles.inputLtr}`} />}
                        </Field>
                      </div>
                    </>
                  )}
                </section>
              )}

              {st.key === 'services' && (
                <section key="services" className={styles.card}>
                  <div className={styles.svcList}>
                    {svcs.map(sv => (
                      <div key={sv.id} className={styles.svcRow}>
                        <label className={`${styles.svcField} ${styles.svcName}`}>
                          שם הטיפול
                          <input value={sv.name} onChange={e => setSvc(sv.id, 'name', e.target.value)} className={styles.svcInput} />
                        </label>
                        <label className={styles.svcField}>
                          מחיר ₪
                          <input
                            value={sv.price}
                            onChange={e => setSvc(sv.id, 'price', e.target.value)}
                            dir="ltr"
                            inputMode="numeric"
                            aria-invalid={(tried && v.bad.badPriceIds.includes(sv.id)) || undefined}
                            className={`${styles.svcInput} ${styles.svcNum} ${styles.svcPrice}`}
                          />
                        </label>
                        <label className={styles.svcField}>
                          דקות
                          <input
                            value={sv.dur}
                            onChange={e => setSvc(sv.id, 'dur', e.target.value)}
                            dir="ltr"
                            inputMode="numeric"
                            aria-invalid={(tried && v.bad.badDurIds.includes(sv.id)) || undefined}
                            className={`${styles.svcInput} ${styles.svcNum} ${styles.svcDur}`}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setDraft(d => ({ ...d, svcs: d.svcs.length > 1 ? d.svcs.filter(s => s.id !== sv.id) : d.svcs }))}
                          aria-label={sv.name.trim() ? `הסרת טיפול: ${sv.name.trim()}` : 'הסרת טיפול'}
                          className={styles.svcRemove}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(d => ({ ...d, svcs: [...d.svcs, { id: Date.now(), name: '', price: '', dur: '' }] }))}
                    className={styles.addSvc}
                  >
                    הוספת טיפול
                  </button>
                  <p className={styles.fineLg}>
                    מחירים בשקלים, לא כולל מע״מ. מספיקים שלושה טיפולים כדי לפרסם. אפשר להשלים אחר כך בלוח הבקרה. שקיפות מחיר היא הסיבה מספר אחת שלקוחה פונה.
                  </p>
                </section>
              )}

              {st.key === 'hours' && (
                <section key="hours" className={styles.card}>
                  <ul className={styles.hours}>
                    {hours.map((h, i) => {
                      const rowBad = tried && v.bad.badHours.includes(i);
                      return (
                        <li key={DAY_NAMES[i]} className={styles.hourRow} data-closed={h.closed || undefined}>
                          <span className={styles.day}>{DAY_NAMES[i]}</span>
                          <input
                            value={h.open}
                            onChange={e => setHour(i, { open: e.target.value })}
                            disabled={h.closed}
                            dir="ltr"
                            inputMode="numeric"
                            aria-label={`שעת פתיחה, יום ${DAY_NAMES[i]}`}
                            aria-invalid={rowBad || undefined}
                            className={styles.time}
                          />
                          <span aria-hidden="true" className={styles.dash}>–</span>
                          <input
                            value={h.close}
                            onChange={e => setHour(i, { close: e.target.value })}
                            disabled={h.closed}
                            dir="ltr"
                            inputMode="numeric"
                            aria-label={`שעת סגירה, יום ${DAY_NAMES[i]}`}
                            aria-invalid={rowBad || undefined}
                            className={styles.time}
                          />
                          <span className={styles.openLabel}>{h.closed ? 'סגור' : 'פתוח'}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!h.closed}
                            aria-label={`יום ${DAY_NAMES[i]}: פתוח או סגור`}
                            onClick={() => toggleDay(i)}
                            className={styles.switch}
                          >
                            <span aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className={styles.fineLg}>לקוחות מסננות לפי &quot;פתוח עכשיו&quot;. שעות לא מדויקות עולות בפניות שלא נענות.</p>
                </section>
              )}

              {st.key === 'photos' && (
                <section key="photos" className={styles.card}>
                  <div className={`${styles.two} ${styles.photoTop}`}>
                    <div className={styles.minw}>
                      <span className={styles.slotLabel}>תמונת כיסוי</span>
                      <PhotoSlot
                        label="תמונת כיסוי"
                        placeholder="חזית או חדר טיפולים"
                        size="1600×900"
                        url={photos.cover}
                        className={styles.slotCover}
                        onPick={file => pickPhoto('cover', file)}
                        onClear={() => clearPhoto('cover')}
                      />
                    </div>
                    <div className={styles.minw}>
                      <span className={styles.slotLabel}>לוגו</span>
                      <PhotoSlot
                        label="לוגו"
                        placeholder="לוגו"
                        size="600×600"
                        fit="contain"
                        url={photos.logo}
                        className={styles.slotLogo}
                        onPick={file => pickPhoto('logo', file)}
                        onClear={() => clearPhoto('logo')}
                      />
                    </div>
                  </div>
                  <span className={styles.galLabel}>גלריה</span>
                  <div className={styles.gallery}>
                    {GALLERY.map((ph, i) => {
                      const k: PhotoKey = `gal${i}`;
                      return (
                        <PhotoSlot
                          key={k}
                          label={`תמונת גלריה ${i + 1}`}
                          placeholder={ph}
                          url={photos[k]}
                          className={styles.slotGal}
                          onPick={file => pickPhoto(k, file)}
                          onClear={() => clearPhoto(k)}
                        />
                      );
                    })}
                  </div>
                  <p className={styles.fineLg}>כרטיס עם תמונות מקבל פי שלושה פניות. תמונות לפני/אחרי מחייבות הסכמה חתומה של הלקוחה: מנוהלת בכרטיס הלקוח, לא כאן.</p>
                </section>
              )}

              {st.key === 'verify' && (
                <section key="verify" className={styles.card}>
                  <dl className={styles.summary}>
                    {summary.map(sm => (
                      <div key={sm.label} className={styles.summaryRow}>
                        <dt>{sm.label}</dt>
                        <dd dir={sm.ltr ? 'ltr' : undefined} data-tone={sm.tone}>
                          {sm.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <h3 className={styles.declTitle}>אישורים לפני שליחה</h3>
                  <ul className={styles.decls}>
                    {v.declRequired.map(dc => {
                      const on = decl.includes(dc.key);
                      return (
                        <li key={dc.key}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            data-bad={(tried && !v.stepOk.verify && !on) || undefined}
                            onClick={() => setDraft(d => ({ ...d, decl: on ? d.decl.filter(k => k !== dc.key) : [...d.decl, dc.key] }))}
                            className={styles.decl}
                          >
                            <span aria-hidden="true" className={styles.box}>
                              {on && (
                                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2.5 7.5 5.5 10.5 11.5 4" />
                                </svg>
                              )}
                            </span>
                            <span className={styles.declText}>
                              <span className={styles.declLabel}>{dc.label}</span>
                              <span className={styles.declNote}>{dc.note}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {err && (
                <p role="alert" className={styles.error}>
                  {err}
                </p>
              )}

              <div className={styles.actions}>
                {step > 0 && (
                  <button type="button" onClick={() => goTo(step - 1)} className={styles.back}>
                    חזרה
                  </button>
                )}
                <button type="button" onClick={next} disabled={pending} aria-busy={pending || undefined} className={styles.next}>
                  {st.key === 'verify' ? 'שליחה לאימות' : 'המשך'}
                </button>
                {st.key === 'photos' && (
                  <button
                    type="button"
                    onClick={() => {
                      goTo(step + 1);
                      flash('אפשר להשלים תמונות בלוח הבקרה');
                    }}
                    className={styles.skip}
                  >
                    אשלים אחר כך
                  </button>
                )}
              </div>
              <p className={styles.nextHint}>
                {st.key === 'verify'
                  ? 'לאחר השליחה נתחיל באימות. בדרך כלל עד יומיים, ואם חסר משהו נפנה בוואטסאפ.'
                  : stepOk
                    ? 'הכול מוכן, אפשר להמשיך'
                    : 'השלימו את שדות החובה כדי להמשיך'}
              </p>
            </main>

            <aside className={styles.side}>
              <div className={styles.railCard}>
                <ol className={styles.rail}>
                  {STEPS.map((x, i) => {
                    const cur = step === i;
                    const locked = i > Math.max(v.reach, step);
                    const past = i < step;
                    return (
                      <li key={x.key}>
                        <button
                          type="button"
                          onClick={() => !locked && goTo(i)}
                          disabled={locked}
                          aria-current={cur ? 'step' : undefined}
                          data-state={cur ? 'current' : past ? 'past' : undefined}
                          className={styles.railItem}
                        >
                          <span aria-hidden="true" className={styles.railDot}>
                            {past ? '✓' : <span className="ltr">{i + 1}</span>}
                          </span>
                          <span className={styles.railName}>{x.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className={styles.planCard}>
                <div className={styles.planHead}>
                  <span className={styles.planKicker}>המסלול שנבחר</span>
                  <button type="button" onClick={switchPlan} className={styles.planSwitch}>
                    {plan === 'basic' ? 'מעבר למתקדם' : 'מעבר לבסיסי'}
                  </button>
                </div>
                <span className={styles.planName}>{PLAN_NAMES[plan]}</span>
                <span className={styles.planPrice}>
                  <span className="ltr">{nis(PLAN_MONTHLY_NIS[plan])}</span> לחודש לכל סניף, לא כולל מע״מ
                </span>
                <span className={styles.planNote}>סניף בטיוטה לא מחויב. החיוב מתחיל כשהכרטיס מתפרסם.</span>
              </div>

              <div className={styles.tipCard}>
                <h2 className={styles.tipTitle}>{TIPS[st.key][0]}</h2>
                <p className={styles.tipBody}>{TIPS[st.key][1]}</p>
                <p className={styles.tipFoot}>
                  הקריטריונים המלאים ב־<Link href={ROUTES.listingStandards}>תקן הרישום</Link>. שאלות: <Link href={ROUTES.contact}>צוות ההצטרפות</Link>.
                </p>
              </div>
            </aside>
          </div>
        ) : (
          <div className={styles.done}>
            <span aria-hidden="true" className={styles.doneIcon}>
              <svg width="27" height="27" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 7.5 5.5 10.5 11.5 4" />
              </svg>
            </span>
            <h1 className={styles.doneH1}>הבקשה נשלחה לבדיקה</h1>
            <p className={styles.doneBody}>
              {hasMedical
                ? 'הבקשה בתור לבדיקה. נאמת את הח״פ, הכתובת ואת רישיון הרופא/ה מול משרד הבריאות. הכרטיס יתפרסם רק לאחר האימות.'
                : 'הבקשה בתור לבדיקה. נאמת את הח״פ ואת הכתובת, והכרטיס יתפרסם לאחר מכן.'}
            </p>
            <ol className={styles.nextSteps}>
              {NEXT_STEPS.map(ns => (
                <li key={ns.n}>
                  <span aria-hidden="true" className={styles.nsNum}>{ns.n}</span>
                  <span className={styles.nsText}>
                    <span className={styles.nsName}>{ns.name}</span>
                    <span className={styles.nsNote}>{ns.note}</span>
                  </span>
                </li>
              ))}
            </ol>
            <dl className={styles.refBox}>
              <dt>אסמכתא</dt>
              <dd dir="ltr" className={styles.refVal}>{ref}</dd>
              <dt>זמן מענה</dt>
              <dd className={styles.refSla}>
                עד <span className="ltr">2</span> ימי עסקים
              </dd>
            </dl>
            <div className={styles.doneActions}>
              <Link href={ROUTES.dashboard} className={styles.donePrimary}>ללוח הבקרה</Link>
              <Link href={ROUTES.listingStandards} className={styles.doneSecondary}>תקן הרישום</Link>
            </div>
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {toast && <div className={styles.toast}>{toast}</div>}
      </div>
    </div>
  );
}
