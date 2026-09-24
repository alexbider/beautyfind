'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { ConfirmSheet } from '@/components/dashboard/ConfirmSheet';
import { revealFirstInvalid, useSheetMode } from '@/components/dashboard/media';
import { ActionBar } from '@/components/shell/ActionBar';
import { haptic } from '@/components/shell/haptics';
import { TopBar } from '@/components/shell/TopBar';
import { ROUTES } from '@/lib/routes';
import { acceptInvite, declineInvite, requestNewInvite, sendInviteCode, switchAccount, type AcceptResult } from './actions';
import type { Fail, InviteState } from './invite';
import {
  LICENSE_LABEL,
  PROFS,
  checkForm,
  invitePath,
  maskPhone,
  needsLicense,
  staffCountText,
  takesCert,
  type FormField,
  type InviteForm,
  type Need,
  type Prof,
  type RoleSummary,
} from './shared';
import styles from './InviteScreen.module.css';

// Design: project/BeautyFind Staff Invite.dc.html

export type ScreenState = InviteState | 'notfound' | 'member';

export type ScreenInvite = {
  email: string;
  name: string | null;
  bizName: string;
  city: string | null;
  staffCount: number;
  inviterName: string;
  sent: string;
  expires: string;
  role: RoleSummary;
};

export type ScreenViewer =
  | { mode: 'new' | 'self'; need: Need; knownName: string | null; knownPhone: string | null }
  | { mode: 'signin'; signedInAs: string | null }
  | { mode: 'switch'; signedInAs: string };

const Ltr = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span dir="ltr" className={`ltr ${className ?? ''}`}>
    {children}
  </span>
);

const loginHref = (token: string) => `${ROUTES.bizLogin}&next=${encodeURIComponent(invitePath(token))}`;

function useToast() {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (t: string) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(''), 3200);
  };
  return [toast, flash] as const;
}

export function InviteScreen({
  token: initialToken,
  state: initialState,
  invite: initialInvite,
  viewer: initialViewer,
}: {
  token: string | null;
  state: ScreenState;
  invite: ScreenInvite | null;
  viewer: ScreenViewer | null;
}) {
  const [state, setState] = useState<ScreenState>(initialState);
  // Accepting sets cookies, which re-renders this page with the invite now "used" and no token.
  // Keep what the screen started with so the success step isn't replaced mid-flow.
  const [token] = useState(initialToken);
  const [invite] = useState(initialInvite);
  const [viewer] = useState(initialViewer);
  const [toast, flash] = useToast();
  // App shell: the join form reports its step so the flow top bar can show progress and back.
  const [flow, setFlow] = useState<Flow | null>(null);

  return (
    <div className={styles.root}>
      <TopBar
        mode="flow"
        title={flow?.step === 'done' ? 'ברוכים הבאים' : 'הצטרפות לצוות'}
        progress={flow && flow.step !== 'done' ? { step: flow.index, total: flow.total } : undefined}
        noBack={!flow?.back}
        onBack={() => flow?.back?.()}
        closeHref={flow?.step === 'done' ? ROUTES.dashboard : ROUTES.home}
      />
      <header className={`${styles.header} bf-desk-only`}>
        <div className={styles.headerInner}>
          <Link href={ROUTES.home} aria-label="BeautyFind, לדף הבית" className={styles.logo}>
            <Wordmark size={21} />
          </Link>
          <span className={styles.forBiz}>לעסקים</span>
        </div>
      </header>

      <main className={styles.wrap}>
        {state === 'valid' && token && invite && viewer ? (
          <ValidInvite
            token={token}
            invite={invite}
            viewer={viewer}
            flash={flash}
            onFlow={setFlow}
            onDeclined={() => {
              setState('declined');
              flash(`ההזמנה נדחתה. שלחנו עדכון ל${invite.inviterName}`);
            }}
          />
        ) : (
          <StateCard state={state} token={token} invite={invite} flash={flash} focus={state !== initialState} />
        )}
      </main>

      <div role="status" aria-live="polite" className={styles.toastRegion}>
        {toast && <div className={styles.toast}>{toast}</div>}
      </div>
    </div>
  );
}

