'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { priceParts } from '@/components/profile/format';
import { EMAIL_RE, fromE164, nisFromAgorot, telHref, toE164 } from '@/lib/format';
import { VAT_RATE } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { addDays, dowOf } from '@/lib/time';
import { ActionBar } from '../shell/ActionBar';
import { haptic } from '../shell/haptics';
import { TopBar } from '../shell/TopBar';
import { Wordmark } from '../Wordmark';
import { loadWeek, submitBooking } from './actions';
import { ArrowGlyph, CheckGlyph, PeopleGlyph, PhoneButton, Toast, WhatsAppButton, useToast } from './bits';
import { DRAFT_MAX_AGE, clearDraft, inShell, readDraft, scrollToField, scrollTop, writeDraft } from './flow';
import {
  DOW, SLOT_WEEKS, closedDaysText, dateText, dom, downloadIcs, freeTxt, hoursRows, isMobileE164, keyOf, timeOfIso, waLink, wazeHref, weekLabel, weekTxt,
  type BookTreatment, type BookingData, type DaySlots, type SubmitError,
} from './shared';
import s from './BookingFlow.module.css';

type Step = 1 | 2 | 3 | 4;
type StaffPick = string | 'any' | null;

const STEP_NAMES: Record<Step, string> = { 1: 'טיפול', 2: 'מטפלת', 3: 'מועד', 4: 'פרטים ואישור' };
const STAFF_TONES = [
  { color: '#0B7A87', tint: '#F0FAFB' },
  { color: '#C77D4A', tint: '#FBEEE2' },
  { color: '#5B6ABF', tint: '#EAECF9' },
];
const BUCKETS = [
  { name: 'בוקר', from: 0, to: 12 },
  { name: 'צהריים', from: 12, to: 16 },
  { name: 'אחר הצהריים', from: 16, to: 24 },
];
const COUNT_WORDS: Record<number, string> = { 2: 'שתי', 3: 'שלוש', 4: 'ארבע', 5: 'חמש', 6: 'שש' };

const vatIncl = (agorot: number) => Math.round((agorot * (1 + VAT_RATE)) / 100) * 100;

/** What a returning client resumes from (per branch, this device only). */
interface BookDraft {
  svcId: string | null;
  staffPick: StaffPick;
  slot: string | null;
  week: number;
  dayKey: string | null;
  step: Step;
  form: { name: string; phone: string; email: string };
}
/** A saved slot this close to its start is not worth resuming. */
const RESUME_SLOT_MARGIN_MS = 15 * 60 * 1000;

/** Price with its Hebrew prefix/suffix; the amount itself always sits in an LTR span. */
function Price({ t, className }: { t: Pick<BookTreatment, 'priceType' | 'priceAgorot'>; className?: string }) {
  if (t.priceAgorot === 0) return <span className={className}>ללא עלות</span>;
  const p = priceParts(t.priceType, t.priceAgorot);
  return (
    <span className={className}>
      {p.pre}
      <span className="ltr tnum">{p.amount}</span>
      {p.post}
    </span>
  );
}

/** Arrow keys move focus between the radios of a group (RTL: left = next). Space/Enter selects. */
function radioKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
  if (items.length === 0) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[next].focus();
}