/* ---------- Not found · expired · used · declined · revoked · already a member ---------- */

function StateCard({
  state,
  token,
  invite,
  flash,
  focus,
}: {
  state: ScreenState;
  token: string | null;
  invite: ScreenInvite | null;
  flash: (t: string) => void;
  focus: boolean;
}) {
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const h1 = useRef<HTMLHeadingElement>(null);

  // A decline swaps the form for this card: move focus to its heading.
  useEffect(() => {
    if (focus) h1.current?.focus();
  }, [focus]);

  const requestNew = async () => {
    if (!token || !invite || busy || asked) return;
    setBusy(true);
    const res = await requestNewInvite({ token }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setAsked(true);
      flash(`הבקשה נשלחה ל${invite.inviterName}`);
    } else flash('לא הצלחנו לשלוח את הבקשה. נסו שוב בעוד רגע.');
  };

  const requestButton = (
    <button type="button" className={styles.cardBtn} onClick={requestNew} disabled={busy || asked} aria-busy={busy || undefined}>
      {asked ? 'הבקשה נשלחה' : 'בקשת הזמנה חדשה'}
    </button>
  );
  const home = (
    <Link href={ROUTES.home} className={styles.cardBtn}>
      לדף הבית
    </Link>
  );

  let title: string;
  let body: ReactNode;
  let action: ReactNode;
  switch (state) {
    case 'expired':
      title = 'פג תוקף ההזמנה';
      body = (
        <>
          הזמנה לצוות תקפה 7 ימים. ההזמנה הזו ל{invite?.bizName} נשלחה ב־<Ltr className={styles.num}>{invite?.sent}</Ltr>. אפשר לבקש מ{invite?.inviterName} הזמנה חדשה.
        </>
      );
      action = requestButton;
      break;
    case 'used':
      title = 'ההזמנה כבר מומשה';
      body = (
        <>
          כבר הצטרפת ל{invite?.bizName} עם הכתובת <Ltr>{invite?.email}</Ltr>. אפשר פשוט להתחבר.
        </>
      );
      action = (
        <Link href={`${ROUTES.bizLogin}&next=${encodeURIComponent(ROUTES.dashboard)}`} className={styles.cardBtn}>
          כניסה
        </Link>
      );
      break;
    case 'member':
      title = 'כבר חלק מהצוות';
      body = <>החשבון שלך כבר משויך ל{invite?.bizName}, אין צורך לקבל את ההזמנה שוב.</>;
      action = (
        <a href={ROUTES.dashboard} className={styles.cardBtn}>
          ללוח הבקרה
        </a>
      );
      break;
    case 'declined':
      title = 'ההזמנה נדחתה';
      body = <>ההזמנה ל{invite?.bizName} נדחתה, והקישור כבר לא פעיל. אם זו טעות, אפשר לבקש מ{invite?.inviterName} הזמנה חדשה.</>;
      action = requestButton;
      break;
    case 'revoked':
      title = 'ההזמנה בוטלה';
      body = <>ההזמנה ל{invite?.bizName} בוטלה על ידי הקליניקה. אם זו טעות, אפשר לפנות ל{invite?.inviterName} ולבקש הזמנה חדשה.</>;
      action = home;
      break;
    default:
      title = 'ההזמנה לא נמצאה';
      body = <>ייתכן שהקישור הועתק חלקית. פתחו את הקישור המלא מהמייל, או בקשו ממנהל/ת הקליניקה לשלוח הזמנה חדשה.</>;
      action = home;
  }

  return (
    <div className={styles.card}>
      <h1 ref={h1} tabIndex={-1} className={styles.cardH1}>
        {title}
      </h1>
      <p className={styles.cardP}>{body}</p>
      {action}
    </div>
  );
}

/* ---------- Valid invite ---------- */

type Step = 'details' | 'code' | 'done';
type Flow = { step: Step; index: number; total: number; back: (() => void) | null };
type Done = Extract<AcceptResult, { ok: true }>;

function ValidInvite({
  token,
  invite,
  viewer,
  flash,
  onFlow,
  onDeclined,
}: {
  token: string;
  invite: ScreenInvite;
  viewer: ScreenViewer;
  flash: (t: string) => void;
  onFlow: (f: Flow | null) => void;
  onDeclined: () => void;
}) {
  const { role } = invite;
  const sub = [invite.city, staffCountText(invite.staffCount)].filter(Boolean).join(' · ');

  return (
    <div className={styles.grid}>
      <section aria-labelledby="inv-h" className={styles.col}>
        <span className={styles.badge}>הזמנה לצוות</span>
        <h1 id="inv-h" className={styles.h1}>
          {invite.inviterName} מזמין/ה אותך לצוות של {invite.bizName}
        </h1>
        <p className={styles.sub}>
          {sub} · ההזמנה בתוקף עד <Ltr className={styles.num}>{invite.expires}</Ltr>
        </p>

        <div className={styles.roleCard}>
          <div className={styles.roleHead}>
            <span className={styles.roleHeadLabel}>ההרשאה שלך</span>
            <span className={styles.rolePill}>{role.name}</span>
          </div>
          <div className={styles.roleBody}>
            <div>
              <span className={`${styles.listLabel} ${styles.listLabelOk}`} id="inv-can">
                אפשר
              </span>
              <ul className={styles.list} aria-labelledby="inv-can">
                {role.can.map(c => (
                  <li key={c} className={styles.item}>
                    <span aria-hidden="true" className={`${styles.mark} ${styles.markOk}`}>+</span>
                    <span className={styles.itemText}>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <span className={styles.listLabel} id="inv-cannot">
                לא כלול
              </span>
              <ul className={styles.list} aria-labelledby="inv-cannot">
                {role.cannot.map(c => (
                  <li key={c} className={`${styles.item} ${styles.itemNo}`}>
                    <span aria-hidden="true" className={`${styles.mark} ${styles.markNo}`}>–</span>
                    <span className={styles.itemText}>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className={styles.roleFoot}>מנהלי הקליניקה יכולים לשנות את ההרשאה בכל עת. כל פעולה שלך נרשמת ביומן הפעולות.</p>
        </div>
      </section>

      <section aria-label="יצירת חשבון" className={styles.formCard}>
        {'need' in viewer ? (
          <JoinForm token={token} invite={invite} viewer={viewer} flash={flash} onFlow={onFlow} onDeclined={onDeclined} />
        ) : (
          <AccountGate token={token} invite={invite} viewer={viewer} flash={flash} onDeclined={onDeclined} />
        )}
      </section>
    </div>
  );
}

/* ---------- Decline (two taps, it cannot be undone) ---------- */

function DeclineLine({ token, invite, flash, onDeclined, withTerms }: { token: string; invite: ScreenInvite; flash: (t: string) => void; onDeclined: () => void; withTerms: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  // Below 768px the confirmation is a bottom sheet.
  const sheet = useSheetMode();

  useEffect(() => {
    if (confirm && !sheet) yesRef.current?.focus();
  }, [confirm, sheet]);

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    const res = await declineInvite({ token }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDeclined();
    else if (res && res.error === 'invite_gone') window.location.reload();
    else flash('לא הצלחנו לדחות את ההזמנה. נסו שוב בעוד רגע.');
  };

  return (
    <>
      <p className={styles.fine}>
        {withTerms && (
          <>
            בהצטרפות מאשרים את <Link href={ROUTES.terms}>תנאי השימוש לעסקים</Link>.{' '}
          </>
        )}
        ההזמנה לא מיועדת לך?{' '}
        <button type="button" className={`${styles.inlineBtn} ${styles.hit}`} aria-expanded={confirm} onClick={() => setConfirm(c => !c)}>
          דחיית ההזמנה
        </button>
      </p>
      <ConfirmSheet
        open={confirm && sheet}
        title="דחיית ההזמנה"
        body={<p>לדחות את ההזמנה ל{invite.bizName}? אחרי הדחייה הקישור לא יעבוד, ונשלח עדכון ל{invite.inviterName}.</p>}
        confirmLabel="כן, לדחות"
        pending={busy}
        onConfirm={decline}
        onCancel={() => setConfirm(false)}
      />
      {confirm && !sheet && (
        <div className={styles.confirm} role="group" aria-label="אישור דחיית ההזמנה">
          <p className={styles.confirmText}>לדחות את ההזמנה ל{invite.bizName}? אחרי הדחייה הקישור לא יעבוד, ונשלח עדכון ל{invite.inviterName}.</p>
          <div className={styles.confirmRow}>
            <button ref={yesRef} type="button" className={styles.dangerBtn} onClick={decline} disabled={busy} aria-busy={busy || undefined}>
              כן, לדחות
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => setConfirm(false)}>
              ביטול
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Signed out of the right account ---------- */

function AccountGate({
  token,
  invite,
  viewer,
  flash,
  onDeclined,
}: {
  token: string;
  invite: ScreenInvite;
  viewer: Extract<ScreenViewer, { mode: 'signin' | 'switch' }>;
  flash: (t: string) => void;
  onDeclined: () => void;
}) {
  const signin = viewer.mode === 'signin';
  return (
    <div className={styles.stack}>
      <h2 className={styles.h2}>{signin ? 'כבר יש לך חשבון' : 'החשבון המחובר שונה'}</h2>
      {signin ? (
        <p className={styles.body}>
          הכתובת <Ltr>{invite.email}</Ltr> כבר רשומה ב־BeautyFind. כדי לקבל את ההזמנה צריך להתחבר לחשבון הזה.
          {viewer.signedInAs && (
            <>
              {' '}
              כרגע מחובר החשבון <Ltr>{viewer.signedInAs}</Ltr>.
            </>
          )}
        </p>
      ) : (
        <p className={styles.body}>
          ההזמנה נשלחה ל־<Ltr>{invite.email}</Ltr>, והחשבון המחובר כרגע הוא <Ltr>{viewer.signedInAs}</Ltr>. כדי להצטרף עם הכתובת שבהזמנה צריך קודם לצאת מהחשבון הנוכחי.
        </p>
      )}
      {signin && !viewer.signedInAs ? (
        <Link href={loginHref(token)} className={styles.submitLink}>
          כניסה והמשך
        </Link>
      ) : (
        <form action={switchAccount}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="then" value={signin ? 'login' : 'invite'} />
          <button type="submit" className={styles.submit}>
            {signin ? 'יציאה וכניסה לחשבון הנכון' : 'יציאה והמשך'}
          </button>
        </form>
      )}
      <DeclineLine token={token} invite={invite} flash={flash} onDeclined={onDeclined} withTerms={false} />
    </div>
  );
}

/* ---------- Details → code → done ---------- */

const ERR: Record<Fail['error'], string> = {
  invite_gone: 'ההזמנה כבר לא בתוקף. רעננו את הדף כדי לראות את המצב העדכני.',
  signin_required: 'כדי לקבל את ההזמנה צריך להתחבר לחשבון עם הכתובת שבהזמנה. רעננו את הדף.',
  already_member: 'החשבון הזה כבר חלק מהצוות.',
  invalid_input: 'חלק מהפרטים אינם תקינים. בדקו ונסו שוב.',
  phone_taken: 'המספר הזה כבר רשום בחשבון אחר ב־BeautyFind. הזינו מספר אחר, או התחברו לחשבון הזה.',
  email_taken: 'כתובת המייל כבר רשומה. התחברו לחשבון ונסו שוב.',
  cooldown: '',
  otp_invalid: 'הקוד שגוי. בדקו את הספרות ונסו שוב.',
  otp_expired: 'תוקף הקוד פג. שלחו קוד חדש.',
  otp_too_many: 'היו יותר מדי ניסיונות. שלחו קוד חדש.',
};

// Draft (spec §3.4): everything but the password survives a reload of the invite link.
const draftKey = (token: string) => `bf-invite-draft:${token}`;

function JoinForm({
  token,
  invite,
  viewer,
  flash,
  onFlow,
  onDeclined,
}: {
  token: string;
  invite: ScreenInvite;
  viewer: Extract<ScreenViewer, { mode: 'new' | 'self' }>;
  flash: (t: string) => void;
  onFlow: (f: Flow | null) => void;
  onDeclined: () => void;
}) {
  const { need } = viewer;
  const [step, setStep] = useState<Step>('details');
  const [f, setF] = useState<InviteForm>({ name: need.name ? (invite.name ?? '') : '', phone: '', password: '', profession: '', license: '', specialty: '', cert: '' });
  const [hydrated, setHydrated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    try {
      const d = JSON.parse(window.localStorage.getItem(draftKey(token)) ?? 'null') as Partial<InviteForm> | null;
      if (d) setF(s => ({ ...s, ...d, password: '' }));
    } catch {
      // A broken or blocked draft is ignored.
    }
    setHydrated(true);
  }, [token]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (step === 'done') window.localStorage.removeItem(draftKey(token));
      else window.localStorage.setItem(draftKey(token), JSON.stringify({ ...f, password: '' }));
    } catch {
      // Storage can be blocked (private mode). The draft is a convenience only.
    }
  }, [hydrated, token, f, step]);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ text: ReactNode; field?: FormField } | null>(null);
  const [code, setCode] = useState('');
  const [codeTried, setCodeTried] = useState(false);
  const [codeErr, setCodeErr] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  // Focus follows the step: the code box, or the new heading.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (step === 'code') codeRef.current?.focus();
    else headRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const total = need.phone ? 3 : 2;
    const index = step === 'details' ? 1 : step === 'code' ? 2 : total;
    onFlow({ step, index, total, back: step === 'code' ? () => setStep('details') : null });
    return () => onFlow(null);
  }, [step, need.phone, onFlow]);

  const check = checkForm(f, need);
  const localErr = tried ? check : null;
  const badField: FormField | undefined = localErr?.field ?? serverErr?.field;
  const invalid = (k: FormField) => (badField === k ? true : undefined);
  const errText: ReactNode = localErr?.error ?? serverErr?.text ?? null;
  const withCode = need.phone;
  const prof = f.profession;

  const set = (k: keyof InviteForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setF(s => ({ ...s, [k]: v }));
    if (serverErr) setServerErr(null);
  };

  const showFail = (res: Fail, where: 'details' | 'code') => {
    if (res.error === 'invite_gone' || res.error === 'signin_required') {
      setServerErr({
        text: (
          <>
            {ERR[res.error]}{' '}
            <button type="button" className={styles.alertBtn} onClick={() => window.location.reload()}>
              רענון
            </button>
          </>
        ),
      });
      setStep('details');
      return;
    }
    if (res.error === 'already_member') {
      setServerErr({
        text: (
          <>
            {ERR.already_member} <a href={ROUTES.dashboard}>ללוח הבקרה</a>
          </>
        ),
      });
      setStep('details');
      return;
    }
    if (res.error === 'cooldown') {
      const msg = (
        <>
          אפשר לשלוח קוד חדש בעוד <Ltr>{res.retryInSeconds ?? 30}</Ltr> שנ׳.
        </>
      );
      if (where === 'code') setCodeErr(msg);
      return;
    }
    if (where === 'code' && res.error.startsWith('otp_')) {
      setCodeErr(ERR[res.error]);
      setCode('');
      codeRef.current?.focus();
      return;
    }
    setServerErr({ text: ERR[res.error], field: res.error === 'phone_taken' ? 'phone' : undefined });
    setStep('details');
  };

  const accept = async (withCodeValue: string | null) => {
    setBusy(true);
    const res = await acceptInvite({ token, form: f, code: withCodeValue }).catch(() => null);
    setBusy(false);
    if (!res) {
      const msg = 'משהו השתבש. נסו שוב בעוד רגע.';
      if (step === 'code') setCodeErr(msg);
      else setServerErr({ text: msg });
      return;
    }
    if (!res.ok) return showFail(res, step === 'code' ? 'code' : 'details');
    haptic('success');
    setDone(res);
    setStep('done');
  };

  const submitDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setServerErr(null);
    if (check) {
      setTried(true);
      haptic('warning');
      revealFirstInvalid(formRef.current);
      return;
    }
    if (!withCode) return accept(null);
    setBusy(true);
    const res = await sendInviteCode({ token, form: f }).catch(() => null);
    setBusy(false);
    if (!res) return setServerErr({ text: 'לא הצלחנו לשלוח קוד. נסו שוב בעוד רגע.' });
    // A code still cooling down was already sent: carry on to the code step.
    if (!res.ok && res.error !== 'cooldown') return showFail(res, 'details');
    setCode('');
    setCodeTried(false);
    setCodeErr(null);
    setStep('code');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setCodeTried(true);
    setCodeErr(null);
    if (code.length !== 6) return;
    await accept(code);
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    const res = await sendInviteCode({ token, form: f }).catch(() => null);
    setBusy(false);
    if (!res) return flash('לא הצלחנו לשלוח קוד. נסו שוב בעוד רגע.');
    if (res.ok) {
      setCodeErr(null);
      flash(`קוד חדש נשלח. אפשר לבקש שוב בעוד ${res.cooldownSeconds} שניות`);
    } else if (res.error === 'cooldown') flash(`אפשר לשלוח קוד חדש בעוד ${res.retryInSeconds ?? 30} שניות`);
    else showFail(res, 'code');
  };

  // Roving focus for the profession radio group (RTL: left arrow moves forward).
  const profRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onProfKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = (i + dir + PROFS.length) % PROFS.length;
    setF(s => ({ ...s, profession: PROFS[n].key }));
    profRefs.current[n]?.focus();
  };
  const pick = (p: Prof) => setF(s => ({ ...s, profession: p }));

  if (step === 'done' && done) {
    const doneBody =
      `הצטרפת ל${done.bizName} בהרשאת ${done.roleName}.` +
      (done.verification === 'license'
        ? ' מספר הרישיון נשלח לאימות, ונעדכן במייל כשיאושר (בדרך כלל תוך יום עסקים).' +
          (done.profession === 'doctor' ? ' השם שלך יופיע בפרופיל תחת ״אחריות רפואית״ רק אחרי האישור.' : ' הרישיון יוצג בפרופיל כמאומת רק אחרי האישור.')
        : done.verification === 'cert'
          ? ' מספר התעודה נשלח לבדיקה, ואחרי האישור השם שלך יופיע בפרופיל תחת ״איש מקצוע אחראי״.'
          : ` שלחנו עדכון ל${done.inviterName}.`);
    return (
      <div className={styles.done}>
        <span aria-hidden="true" className={styles.doneIcon}>
          <svg width="26" height="26" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 7.5 5.5 10.5 11.5 4" />
          </svg>
        </span>
        <h2 ref={headRef} tabIndex={-1} className={styles.doneH}>
          {done.firstName ? `ברוכים הבאים, ${done.firstName}` : 'ברוכים הבאים'}
        </h2>
        <p className={styles.doneP}>{doneBody}</p>
        <div className={styles.doneRow}>
          <a href={ROUTES.dashboard} className={styles.cardBtn}>
            ללוח הבקרה
          </a>
        </div>
      </div>
    );
  }

  if (step === 'code') {
    const codeBad = codeTried && code.length !== 6;
    return (
      <form id="inv-code-form" noValidate onSubmit={verify} className={`${styles.stack} ${styles.fade}`}>
        <h2 ref={headRef} tabIndex={-1} className={styles.h2}>
          קוד אימות
        </h2>
        <p className={styles.codeNote} id="inv-code-note">
          שלחנו קוד בן 6 ספרות ל־<Ltr className={styles.codePhone}>{maskPhone(f.phone)}</Ltr>
        </p>
        <input
          ref={codeRef}
          dir="ltr"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={e => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            setCodeErr(null);
          }}
          placeholder="• • • • • •"
          aria-label="קוד אימות"
          aria-describedby={codeBad || codeErr ? 'inv-code-note inv-code-err' : 'inv-code-note'}
          aria-invalid={codeBad || !!codeErr || undefined}
          className={styles.codeInput}
        />
        {(codeBad || codeErr) && (
          <p role="alert" id="inv-code-err" className={styles.codeErr}>
            {codeBad ? 'הקוד צריך להכיל 6 ספרות' : codeErr}
          </p>
        )}
        <button type="submit" className={`${styles.submit} bf-desk-only`} disabled={busy} aria-busy={busy || undefined}>
          אימות והצטרפות
        </button>
        <ActionBar mobileOnly hint="הקוד נשלח ב־SMS">
          <button type="submit" form="inv-code-form" className={styles.submit} disabled={busy} aria-busy={busy || undefined}>
            אימות והצטרפות
          </button>
        </ActionBar>
        <div className={styles.codeLinks}>
          <button type="button" className={`${styles.textBtn} ${styles.textBtnTeal}`} onClick={resend} disabled={busy}>
            שליחה חוזרת
          </button>
          <button
            type="button"
            className={styles.textBtn}
            onClick={() => {
              setCode('');
              setCodeTried(false);
              setCodeErr(null);
              setStep('details');
            }}
          >
            תיקון מספר
          </button>
        </div>
      </form>
    );
  }

  const licLabel = prof ? LICENSE_LABEL[prof] : undefined;
  return (
    <form ref={formRef} id="inv-details-form" noValidate onSubmit={submitDetails} className={styles.stack}>
      <h2 ref={headRef} tabIndex={-1} className={styles.h2}>
        הפרטים שלך
      </h2>
      <label className={styles.label}>
        מייל
        <input dir="ltr" type="email" value={invite.email} readOnly autoComplete="username" aria-describedby="inv-email-note" className={`${styles.input} ${styles.inputLtr} ${styles.inputRo}`} />
        <span id="inv-email-note" className={styles.hint}>
          נקבע בהזמנה ולא ניתן לשינוי
        </span>
      </label>

      {need.name ? (
        <label className={styles.label}>
          שם מלא
          <input value={f.name} onChange={set('name')} autoComplete="name" placeholder="מאיה כהן" aria-invalid={invalid('name')} className={styles.input} />
        </label>
      ) : (
        viewer.knownName && (
          <label className={styles.label}>
            שם מלא
            <input value={viewer.knownName} readOnly className={`${styles.input} ${styles.inputRo}`} />
          </label>
        )
      )}

      {need.phone ? (
        <label className={styles.label}>
          טלפון נייד
          <input
            dir="ltr"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={f.phone}
            onChange={set('phone')}
            placeholder="050-000-0000"
            aria-invalid={invalid('phone')}
            aria-describedby="inv-phone-note"
            className={`${styles.input} ${styles.inputLtr} ${styles.num}`}
          />
          <span id="inv-phone-note" className={styles.hint}>
            לאימות בכניסה: נשלח קוד ב־SMS
          </span>
        </label>
      ) : (
        viewer.knownPhone && (
          <label className={styles.label}>
            טלפון נייד
            <input dir="ltr" value={viewer.knownPhone} readOnly className={`${styles.input} ${styles.inputLtr} ${styles.inputRo} ${styles.num}`} />
          </label>
        )
      )}

      {need.password && (
        <label className={styles.label}>
          סיסמה
          <input
            type="password"
            autoComplete="new-password"
            value={f.password}
            onChange={set('password')}
            aria-invalid={invalid('password')}
            aria-describedby="inv-pass-note"
            className={styles.input}
          />
          <span id="inv-pass-note" className={styles.hint}>
            לפחות 8 תווים, לכניסה ללוח הבקרה
          </span>
        </label>
      )}

      <div>
        <span id="inv-prof" className={styles.groupLabel}>
          תפקיד בקליניקה
        </span>
        <div role="radiogroup" aria-labelledby="inv-prof" aria-invalid={invalid('profession')} className={styles.profGrid}>
          {PROFS.map((p, i) => {
            const on = prof === p.key;
            return (
              <button
                key={p.key}
                ref={el => {
                  profRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on || (!prof && i === 0) ? 0 : -1}
                onClick={() => pick(p.key)}
                onKeyDown={onProfKey(i)}
                className={`${styles.prof} ${badField === 'profession' ? styles.profBad : ''}`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {needsLicense(prof) && licLabel && (
        <div className={styles.licBox}>
          <label className={styles.label}>
            {licLabel}
            <input
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              value={f.license}
              onChange={set('license')}
              placeholder="34-82115"
              aria-invalid={invalid('license')}
              className={`${styles.input} ${styles.inputLtr} ${styles.num}`}
            />
          </label>
          <label className={styles.label}>
            התמחות (לא חובה)
            <input value={f.specialty} onChange={set('specialty')} autoComplete="off" placeholder="רפואה אסתטית" className={styles.input} />
          </label>
          <p className={styles.licNote}>
            {prof === 'doctor'
              ? 'המספר נבדק מול פנקס משרד הבריאות לפני שהשם שלך יופיע בפרופיל תחת ״אחריות רפואית״. עד האימות אפשר לעבוד במערכת כרגיל.'
              : 'המספר נבדק מול פנקס משרד הבריאות לפני שהרישיון יוצג בפרופיל כמאומת. עד האימות אפשר לעבוד במערכת כרגיל.'}
          </p>
        </div>
      )}

      {takesCert(prof) && (
        <div className={styles.licBox}>
          <label className={styles.label}>
            מספר תעודה מקצועית (לא חובה)
            <input
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              value={f.cert}
              onChange={set('cert')}
              aria-invalid={invalid('cert')}
              className={`${styles.input} ${styles.inputLtr} ${styles.num}`}
            />
          </label>
          <p className={styles.licNote}>עם תעודה מאומתת, השם שלך יוצג בפרופיל תחת ״איש מקצוע אחראי״. אפשר להוסיף אותה גם מאוחר יותר.</p>
        </div>
      )}

      {errText && (
        <p role="alert" className={`${styles.alert} bf-desk-only`}>
          {errText}
        </p>
      )}
      <button type="submit" className={`${styles.submit} bf-desk-only`} disabled={busy} aria-busy={busy || undefined}>
        {withCode ? 'שליחת קוד אימות' : 'הצטרפות לצוות'}
      </button>
      <ActionBar mobileOnly error={errText ?? undefined} hint={errText ? undefined : withCode ? 'בשלב הבא נשלח קוד אימות לטלפון' : 'ההרשאה נקבעה על ידי מנהלי הקליניקה'}>
        <button type="submit" form="inv-details-form" className={styles.submit} disabled={busy} aria-busy={busy || undefined}>
          {withCode ? 'שליחת קוד אימות' : 'הצטרפות לצוות'}
        </button>
      </ActionBar>
      <DeclineLine token={token} invite={invite} flash={flash} onDeclined={onDeclined} withTerms />
    </form>
  );
}