export function BookingFlow({ data }: { data: BookingData }) {
  const { branch, treatments, staff, policy, todayKey } = data;
  const pre = data.preselect ? treatments.find(t => t.id === data.preselect) ?? null : null;
  const soleStaff = (t: BookTreatment | null) => (t && t.staffIds.length === 1 ? t.staffIds[0] : null);

  const [step, setStep] = useState<Step>(pre?.bookable ? 2 : 1);
  const [svcId, setSvcId] = useState<string | null>(pre?.id ?? null);
  const [staffPick, setStaffPick] = useState<StaffPick>(soleStaff(pre));
  const [cat, setCat] = useState<string>('all');
  const [week, setWeek] = useState(0);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [autoDay, setAutoDay] = useState(true);
  const [slot, setSlot] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<Record<string, DaySlots[]>>({});
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [form, setForm] = useState(data.prefill);
  const [consents, setConsents] = useState({ health: false, policy: false, marketing: false });
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<SubmitError | null>(null);
  const [stepNotice, setStepNotice] = useState<{ step: Step; text: string } | null>(null);
  const [done, setDone] = useState<{ ref: string; token: string } | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [resumed, setResumed] = useState(false);
  const [nudge, setNudge] = useState(false);
  const { toast, flash } = useToast();

  const headingRefs = useRef<Record<string, HTMLHeadingElement | null>>({});
  const lastView = useRef<string>(`${step}`);
  const loading = useRef(new Set<string>());
  const step4Ref = useRef<HTMLElement | null>(null);
  const draftReady = useRef(false);
  const skipFocus = useRef(false);
  const draftKey = `bf-book-draft:${branch.id}`;

  const svc = treatments.find(t => t.id === svcId) ?? null;
  const needsConsult = !!svc?.isMedical;
  const staffById = useMemo(() => new Map(staff.map((p, i) => [p.id, { ...p, tone: STAFF_TONES[i % STAFF_TONES.length] }])), [staff]);
  const pickedStaff = staffPick && staffPick !== 'any' ? staffById.get(staffPick) ?? null : null;
  const dep = svc?.depositAgorot ?? 0;
  const refundH = policy.refundH;

  // ---------- Availability (one week per request, cached per treatment) ----------

  const cacheKey = (tid: string, w: number) => `${tid}:${w}`;
  const fetchWeek = useCallback(
    async (tid: string, w: number, force = false) => {
      const k = cacheKey(tid, w);
      if (loading.current.has(k)) return;
      if (!force && weeks[k]) return;
      loading.current.add(k);
      setLoadFailed(null);
      try {
        const res = await loadWeek({ branchId: branch.id, treatmentId: tid, week: w });
        if (res.ok) setWeeks(m => ({ ...m, [k]: res.days }));
        else setLoadFailed(k);
      } catch {
        setLoadFailed(k);
      } finally {
        loading.current.delete(k);
      }
    },
    [branch.id, weeks],
  );

  const week0 = svc?.bookable ? weeks[cacheKey(svc.id, 0)] : undefined;
  const weekDays = svc?.bookable ? weeks[cacheKey(svc.id, week)] : undefined;

  useEffect(() => {
    if (!svc?.bookable) return;
    if (step === 2 || step === 3) void fetchWeek(svc.id, 0);
    if (step === 3) void fetchWeek(svc.id, week);
  }, [svc, step, week, fetchWeek]);

  const slotsOf = useCallback(
    (d: DaySlots | undefined) => (d ? d.slots.filter(x => staffPick === 'any' || (staffPick && x.practitionerIds.includes(staffPick))) : []),
    [staffPick],
  );

  // Pick a sensible day when a week (or the practitioner) changes: first day with free slots, else the first open day.
  useEffect(() => {
    if (!autoDay || !weekDays) return;
    const best = weekDays.find(d => slotsOf(d).length > 0) ?? weekDays.find(d => d.open) ?? null;
    setDayKey(best?.date ?? null);
    setAutoDay(false);
  }, [autoDay, weekDays, slotsOf]);

  // ---------- Focus and announcements ----------

  const view = done ? 'done' : `${step}`;
  useEffect(() => {
    if (view === lastView.current) return;
    lastView.current = view;
    // A resumed draft opens on its step without moving focus.
    if (skipFocus.current) {
      skipFocus.current = false;
      return;
    }
    // In the shell every step is its own screen: start it at the top, focus without jumping.
    if (inShell()) {
      scrollTop();
      headingRefs.current[view]?.focus({ preventScroll: true });
    } else headingRefs.current[view]?.focus();
  }, [view]);

  // ---------- Draft: resume where the client stopped (spec §3.4) ----------

  useEffect(() => {
    draftReady.current = true;
    const d = readDraft<BookDraft>(draftKey, DRAFT_MAX_AGE);
    if (!d) return;
    if (d.form) setForm(f => ({ name: f.name || d.form.name || '', phone: f.phone || d.form.phone || '', email: f.email || d.form.email || '' }));
    const t = treatments.find(x => x.id === d.svcId);
    // A treatment chosen from the profile link (?t=) wins over an older draft for another one.
    if (!t || !t.bookable || (data.preselect && data.preselect !== t.id)) return;
    const staffOk = d.staffPick === 'any' ? t.staffIds.length > 1 : !!d.staffPick && t.staffIds.includes(d.staffPick);
    const sp: StaffPick = staffOk ? d.staffPick : soleStaff(t);
    const slotOk = !!sp && !!d.slot && new Date(d.slot).getTime() > Date.now() + RESUME_SLOT_MARGIN_MS;
    setSvcId(t.id);
    setStaffPick(sp);
    if (slotOk) {
      setWeek(Math.max(0, Math.min(SLOT_WEEKS - 1, d.week)));
      setDayKey(d.dayKey);
      setAutoDay(false);
      setSlot(d.slot);
    }
    const target: Step = !sp ? 2 : !slotOk ? 3 : d.step === 4 ? 4 : 3;
    if (target !== step) skipFocus.current = true;
    setStep(target);
    setResumed(true);
    // Runs once on mount: the draft belongs to this branch and page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady.current || done || redirecting) return;
    if (!svcId && !form.name && !form.phone) {
      clearDraft(draftKey);
      return;
    }
    writeDraft<BookDraft>(draftKey, { svcId, staffPick, slot, week, dayKey, step, form });
  }, [draftKey, svcId, staffPick, slot, week, dayKey, step, form, done, redirecting]);
  const liveText = done ? 'התור נקבע' : `שלב ${step} מתוך 4: ${STEP_NAMES[step]}`;

  // ---------- Derived ----------

  const day = weekDays?.find(d => d.date === dayKey);
  const daySlots = slotsOf(day);
  const slotKey = slot ? keyOf(slot) : null;
  const slotWhen = slot && slotKey ? `${DOW[dowOf(slotKey)]}, ${dateText(slotKey)}` : null;

  const reach: Step = !svc || !svc.bookable ? 1 : !staffPick ? 2 : !slot ? 3 : 4;

  const phoneE164 = toE164(form.phone);
  const nameOk = form.name.trim().length >= 2;
  const phoneOk = isMobileE164(phoneE164);
  const emailOk = !form.email.trim() || EMAIL_RE.test(form.email.trim());
  const consentOk = consents.health && consents.policy;
  const formOk = nameOk && phoneOk && emailOk && consentOk;
  const errText = !nameOk ? 'נדרש שם מלא' : !phoneOk ? 'מספר טלפון נייד אינו תקין' : !emailOk ? 'כתובת הדוא״ל אינה תקינה' : 'יש לאשר את הצהרת הבריאות ואת מדיניות הביטולים';

  // ---------- Actions ----------

  const go = (n: Step) => {
    setDir(n >= step ? 'fwd' : 'back');
    setStep(n);
    setTried(false);
    setStepNotice(null);
    setNudge(false);
    setResumed(false);
  };

  const pickTreatment = (t: BookTreatment) => {
    setSvcId(t.id);
    setSlot(null);
    setServerError(null);
    setStepNotice(null);
    if (t.id !== svcId) {
      setWeek(0);
      setAutoDay(true);
    }
    if (!t.bookable) return; // medical: the footer offers the consult hand-off
    const sole = soleStaff(t);
    setStaffPick(sole ?? (staffPick && (staffPick === 'any' || t.staffIds.includes(staffPick)) && t.staffIds.length > 1 ? staffPick : null));
    go(2);
  };

  const pickStaff = (p: StaffPick) => {
    if (p !== staffPick) {
      setSlot(null);
      setAutoDay(true);
    }
    setStaffPick(p);
    go(3);
  };

  const changeWeek = (w: number) => {
    setWeek(Math.max(0, Math.min(SLOT_WEEKS - 1, w)));
    setAutoDay(true);
  };

  const submit = () => {
    if (!formOk || !svc || !slot || !staffPick) {
      setTried(true);
      haptic('warning');
      // Field borders render on the next frame; then bring the first one into view.
      requestAnimationFrame(() => scrollToField(step4Ref.current?.querySelector('[aria-invalid="true"], [data-invalid]')));
      return;
    }
    setServerError(null);
    startTransition(async () => {
      let res;
      try {
        res = await submitBooking({
          branchId: branch.id,
          treatmentId: svc.id,
          practitionerId: staffPick === 'any' ? null : staffPick,
          startsAt: slot,
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          consentHealth: consents.health,
          consentPolicy: consents.policy,
          marketing: consents.marketing,
        });
      } catch {
        res = { ok: false as const, error: 'failed' as const };
      }
      if (res.ok) {
        clearDraft(draftKey);
        if (res.checkoutUrl) {
          setRedirecting(true);
          window.location.assign(res.checkoutUrl);
          return;
        }
        setDone({ ref: res.ref, token: res.token });
        haptic('success');
        window.scrollTo({ top: 0, behavior: inShell() ? 'auto' : 'smooth' });
        flash('התור נקבע · אישור נשלח בוואטסאפ');
        return;
      }
      haptic('warning');
      if (res.error === 'slot_taken') {
        setWeeks(m => {
          const next = { ...m };
          for (const k of Object.keys(next)) if (k.startsWith(svc.id + ':')) delete next[k];
          return next;
        });
        setSlot(null);
        setStepNotice({ step: 3, text: 'השעה שבחרתם נתפסה הרגע. בחרו שעה אחרת מהרשימה המעודכנת.' });
        setDir('back');
        setStep(3);
        return;
      }
      if (res.error === 'no_practitioner') {
        setStaffPick(null);
        setSlot(null);
        setStepNotice({ step: 2, text: 'המטפלת שבחרתם כבר לא זמינה לטיפול הזה. בחרו מטפלת אחרת.' });
        setDir('back');
        setStep(2);
        return;
      }
      setServerError(res.error);
    });
  };

  const restart = () => {
    clearDraft(draftKey);
    setResumed(false);
    setDir('back');
    setDone(null);
    setSvcId(null);
    setStaffPick(null);
    setSlot(null);
    setWeek(0);
    setAutoDay(true);
    setWeeks({});
    setTried(false);
    setServerError(null);
    setConsents({ health: false, policy: false, marketing: false });
    setForm(data.prefill);
    setStep(1);
  };

  // ---------- Pieces ----------

  const consultHref = svc ? `/consult/${branch.slug}?t=${svc.id}` : `/consult/${branch.slug}`;
  const waitlistHref = svc ? `/waitlist/${branch.slug}?t=${svc.id}` : `/waitlist/${branch.slug}`;
  const staffLabel = staffPick === 'any' ? 'כל מטפלת פנויה' : pickedStaff?.name ?? null;

  const errorMessages: Record<SubmitError, ReactNode> = {
    invalid: 'חלק מהפרטים חסרים או שגויים. בדקו ונסו שוב.',
    rate_limited: 'נקבעו כבר כמה תורים מהמספר הזה בשעה האחרונה. לתור נוסף, פנו לקליניקה ישירות.',
    failed: 'משהו השתבש בשמירת התור. נסו שוב בעוד רגע.',
    not_found: 'הטיפול כבר לא זמין לקביעה אונליין. אפשר לבחור טיפול אחר או לפנות לקליניקה.',
    medical_needs_consult: (
      <>
        הטיפול הזה הוא פעולה רפואית, ולכן נדרש ייעוץ לפני קביעת התור. <Link href={consultHref}>לקביעת ייעוץ רפואי</Link>
      </>
    ),
    slot_taken: 'השעה שבחרתם נתפסה הרגע. בחרו שעה אחרת.',
    no_practitioner: 'המטפלת שבחרתם כבר לא זמינה לטיפול הזה. בחרו מטפלת אחרת.',
    payments_unavailable: (
      <>
        לא ניתן לגבות כרגע את דמי הקדימה אונליין, ולכן התור לא נשמר.
        {branch.phone && (
          <>
            {' '}
            אפשר לקבוע בטלפון:{' '}
            <a href={telHref(branch.phone)} className="ltr tnum">
              {fromE164(branch.phone)}
            </a>
          </>
        )}
      </>
    ),
  };

  // ---------- Step rail ----------

  const stepNote = (n: Step) => {
    if (n === 1) return svc ? svc.name : 'בחרו מהתפריט';
    if (n === 2) return staffLabel ?? 'לפי הטיפול';
    if (n === 3) return slot && slotKey ? `${DOW[dowOf(slotKey)]} ${dateText(slotKey)} · ${timeOfIso(slot)}` : 'שעות פנויות';
    return done ? 'הושלם' : 'שם, טלפון, אישורים';
  };

  const rail = (
    <ol className={`${s.rail} bf-desk-only`}>
      {([1, 2, 3, 4] as Step[]).map(n => {
        const cur = !done && step === n;
        const isDone = !!done || n < reach;
        const locked = n > reach || !!done;
        return (
          <li key={n} className={s.railItem}>
            <button type="button" className={s.railBtn} data-cur={cur || undefined} data-locked={locked || undefined} disabled={locked} aria-current={cur ? 'step' : undefined} onClick={() => !locked && go(n)}>
              <span aria-hidden="true" className={s.railDot} data-state={cur ? 'cur' : isDone ? 'done' : 'todo'}>
                {isDone && !cur ? '✓' : n}
              </span>
              <span className={s.railText}>
                <span className={s.railName}>{STEP_NAMES[n]}</span>
                <span className={s.railNote}>{stepNote(n)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  // ---------- Step 1 ----------

  const shown = treatments.filter(t => cat === 'all' || t.catSlug === cat);
  const groups = data.categories.map(c => ({ ...c, items: shown.filter(t => t.catSlug === c.slug) })).filter(g => g.items.length);
  const hasMedical = treatments.some(t => t.isMedical);

  const tag = (t: BookTreatment) =>
    t.isMedical
      ? { text: 'נדרש ייעוץ רפואי', tone: 'warn' }
      : t.bookable
        ? { text: 'זמין לקביעה מיידית', tone: 'ok' }
        : { text: 'תיאום מול הקליניקה', tone: 'neutral' };

  const step1 = (
    <section aria-labelledby="bk-h1" className={s.card}>
      <h2 id="bk-h1" ref={el => { headingRefs.current['1'] = el; }} tabIndex={-1} className={s.h2}>
        איזה טיפול תרצו לקבוע?
      </h2>
      <p className={s.lead}>
        המחירים לא כוללים מע״מ.
        {hasMedical && ' טיפולי הזרקה מחייבים ייעוץ אצל רופא/ה, ולכן קובעים קודם פגישת ייעוץ.'}
      </p>

      {data.categories.length > 1 && (
        <div role="group" aria-label="סינון לפי תחום" className={s.chips}>
          {[{ slug: 'all', name: 'כל הטיפולים' }, ...data.categories].map(c => (
            <button key={c.slug} type="button" aria-pressed={cat === c.slug} className={s.chip} onClick={() => setCat(c.slug)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div role="radiogroup" aria-labelledby="bk-h1" onKeyDown={radioKeys} className={s.svcGroups}>
        {groups.map(g => (
          <div key={g.slug} className={s.svcGroup}>
            {groups.length > 1 && <h3 className={s.groupName}>{g.name}</h3>}
            <div className={s.svcGrid}>
              {g.items.map(t => {
                const on = svcId === t.id;
                const tg = tag(t);
                const selectable = t.bookable || t.isMedical;
                const tabbable = on || (!svcId && t.id === shown.find(x => x.bookable || x.isMedical)?.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!selectable}
                    tabIndex={tabbable ? 0 : -1}
                    className={s.svc}
                    onClick={() => pickTreatment(t)}
                  >
                    <span className={s.svcTop}>
                      <span className={s.svcName}>{t.name}</span>
                      <span className={s.svcPriceWrap}>
                        <Price t={t} className={s.svcPrice} />
                        <span className={s.vatNote}>לא כולל מע״מ</span>
                      </span>
                    </span>
                    <span className={s.svcMeta}>
                      <span className={s.svcCat}>
                        {t.catName} · <span className="ltr tnum">{t.durationMin}</span> דק׳
                      </span>
                      <span className={s.tag} data-tone={tg.tone}>
                        {tg.text}
                      </span>
                    </span>
                    {t.depositAgorot > 0 && !t.isMedical && (
                      <span className={s.svcDep}>
                        דמי קדימה <span className="ltr tnum">{nisFromAgorot(t.depositAgorot)}</span> · מקוזזים מהתשלום
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  // ---------- Step 2 ----------

  const countFor = (pid: string | 'any') => (week0 ? week0.reduce((a, d) => a + d.slots.filter(x => pid === 'any' || x.practitionerIds.includes(pid)).length, 0) : null);
  const svcStaff = svc ? svc.staffIds.map(id => staffById.get(id)).filter(Boolean) as Array<NonNullable<ReturnType<typeof staffById.get>>> : [];
  const staffNote = !svc
    ? 'בחרו קודם טיפול.'
    : svcStaff.length > 1
      ? `${COUNT_WORDS[svcStaff.length] ?? svcStaff.length} מטפלות מבצעות את ${svc.name}. בחרו את מי שמתאימה לכם, או כל מטפלת פנויה.`
      : 'את הטיפול הזה מבצעת מטפלת אחת בקליניקה.';

  const staffCard = (id: string | 'any', body: { name: string; role: string; init: ReactNode; color: string; tint: string }, first: boolean) => {
    const on = staffPick === id;
    const n = countFor(id);
    return (
      <button key={id} type="button" role="radio" aria-checked={on} tabIndex={on || (!staffPick && first) ? 0 : -1} className={s.person} onClick={() => pickStaff(id)}>
        <span aria-hidden="true" className={s.avatar} style={{ background: body.tint, color: body.color }}>
          {body.init}
        </span>
        <span className={s.personText}>
          <span className={s.personName}>{body.name}</span>
          <span className={s.personRole}>{body.role}</span>
          <span className={s.personAvail}>{n === null ? 'בודקים זמינות…' : weekTxt(n)}</span>
        </span>
      </button>
    );
  };

  const step2 = (
    <section aria-labelledby="bk-h2" className={s.card}>
      <h2 id="bk-h2" ref={el => { headingRefs.current['2'] = el; }} tabIndex={-1} className={s.h2}>
        מי תבצע את הטיפול?
      </h2>
      <p className={s.lead}>{staffNote}</p>
      {stepNotice?.step === 2 && <p className={s.error} role="alert">{stepNotice.text}</p>}
      <div role="radiogroup" aria-labelledby="bk-h2" onKeyDown={radioKeys} className={`${s.two} ${s.people}`}>
        {svcStaff.map((p, i) => staffCard(p.id, { name: p.name, role: p.role, init: p.init, ...p.tone }, i === 0))}
        {svcStaff.length > 1 && staffCard('any', { name: 'ללא העדפה', role: 'כל מטפלת פנויה בקליניקה', init: <PeopleGlyph />, color: '#5B6B7B', tint: '#F0F3F5' }, false)}
      </div>
    </section>
  );

  // ---------- Step 3 ----------

  const weekStart = addDays(todayKey, week * 7);
  const weekKey = svc ? cacheKey(svc.id, week) : '';
  const weekLoading = !!svc && !weekDays && loadFailed !== weekKey;
  const slotGroups = BUCKETS.map(b => ({
    ...b,
    slots: daySlots.filter(x => {
      const h = Number(x.time.slice(0, 2));
      return h >= b.from && h < b.to;
    }),
  })).filter(g => g.slots.length);

  const step3 = (
    <section aria-labelledby="bk-h3" className={s.card}>
      <h2 id="bk-h3" ref={el => { headingRefs.current['3'] = el; }} tabIndex={-1} className={s.h2}>
        בחירת מועד
      </h2>
      <p className={s.lead}>
        השעות הפנויות מתעדכנות לפי היומן של {pickedStaff?.name ?? 'הקליניקה'}. {closedDaysText(branch.hours)}
      </p>
      {stepNotice?.step === 3 && <p className={s.error} role="alert">{stepNotice.text}</p>}

      <div className={s.weekNav}>
        <button type="button" className={s.weekBtn} onClick={() => changeWeek(week - 1)} disabled={week === 0} aria-label="שבוע קודם">
          <ArrowGlyph size={15} back />
        </button>
        <span className={s.weekLabel}>{weekLabel(weekStart)}</span>
        <button type="button" className={s.weekBtn} onClick={() => changeWeek(week + 1)} disabled={week >= SLOT_WEEKS - 1} aria-label="שבוע הבא">
          <ArrowGlyph size={15} />
        </button>
      </div>

      {loadFailed === weekKey && svc ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>לא הצלחנו לטעון את השעות הפנויות</p>
          <button type="button" className={s.softBtn} onClick={() => fetchWeek(svc.id, week, true)}>
            נסו שוב
          </button>
        </div>
      ) : weekLoading ? (
        <div className={s.loadingBox} aria-busy="true">
          טוענים שעות פנויות…
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="בחירת יום" onKeyDown={radioKeys} className={s.days}>
            {Array.from({ length: 7 }, (_, k) => {
              const key = addDays(weekStart, k);
              const d = weekDays?.find(x => x.date === key);
              const closed = !d?.open;
              const on = key === dayKey;
              const n = slotsOf(d).length;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${key === todayKey ? 'היום' : DOW[dowOf(key)]} ${dateText(key)}, ${closed ? 'סגור' : freeTxt(n)}`}
                  tabIndex={on || (!dayKey && k === 0) ? 0 : -1}
                  disabled={closed}
                  className={s.day}
                  onClick={() => {
                    setDayKey(key);
                    setSlot(null);
                  }}
                >
                  <span className={s.dayDow}>{key === todayKey ? 'היום' : DOW[dowOf(key)]}</span>
                  <span className={`${s.dayDom} ltr`}>{dom(key)}</span>
                  <span className={s.dayNote}>{closed ? 'סגור' : freeTxt(n)}</span>
                </button>
              );
            })}
          </div>

          {slotGroups.map(g => (
            <div key={g.name} className={s.slotGroup}>
              <div className={s.slotHead}>
                <h3 className={s.slotName}>{g.name}</h3>
                <span className={s.slotCount}>{freeTxt(g.slots.length)}</span>
              </div>
              <div role="radiogroup" aria-label={`שעות ${g.name}`} onKeyDown={radioKeys} className={s.slots}>
                {g.slots.map((x, i) => {
                  const on = slot === x.startsAt;
                  return (
                    <button
                      key={x.startsAt}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on || (!slot && i === 0) ? 0 : -1}
                      dir="ltr"
                      className={s.slot}
                      onClick={() => setSlot(x.startsAt)}
                    >
                      {x.time}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {dayKey && slotGroups.length === 0 && (
            <div className={s.empty}>
              <p className={s.emptyTitle}>אין שעות פנויות ביום הזה</p>
              <p className={s.emptyText}>נסו יום אחר, או הצטרפו לרשימת ההמתנה ונעדכן אתכם כשיתפנה תור.</p>
              <Link href={waitlistHref} className={s.softBtn}>
                הצטרפו לרשימת ההמתנה
              </Link>
            </div>
          )}
          {!dayKey && (
            <div className={s.empty}>
              <p className={s.emptyTitle}>הקליניקה סגורה בשבוע הזה</p>
              <p className={s.emptyText}>נסו שבוע אחר, או הצטרפו לרשימת ההמתנה ונעדכן אתכם כשיתפנה תור.</p>
              <Link href={waitlistHref} className={s.softBtn}>
                הצטרפו לרשימת ההמתנה
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );

  // ---------- Summary (desktop sidebar; a collapsible card at the top of step 4 in the shell) ----------

  const summary: Array<{ label: string; value: ReactNode; strong?: boolean; muted?: boolean }> = [
    { label: 'טיפול', value: svc ? svc.name : 'טרם נבחר', strong: !!svc, muted: !svc },
    { label: 'משך', value: svc ? <><span className="ltr tnum">{svc.durationMin}</span> דקות</> : 'לפי הטיפול', muted: !svc },
    { label: 'מטפלת', value: staffLabel ?? 'טרם נבחרה', muted: !staffLabel },
    {
      label: 'מועד',
      value: slot ? <>{slotWhen} · <span className="ltr tnum">{timeOfIso(slot)}</span></> : 'טרם נבחר',
      muted: !slot,
    },
    {
      label: 'דמי קדימה',
      value: dep > 0 ? <span className="ltr tnum">{nisFromAgorot(dep)}</span> : policy.depositOn ? 'ללא' : 'הקליניקה אינה גובה',
    },
  ];

  const summaryFold = svc && (
    <details className={`${s.fold} bf-shell-only`}>
      <summary className={s.foldHead}>
        <span className={s.foldText}>
          <span className={s.foldTitle}>סיכום ההזמנה</span>
          <span className={s.foldSub}>
            {svc.name}
            {slot && (
              <>
                {' · '}
                {slotKey && DOW[dowOf(slotKey)]} <span className="ltr tnum">{timeOfIso(slot)}</span>
              </>
            )}
          </span>
        </span>
        <Price t={svc} className={s.foldPrice} />
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s.foldChevron}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <dl className={s.foldDl}>
        {summary.map(r => (
          <div key={r.label} className={s.sumRow}>
            <dt>{r.label}</dt>
            <dd data-strong={r.strong || undefined} data-muted={r.muted || undefined}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className={s.foldNote}>
        {svc.priceAgorot > 0 ? (
          <>
            המחיר לא כולל מע״מ · <span className="ltr tnum">{nisFromAgorot(vatIncl(svc.priceAgorot))}</span> כולל מע״מ · תשלום בקליניקה
            {dep > 0 && ' · דמי הקדימה מקוזזים מהסכום'}
          </>
        ) : (
          'תשלום בקליניקה · חשבונית מס מהקליניקה'
        )}
      </p>
    </details>
  );

  // ---------- Step 4 ----------

  const policyNote =
    dep > 0 ? (
      <>
        ביטול מאוחר יותר: דמי הקדימה בסך <span className="ltr tnum">{nisFromAgorot(dep)}</span> לא מוחזרים
      </>
    ) : (
      'ביטול מאוחר יותר: הקליניקה רשאית לחייב דמי ביטול מאוחר'
    );
  const consentDefs: Array<{ key: keyof typeof consents; label: ReactNode; note: ReactNode }> = [
    {
      key: 'health',
      label: 'אני מתחייב/ת לדווח לקליניקה לפני הטיפול על מצב רפואי, תרופות, הריון או הנקה',
      note: svc?.requiresDeclaration ? 'הצהרת בריאות מלאה נשלחת בוואטסאפ ונחתמת דיגיטלית לפני הטיפול' : 'הצהרת בריאות מלאה נחתמת דיגיטלית בקליניקה לפני הטיפול הראשון',
    },
    {
      key: 'policy',
      label: (
        <>
          אני מאשר/ת את מדיניות הביטולים: ביטול עד <span className="ltr tnum">{refundH}</span> שעות לפני התור ללא חיוב
        </>
      ),
      note: policyNote,
    },
    { key: 'marketing', label: 'אשמח לקבל עדכונים ומבצעים בוואטסאפ', note: 'לא חובה · אפשר לבטל בכל הודעה' },
  ];

  const field = (key: 'name' | 'phone' | 'email', v: string) => setForm(f => ({ ...f, [key]: v }));

  const step4 = (
    <section aria-labelledby="bk-h4" className={s.card} ref={step4Ref}>
      {summaryFold}
      <h2 id="bk-h4" ref={el => { headingRefs.current['4'] = el; }} tabIndex={-1} className={`${s.h2} ${s.h2Solo}`}>
        הפרטים שלכם
      </h2>

      <div className={s.two}>
        <label className={s.label}>
          שם מלא
          <input value={form.name} onChange={e => field('name', e.target.value)} autoComplete="name" className={s.input} aria-invalid={tried && !nameOk} maxLength={80} />
        </label>
        <label className={s.label}>
          טלפון נייד
          <input
            value={form.phone}
            onChange={e => field('phone', e.target.value)}
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="052-000-0000"
            className={`${s.input} ${s.inputLtr}`}
            aria-invalid={tried && !phoneOk}
            maxLength={20}
          />
        </label>
        <label className={s.label}>
          <span>
            דוא״ל <span className={s.optional}>· לא חובה</span>
          </span>
          <input
            value={form.email}
            onChange={e => field('email', e.target.value)}
            dir="ltr"
            inputMode="email"
            autoComplete="email"
            className={`${s.input} ${s.inputLtr}`}
            aria-invalid={tried && !emailOk}
            maxLength={120}
          />
        </label>
      </div>

      <div className={s.consents}>
        <h3 className={s.h3}>אישורים</h3>
        <ul className={s.consentList}>
          {consentDefs.map(c => {
            const on = consents[c.key];
            return (
              <li key={c.key}>
                <button type="button" role="checkbox" aria-checked={on} className={s.consent} onClick={() => setConsents(x => ({ ...x, [c.key]: !x[c.key] }))} data-invalid={(tried && !on && c.key !== 'marketing') || undefined}>
                  <span aria-hidden="true" className={s.box}>
                    {on && <CheckGlyph size={13} strokeWidth={2.2} />}
                  </span>
                  <span className={s.consentText}>
                    <span className={s.consentLabel}>{c.label}</span>
                    <span className={s.consentNote}>{c.note}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {dep > 0 && (
        <div className={s.depBox}>
          <h3 className={s.depTitle}>
            דמי קדימה <span className="ltr tnum">{nisFromAgorot(dep)}</span>
          </h3>
          <p className={s.depText}>
            התשלום מתבצע בדף סליקה מאובטח של הקליניקה מיד אחרי האישור, והשעה נשמרת עבורכם עד להשלמתו. הסכום מקוזז מהתשלום על הטיפול, ומוחזר במלואו בביטול עד{' '}
            <span className="ltr tnum">{refundH}</span> שעות לפני התור. בביטול מאוחר יותר או באי־הגעה, דמי הקדימה לא מוחזרים.
          </p>
        </div>
      )}

      {/* In the shell the same messages sit above the sticky button (ActionBar error). */}
      {tried && !formOk && (
        <p className={`${s.error} bf-desk-only`} role="alert">
          {errText}
        </p>
      )}
      {serverError && (
        <p className={`${s.error} bf-desk-only`} role="alert">
          {errorMessages[serverError]}
        </p>
      )}
    </section>
  );

  // ---------- Done ----------

  const calEvent = () => ({
    uid: `${done?.ref}@beautyfind.co.il`,
    title: `${svc?.name ?? 'תור'} · ${branch.name}`,
    startsAt: slot!,
    durationMin: svc?.durationMin ?? 60,
    location: branch.address,
    details: `אסמכתא ${done?.ref}. ניהול התור: ${window.location.origin}/b/${done?.token}`,
  });

  const doneView = done && svc && slot && (
    <section aria-labelledby="bk-h5" className={`${s.card} ${s.doneCard}`}>
      <span aria-hidden="true" className={s.ring}>
        <CheckGlyph size={27} strokeWidth={2} />
      </span>
      <h2 id="bk-h5" ref={el => { headingRefs.current.done = el; }} tabIndex={-1} className={s.doneTitle}>
        התור נקבע
      </h2>
      <p className={s.doneBody}>אישור נשלח בוואטסאפ, ותזכורת תישלח לפני התור. לשינוי מועד או ביטול, היכנסו לניהול התור.</p>
      <div className={s.doneLinks}>
        <Link href={`/b/${done.token}`} className={`${s.doneLink} bf-desk-only`}>
          ניהול התור
        </Link>
        {svc.requiresDeclaration && (
          <Link href={`/b/${done.token}/declaration`} className={s.doneLink}>
            מילוי הצהרת בריאות
          </Link>
        )}
      </div>

      <dl className={s.doneDl}>
        <dt>אסמכתא</dt>
        <dd className={`${s.ddStrong} ltr tnum`}>{done.ref}</dd>
        <dt>טיפול</dt>
        <dd className={s.ddSemi}>
          {svc.name} · <span className="ltr tnum">{svc.durationMin}</span> דק׳
        </dd>
        <dt>מטפלת</dt>
        <dd className={s.ddSemi}>{staffLabel}</dd>
        <dt>מועד</dt>
        <dd className={s.ddSemi}>
          {slotWhen} · <span className="ltr tnum">{timeOfIso(slot)}</span>
        </dd>
        <dt>כתובת</dt>
        <dd>{branch.address}</dd>
      </dl>

      {/* Shell: two stacked actions, the rest as quiet links. */}
      <div className={`${s.doneStack} bf-shell-only`}>
        <Link href={`/b/${done.token}`} className={s.primaryBtn}>
          ניהול התור
        </Link>
        <button type="button" className={s.ghostBtn} onClick={() => { downloadIcs(calEvent(), `${done.ref}.ics`); flash('קובץ היומן הורד. מתאים ל־Google, ל־Outlook ול־iPhone'); }}>
          הוספה ליומן
        </button>
        <p className={s.doneMore}>
          <a href={wazeHref(branch.wazeUrl, branch.address)} target="_blank" rel="noopener noreferrer">
            ניווט ב־Waze
          </a>
          {branch.whatsapp && (
            <a href={waLink(branch.whatsapp, `שלום ${branch.name}, קבעתי תור דרך BeautyFind (אסמכתא ${done.ref}).`)} target="_blank" rel="noopener noreferrer">
              הודעה לקליניקה
            </a>
          )}
          <button type="button" onClick={restart}>
            תור נוסף
          </button>
        </p>
      </div>

      <div className={`${s.doneActions} bf-desk-only`}>
        <button type="button" className={s.primaryBtn} onClick={() => { downloadIcs(calEvent(), `${done.ref}.ics`); flash('קובץ היומן הורד. מתאים ל־Google, ל־Outlook ול־iPhone'); }}>
          הוספה ליומן
        </button>
        <a href={wazeHref(branch.wazeUrl, branch.address)} target="_blank" rel="noopener noreferrer" className={s.ghostBtn}>
          ניווט ב־Waze
        </a>
        {branch.whatsapp && (
          <a href={waLink(branch.whatsapp, `שלום ${branch.name}, קבעתי תור דרך BeautyFind (אסמכתא ${done.ref}).`)} target="_blank" rel="noopener noreferrer" className={s.ghostBtn}>
            שליחת הודעה לקליניקה
          </a>
        )}
        <button type="button" className={s.textBtn} onClick={restart}>
          קביעת תור נוסף
        </button>
      </div>

      <p className={s.doneFoot}>
        ביטול או שינוי עד <span className="ltr tnum">{refundH}</span> שעות לפני התור ללא חיוב. בביטול מאוחר יותר, הקליניקה רשאית לחייב דמי ביטול.
      </p>
    </section>
  );

  // ---------- Footer nav ----------

  let nextLabel = '';
  let nextHint: ReactNode = '';
  let nextOk = false;
  if (step === 1) {
    nextOk = !!svc && (svc.bookable || svc.isMedical);
    nextLabel = needsConsult ? 'המשך לקביעת ייעוץ רפואי' : 'המשך לבחירת מטפלת';
    nextHint = !svc
      ? 'בחרו טיפול כדי להמשיך'
      : needsConsult
        ? `הטיפול שבחרתם הוא פעולה רפואית. בשלב הבא בוחרים מועד לייעוץ${branch.medical ? ` עם ${branch.medical.name}` : ' עם רופא/ה'} ועונים על כמה שאלות קצרות.`
        : (
          <>
            {svc.name} · <span className="ltr tnum">{svc.durationMin}</span> דקות
          </>
        );
  } else if (step === 2) {
    nextOk = !!staffPick;
    nextLabel = 'המשך לבחירת מועד';
    nextHint = !staffPick ? 'בחרו מטפלת כדי להמשיך' : staffPick === 'any' ? 'נציג את כל השעות הפנויות בקליניקה' : `היומן של ${pickedStaff?.name} ייטען בשלב הבא`;
  } else if (step === 3) {
    nextOk = !!slot;
    nextLabel = 'המשך למילוי פרטים';
    nextHint = slot ? (
      <>
        {slotWhen} בשעה <span className="ltr tnum">{timeOfIso(slot)}</span>
      </>
    ) : (
      'בחרו שעה פנויה כדי להמשיך'
    );
  } else {
    nextOk = true;
    nextLabel = redirecting ? 'מעבירים לדף התשלום…' : pending ? 'שומרים את התור…' : dep > 0 ? 'אישור ומעבר לתשלום דמי הקדימה' : 'אישור וקביעת התור';
    nextHint = formOk ? (
      <>
        אישור יישלח בוואטסאפ למספר <span className="ltr tnum">{form.phone.trim()}</span>
      </>
    ) : (
      'שדות חובה: שם, טלפון ושני האישורים הראשונים'
    );
  }
  const busy = pending || redirecting;

  // Shell: the primary is never greyed out. Tapping it early explains what is missing (warning haptic).
  const next = () => {
    if (step === 4) submit();
    else if (nextOk) go((step + 1) as Step);
    else {
      setNudge(true);
      haptic('warning');
    }
  };
  const barError: ReactNode =
    step === 4 && serverError ? errorMessages[serverError] : step === 4 && tried && !formOk ? errText : nudge && !nextOk ? nextHint : null;
  const actionBar = !done && (
    <ActionBar mobileOnly hint={barError ? undefined : nextHint} error={barError}>
      {step === 1 && needsConsult ? (
        <Link href={consultHref} className={s.barBtn}>
          {nextLabel}
        </Link>
      ) : (
        <button type="button" className={s.barBtn} data-off={(step !== 4 && !nextOk) || undefined} disabled={busy} aria-busy={busy || undefined} onClick={next}>
          {nextLabel}
        </button>
      )}
    </ActionBar>
  );

  const footer = !done && (
    <div className={`${s.footer} bf-desk-only`}>
      <div className={s.footRow}>
        {step > 1 && (
          <button type="button" className={s.backBtn} onClick={() => go((step - 1) as Step)} disabled={busy}>
            חזרה
          </button>
        )}
        {step === 1 && needsConsult ? (
          <Link href={consultHref} className={s.nextBtn}>
            {nextLabel}
          </Link>
        ) : (
          <button
            type="button"
            className={s.nextBtn}
            disabled={busy || (step !== 4 && !nextOk)}
            aria-disabled={step !== 4 && !nextOk}
            onClick={() => {
              if (step === 4) submit();
              else if (nextOk) go((step + 1) as Step);
            }}
          >
            {nextLabel}
          </button>
        )}
      </div>
      <p className={s.hint}>{nextHint}</p>
    </div>
  );

  // ---------- Aside ----------

  const todayDow = dowOf(todayKey);

  const aside = (
    <aside className={`${s.aside} bf-desk-only`}>
      <div className={s.sumCard}>
        <div className={s.sumHead}>
          <h2 className={s.sumTitle}>סיכום ההזמנה</h2>
        </div>
        <dl className={s.sumDl}>
          {summary.map(r => (
            <div key={r.label} className={s.sumRow}>
              <dt>{r.label}</dt>
              <dd data-strong={r.strong || undefined} data-muted={r.muted || undefined}>
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className={s.total}>
          <div className={s.totalRow}>
            <span className={s.totalLabel}>מחיר הטיפול</span>
            {svc ? <Price t={svc} className={s.totalText} /> : <span className={s.totalEmpty}>טרם נבחר טיפול</span>}
          </div>
          <p className={s.totalNote}>
            {svc && svc.priceAgorot > 0 ? (
              <>
                לא כולל מע״מ · <span className="ltr tnum">{nisFromAgorot(vatIncl(svc.priceAgorot))}</span> כולל מע״מ · תשלום בקליניקה, תשלומים לפי הקליניקה · חשבונית מס מהקליניקה
                {dep > 0 && ' · דמי הקדימה מקוזזים מהסכום'}
              </>
            ) : (
              'המחירים לא כוללים מע״מ · תשלום בקליניקה · חשבונית מס מהקליניקה'
            )}
          </p>
        </div>
      </div>

      <div className={s.hoursCard}>
        <h3 className={s.h3}>שעות פעילות</h3>
        {branch.hours ? (
          <ul className={s.hoursList}>
            {hoursRows(branch.hours).map(r => (
              <li key={r.day} className={s.hoursRow} data-today={r.days.includes(todayDow) || undefined}>
                <span className={s.hoursDay}>{r.day}</span>
                <span className={r.closed ? s.hoursH : `${s.hoursH} ltr tnum`} data-closed={r.closed || undefined}>
                  {r.h}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.hoursNone}>הקליניקה לא פרסמה שעות פעילות.</p>
        )}
        <p className={s.medLine}>
          {branch.medical && (
            <>
              אחריות רפואית: {branch.medical.name}
              {branch.medical.license && (
                <>
                  , רישיון <span className="ltr tnum">{branch.medical.license}</span>
                </>
              )}
              .{' '}
            </>
          )}
          טיפולי אסתטיקה אינם בסל הבריאות.
        </p>
        <p className={s.asideLinks}>
          {branch.medical && <Link href={branch.medical.href}>על {branch.medical.name}</Link>}
          <Link href={waitlistHref}>רשימת המתנה</Link>
          <Link href={ROUTES.accessibility}>הצהרת נגישות</Link>
          <Link href={ROUTES.terms}>תקנון</Link>
        </p>
      </div>
    </aside>
  );

  // ---------- Page ----------

  const closedForOnline = !branch.onlineBooking || treatments.length === 0;

  return (
    <div className={s.root}>
      <TopBar
        mode="flow"
        title="קביעת תור"
        progress={closedForOnline || done ? undefined : { step, total: 4 }}
        noBack={step === 1 || !!done || closedForOnline}
        onBack={() => step > 1 && !busy && go((step - 1) as Step)}
        closeHref={branch.profileHref}
      />
      <header className={`${s.header} bf-desk-only`}>
        <div className={s.headerIn}>
          <Link href="/" className={s.logo} aria-label="BeautyFind, לדף הבית">
            <Wordmark size={21} />
          </Link>
          <span aria-hidden="true" className={s.headSep} />
          <span className={s.headBiz}>
            <span className={s.headName}>{branch.name}</span>
            <span className={s.headSub}>
              {branch.address}
              {branch.medical && ` · אחריות רפואית: ${branch.medical.name}`}
            </span>
          </span>
          {branch.phone && <PhoneButton e164={branch.phone} />}
          <Link href={branch.profileHref} className={s.profileLink}>
            <ArrowGlyph size={15} />
            <span>לפרופיל הקליניקה</span>
          </Link>
        </div>
      </header>

      <div className={s.wrap}>
        <h1 className={s.h1}>קביעת תור</h1>
        <p className={s.intro}>בחרו טיפול ומועד פנוי. אישור נשלח בוואטסאפ מיד עם הקביעה, ותזכורת נשלחת לפני התור.</p>

        <p className="sr-only" aria-live="polite">
          {liveText}
        </p>

        {!closedForOnline && rail}

        <div className={s.grid}>
          <main className={s.main}>
            {closedForOnline ? (
              <section className={s.card} aria-labelledby="bk-closed">
                <h2 id="bk-closed" className={s.h2}>
                  {treatments.length === 0 ? 'אין כרגע טיפולים לקביעה אונליין' : 'הקליניקה לא מקבלת כרגע תורים אונליין'}
                </h2>
                <p className={s.lead}>אפשר לתאם ישירות מול הקליניקה בטלפון או בוואטסאפ.</p>
                <div className={s.contactRow}>
                  {branch.whatsapp && <WhatsAppButton e164={branch.whatsapp} text={`שלום ${branch.name}, הגעתי דרך BeautyFind ואשמח לקבוע תור.`} />}
                  {branch.phone && <PhoneButton e164={branch.phone} label="חיוג" />}
                </div>
              </section>
            ) : done ? (
              doneView
            ) : (
              // Keyed per step so each screen enters with its slide (shell) or fade (desktop).
              <div key={step} className={s.pane} data-dir={dir}>
                {resumed && (
                  <p className={s.resumed} role="status">
                    <span>המשכנו מהמקום שבו עצרתם.</span>
                    <button type="button" onClick={restart}>
                      התחלה מחדש
                    </button>
                  </p>
                )}
                {step === 1 && step1}
                {step === 2 && step2}
                {step === 3 && step3}
                {step === 4 && step4}
              </div>
            )}
            {!closedForOnline && footer}
          </main>
          {aside}
        </div>
      </div>
      {!closedForOnline && actionBar}

      <Toast text={toast} />
    </div>
  );
}
