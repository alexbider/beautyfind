'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { haptic } from '@/components/shell/haptics';
import { goBack } from '@/components/shell/nav';
import { TopBar } from '@/components/shell/TopBar';
import { EMAIL_RE, IL_PHONE_RE, fromE164, toE164 } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import {
  completePasswordReset,
  completeSignup,
  passwordSignin,
  requestPasswordReset,
  sendSigninCode,
  sendSignupCode,
  verifySigninCode,
  type AuthError,
  type CodeSent,
  type Fail,
  type SignedIn,
} from './actions';
import { OTP_LEN, OtpInput } from './OtpInput';
import styles from './AuthScreen.module.css';

export type Role = 'client' | 'biz';
/** forgot = request a reset link; reset = choose a new password from an emailed link. */
export type AuthView = 'signin' | 'signup' | 'otp' | 'forgot' | 'sent' | 'reset';
type Method = 'password' | 'otp';
type Channel = 'whatsapp' | 'sms';
type Stat = { n: string; label: string };

const ASIDE: Record<Role, { title: string; points: Array<{ name: string; note: string }>; stats?: Stat[] }> = {
  client: {
    title: 'תור אצל מטפלת מאומתת, בלי טלפונים ובלי המתנה',
    points: [
      { name: 'יומן אמיתי', note: 'רואים את השעות הפנויות בפועל וקובעים בשלוש נקישות' },
      { name: 'התורים שלכם במקום אחד', note: 'שינוי או ביטול לפי מדיניות הקליניקה, בלי שיחה' },
      { name: 'ביקורות מאומתות בלבד', note: 'ביקורת נכתבת רק אחרי טיפול שהתקיים בפועל' },
    ],
  },
  biz: {
    title: 'הפרופיל, היומן והלקוחות במערכת אחת',
    points: [
      { name: 'פניות ישר ל־CRM', note: 'כל פנייה מהפרופיל נכנסת לניהול הלקוחות עם מקור' },
      { name: 'יומן, מלאי ואוטומציות', note: 'תזכורות בוואטסאפ וניכוי מלאי אוטומטי לכל טיפול' },
      { name: 'הרשאות לפי תפקיד', note: 'מזכירה, קוסמטיקאית והנהלת חשבונות רואות רק את שלהן' },
    ],
    // Marketing figures from the design, kept as designed.
    stats: [
      { n: '86%', label: 'פניות נענות' },
      { n: '4.8', label: 'דירוג ממוצע' },
      { n: '18%', label: 'צמיחה' },
    ],
  },
};

type TermKey = 'tos' | 'owner' | 'marketing';
const TERMS: Record<Role, Array<[TermKey, string]>> = {
  client: [
    ['tos', 'קראתי ואני מאשר/ת את התקנון ואת מדיניות הפרטיות'],
    ['marketing', 'אשמח לקבל עדכונים ומבצעים בוואטסאפ (לא חובה)'],
  ],
  biz: [
    ['tos', 'קראתי ואני מאשר/ת את התקנון, את מדיניות הפרטיות ואת תקן הרישום'],
    ['owner', 'אני בעל/ת העסק או מוסמך/ת לפעול בשמו'],
    ['marketing', 'אשמח לקבל עדכונים מקצועיים בדוא״ל (לא חובה)'],
  ],
};

const ROLE_TABS: Array<[Role, string]> = [
  ['client', 'לקוחות'],
  ['biz', 'עסקים'],
];

function passScore(p: string) {
  if (!p) return 0;
  let n = 0;
  if (p.length >= 8) n++;
  if (/[A-Z\u0590-\u05FF]/.test(p)) n++;
  if (/\d/.test(p)) n++;
  if (/[^\w\s]/.test(p)) n++;
  return n;
}
const PW_COLOR = ['#A33A31', '#A33A31', '#9A5B15', '#0B7A87', '#3B6B3F'];
const pwLabel = (p: string, s: number) => (!p ? 'לפחות 8 תווים' : s <= 1 ? 'חלשה' : s === 2 ? 'בינונית' : s === 3 ? 'טובה' : 'חזקה');

const isPhone = (v: string) => IL_PHONE_RE.test(v.trim());
const isEmail = (v: string) => EMAIL_RE.test(v.trim());

type ServerErr = { text: ReactNode; action?: { label: string; run: () => void } };

const Ltr = ({ children, bold }: { children: ReactNode; bold?: boolean }) => (
  <span className="ltr" style={bold ? { fontWeight: 700, whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}>
    {children}
  </span>
);

function CheckMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.5 5.5 10.5 11.5 4" />
    </svg>
  );
}

function PasswordMeter({ value }: { value: string }) {
  const s = passScore(value);
  const color = PW_COLOR[s];
  return (
    <div className={styles.meter}>
      <span aria-hidden="true" className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: `${(s / 4) * 100}%`, background: color }} />
      </span>
      <span className={styles.meterLabel} style={{ color }} aria-live="polite">
        {pwLabel(value, s)}
      </span>
    </div>
  );
}

export function AuthScreen({
  initialRole,
  initialView,
  next,
  reset,
  clientStats,
}: {
  initialRole: Role;
  initialView: AuthView;
  next: string | null;
  reset: { email: string; token: string; valid: boolean } | null;
  clientStats: Stat[];
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [view, setView] = useState<AuthView>(initialView);
  const [method, setMethod] = useState<Method>(initialRole === 'biz' ? 'password' : 'otp');
  const [f, setF] = useState({ ident: '', pass: '', name: '', biz: '', phone: '', email: '' });
  const [terms, setTerms] = useState<Partial<Record<TermKey, boolean>>>({});
  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<ServerErr | null>(null);
  const [toast, setToast] = useState('');
  const [otp, setOtp] = useState<string[]>(() => Array(OTP_LEN).fill(''));
  const [otpBad, setOtpBad] = useState(false);
  const [otpFlow, setOtpFlow] = useState<'signin' | 'signup'>('signin');
  const [otpPhone, setOtpPhone] = useState('');
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState('');
  const [resetValid, setResetValid] = useState(reset?.valid ?? false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const biz = role === 'biz';

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Keep role and view in the address bar so a refresh or a shared link lands in the same place.
  useEffect(() => {
    if (view !== 'signin' && view !== 'signup' && view !== 'forgot') return;
    const url = new URL(window.location.href);
    const sp = url.searchParams;
    if (biz) sp.set('role', 'biz');
    else sp.delete('role');
    if (view === 'signin') sp.delete('view');
    else sp.set('view', view === 'forgot' ? 'reset' : view);
    sp.delete('token');
    sp.delete('email');
    const nextUrl = url.pathname + (sp.toString() ? `?${sp}` : '');
    if (nextUrl !== window.location.pathname + window.location.search) window.history.replaceState(null, '', nextUrl);
  }, [biz, view]);

  // Move focus to the new heading when the view changes (the OTP view focuses its first box).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (view !== 'otp') h1Ref.current?.focus();
  }, [view]);

  // Auto-submit once all six digits are in (typed, pasted or filled from the SMS), once per code.
  const otpForm = useRef<HTMLFormElement>(null);
  const autoSent = useRef('');
  useEffect(() => {
    const code = otp.join('');
    if (code.length < OTP_LEN) autoSent.current = '';
    if (view !== 'otp' || busy || code.length !== OTP_LEN || autoSent.current === code) return;
    autoSent.current = code;
    otpForm.current?.requestSubmit();
  }, [otp, view, busy]);

  const flash = (t: string) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  };

  const setField = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setF(s => ({ ...s, [k]: v }));
  };

  const go = (v: AuthView, patch?: Partial<typeof f>) => {
    if (patch) setF(s => ({ ...s, ...patch }));
    setView(v);
    setTried(false);
    setServerErr(null);
  };

  const pickRole = (r: Role) => {
    setRole(r);
    setMethod(r === 'biz' ? 'password' : 'otp');
    setTried(false);
    setTerms({});
    setServerErr(null);
  };

  /* ---------- Validation (on submit, then live) ---------- */

  const identOk = method === 'otp' ? isPhone(f.ident) : isEmail(f.ident) || isPhone(f.ident);
  const passOk = f.pass.length >= 8;
  const nameOk = f.name.trim().length >= 2;
  const bizOk = !biz || f.biz.trim().length >= 2;
  const phoneOk = isPhone(f.phone);
  const emailOk = biz ? isEmail(f.email) : f.email.trim() === '' || isEmail(f.email);
  const signupPassOk = !biz || passOk;
  const termsOk = TERMS[role].filter(t => t[0] !== 'marketing').every(t => terms[t[0]]);
  const otpFull = otp.every(x => x !== '');
  const resetIdentOk = isEmail(f.ident) || isPhone(f.ident);

  const clientErr = (() => {
    if (!tried) return '';
    if (view === 'signin') {
      if (!identOk) return method === 'password' ? 'הזינו דוא״ל או טלפון תקין' : 'הזינו מספר טלפון נייד תקין';
      if (method === 'password' && !passOk) return 'הסיסמה חייבת להכיל לפחות 8 תווים';
      return '';
    }
    if (view === 'signup') {
      if (!nameOk) return 'נדרש שם מלא';
      if (!bizOk) return 'נדרש שם העסק';
      if (!phoneOk) return 'מספר טלפון נייד אינו תקין';
      if (!emailOk) return 'כתובת הדוא״ל אינה תקינה';
      if (!signupPassOk) return 'הסיסמה חייבת להכיל לפחות 8 תווים';
      if (!termsOk) return biz ? 'יש לאשר את התקנון ואת ההצהרה על בעלות בעסק' : 'יש לאשר את התקנון ואת מדיניות הפרטיות';
      return '';
    }
    if (view === 'otp' && !otpFull) return 'הזינו את כל שש הספרות של הקוד';
    if (view === 'forgot' && !resetIdentOk) return 'הזינו דוא״ל או טלפון תקין';
    if (view === 'reset' && !passOk) return 'הסיסמה חייבת להכיל לפחות 8 תווים';
    return '';
  })();

  /* ---------- Server results ---------- */

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setServerErr(null);
    try {
      return await fn();
    } catch {
      setServerErr({ text: 'משהו השתבש. נסו שוב בעוד רגע.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const signupForm = () => ({
    role,
    name: f.name,
    bizName: biz ? f.biz : undefined,
    phone: f.phone,
    email: f.email.trim(),
    password: biz ? f.pass : undefined,
    tos: terms.tos === true,
    owner: biz ? terms.owner === true : undefined,
    marketing: terms.marketing === true,
  });

  const showError = (res: Fail, ctx: 'signin' | 'signup' | 'otp' | 'reset') => {
    const e: AuthError = res.error;
    const msg: Record<AuthError, ServerErr> = {
      invalid_input: { text: 'חלק מהפרטים אינם תקינים. בדקו ונסו שוב.' },
      unknown_phone: {
        text: 'לא מצאנו חשבון עם המספר הזה.',
        action: { label: biz ? 'פתיחת חשבון עסקי' : 'הרשמה', run: () => go('signup', { phone: f.ident }) },
      },
      phone_taken: {
        text: 'המספר הזה כבר רשום אצלנו.',
        action: {
          label: 'כניסה',
          run: () => {
            setMethod('otp');
            go('signin', { ident: f.phone });
          },
        },
      },
      email_taken: {
        text: 'כתובת הדוא״ל כבר רשומה אצלנו.',
        action: {
          label: 'כניסה',
          run: () => {
            setMethod('password');
            go('signin', { ident: f.email.trim() });
          },
        },
      },
      cooldown: {
        text: (
          <>
            אפשר לשלוח קוד חדש בעוד <Ltr>{res.retryInSeconds ?? 30}</Ltr> שנ׳.
          </>
        ),
      },
      bad_credentials: { text: 'פרטי הכניסה שגויים. בדקו את הדוא״ל או הטלפון ואת הסיסמה.' },
      otp_invalid: { text: 'הקוד שגוי. בדקו את הספרות ונסו שוב.' },
      otp_expired: { text: 'תוקף הקוד פג. שלחו קוד חדש.' },
      otp_too_many: { text: 'יותר מדי ניסיונות. שלחו קוד חדש.' },
      reset_invalid: {
        text: 'הקישור לאיפוס אינו תקף. ייתכן שפג תוקפו או שכבר נעשה בו שימוש.',
        action: { label: 'שליחת קישור חדש', run: () => go('forgot', { ident: reset?.email ?? '' }) },
      },
    };
    if (e !== 'cooldown') haptic('warning');
    if (e === 'cooldown' && res.retryInSeconds) setCooldown(res.retryInSeconds);
    if (e === 'otp_invalid' || e === 'otp_expired' || e === 'otp_too_many') {
      setOtpBad(true);
      setOtp(Array(OTP_LEN).fill(''));
    }
    if (e === 'reset_invalid') setResetValid(false);
    // A code that is still cooling down was already sent: carry on to the code screen.
    if (e === 'cooldown' && ctx !== 'otp') return;
    setServerErr(msg[e]);
  };

  const enterOtp = (flow: 'signin' | 'signup', res: CodeSent, ch: Channel) => {
    setOtpFlow(flow);
    setOtpPhone(res.phone);
    setChannel(ch);
    setCooldown(res.cooldownSeconds);
    setOtp(Array(OTP_LEN).fill(''));
    setOtpBad(false);
    go('otp');
  };

  const finish = (res: SignedIn, toastText: string) => {
    haptic('success');
    flash(toastText);
    setBusy(true);
    router.replace(res.redirectTo);
    router.refresh();
  };

  /* ---------- Handlers ---------- */

  const submitSignin = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ok = method === 'password' ? identOk && passOk : identOk;
    if (!ok) {
      setTried(true);
      return;
    }
    if (method === 'otp') {
      const res = await run(() => sendSigninCode({ phone: f.ident, channel: 'whatsapp' }));
      if (!res) return;
      if (res.ok) {
        enterOtp('signin', res, 'whatsapp');
        flash('קוד נשלח בוואטסאפ');
      } else if (res.error === 'cooldown') {
        enterOtp('signin', { ok: true, phone: toE164(f.ident) ?? f.ident, cooldownSeconds: res.retryInSeconds ?? 30 }, channel);
      } else showError(res, 'signin');
      return;
    }
    const res = await run(() => passwordSignin({ ident: f.ident, password: f.pass, remember, next }));
    if (!res) return;
    if (res.ok) finish(res, res.kind === 'business' ? 'מתחברים ללוח הבקרה של העסק' : 'מתחברים לחשבון שלכם');
    else showError(res, 'signin');
  };

  const submitSignup = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!(nameOk && bizOk && phoneOk && emailOk && signupPassOk && termsOk)) {
      setTried(true);
      return;
    }
    const res = await run(() => sendSignupCode({ form: signupForm(), channel: 'whatsapp' }));
    if (!res) return;
    if (res.ok) {
      enterOtp('signup', res, 'whatsapp');
      flash('שלחנו קוד אימות בוואטסאפ');
    } else if (res.error === 'cooldown') {
      enterOtp('signup', { ok: true, phone: toE164(f.phone) ?? f.phone, cooldownSeconds: res.retryInSeconds ?? 30 }, channel);
    } else showError(res, 'signup');
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!otpFull) {
      setTried(true);
      return;
    }
    const code = otp.join('');
    const res = await run(() =>
      otpFlow === 'signin' ? verifySigninCode({ phone: otpPhone, code, remember, next }) : completeSignup({ form: signupForm(), code, remember, next }),
    );
    if (!res) return;
    if (res.ok) finish(res, res.kind === 'business' ? 'הקוד אומת, נכנסים ללוח הבקרה' : 'הקוד אומת, נכנסים לחשבון');
    else if (res.error === 'phone_taken' || res.error === 'email_taken') {
      go('signup');
      showError(res, 'signup');
    } else showError(res, 'otp');
  };

  const resend = async (ch: Channel) => {
    if (busy || cooldown > 0) return;
    const res = await run(() => (otpFlow === 'signin' ? sendSigninCode({ phone: otpPhone, channel: ch }) : sendSignupCode({ form: signupForm(), channel: ch })));
    if (!res) return;
    if (res.ok) {
      setChannel(ch);
      setCooldown(res.cooldownSeconds);
      setOtp(Array(OTP_LEN).fill(''));
      setOtpBad(false);
      setTried(false);
      flash(ch === 'sms' ? 'הקוד נשלח ב־SMS' : 'קוד חדש נשלח בוואטסאפ');
    } else showError(res, 'otp');
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!resetIdentOk) {
      setTried(true);
      return;
    }
    const res = await run(() => requestPasswordReset({ ident: f.ident }));
    if (!res) return;
    setSentTo(f.ident.trim());
    go('sent');
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !reset) return;
    if (!passOk) {
      setTried(true);
      return;
    }
    const res = await run(() => completePasswordReset({ email: reset.email, token: reset.token, password: f.pass, next }));
    if (!res) return;
    if (res.ok) finish(res, res.kind === 'business' ? 'הסיסמה עודכנה, נכנסים ללוח הבקרה' : 'הסיסמה עודכנה, נכנסים לחשבון');
    else showError(res, 'reset');
  };

  /* ---------- Copy ---------- */

  const sms = channel === 'sms';
  const titles: Record<AuthView, string> = {
    signin: biz ? 'כניסה לעסקים' : 'כניסה לחשבון',
    signup: biz ? 'פתיחת חשבון עסקי' : 'הרשמה',
    otp: sms ? 'אימות ב־SMS' : 'אימות בוואטסאפ',
    forgot: 'איפוס סיסמה',
    sent: 'הקישור נשלח',
    reset: 'בחירת סיסמה חדשה',
  };
  const subs: Record<AuthView, ReactNode> = {
    signin: biz ? 'לניהול הפרופיל, היומן והלקוחות של העסק.' : 'לצפייה בתורים, בעסקים המועדפים ובביקורות שכתבתם.',
    signup: biz ? 'אחרי ההרשמה נאמת את הבעלות על העסק ונפתח את לוח הבקרה.' : 'ההרשמה אורכת פחות מדקה, ואחריה קובעים תור בנקישה.',
    otp:
      otpFlow === 'signup'
        ? sms
          ? 'שלחנו קוד ב־SMS לאימות מספר הטלפון.'
          : 'שלחנו קוד בוואטסאפ לאימות מספר הטלפון.'
        : sms
          ? 'שלחנו קוד ב־SMS, אין צורך בסיסמה.'
          : 'שלחנו קוד בוואטסאפ, אין צורך בסיסמה.',
    forgot: 'נשלח קישור לאיפוס לדוא״ל או לטלפון שרשומים בחשבון.',
    sent: '',
    reset:
      reset && resetValid ? (
        <>
          לחשבון <Ltr>{reset.email}</Ltr>. לפחות 8 תווים.
        </>
      ) : (
        ''
      ),
  };

  const errorLine = clientErr ? { text: clientErr } : serverErr;
  const errorId = 'auth-error';
  const errorNode = errorLine ? (
      <p id={errorId} role="alert" className={styles.error}>
        {errorLine.text}
        {errorLine.action && (
          <>
            {' '}
            <button type="button" className={styles.errAction} onClick={errorLine.action.run}>
              {errorLine.action.label}
            </button>
          </>
        )}
      </p>
  ) : null;

  const invalid = (bad: boolean) => (tried && bad ? true : undefined);
  const describedBy = errorLine ? errorId : undefined;
  const aside = ASIDE[role];
  const stats = aside.stats ?? clientStats;

  // App shell: a focused flow with close (×); back steps inside the screen (code → phone, reset → sign in).
  const firstStep = view === 'signin' || view === 'signup';
  const stepBack = () => {
    if (view === 'otp') {
      if (otpFlow === 'signup') go('signup');
      else {
        setMethod('otp');
        go('signin');
      }
    } else {
      if (view === 'sent' || view === 'reset') setMethod('password');
      go('signin');
    }
  };

  return (
    <div className={styles.root}>
      <TopBar mode="flow" noBack={firstStep} onBack={stepBack} onClose={() => goBack(router, next ?? ROUTES.home)} />
      <div className={styles.shell}>
        <main className={styles.main}>
          <div className={styles.inner}>
            <Link href={ROUTES.home} className={`${styles.logo} bf-desk-only`} aria-label="BeautyFind, לדף הבית">
              <Wordmark size={25} />
            </Link>

            {(view === 'signin' || view === 'signup') && (
              <div role="group" aria-label="סוג חשבון" className={styles.roleTabs}>
                {ROLE_TABS.map(([r, name]) => (
                  <button key={r} type="button" aria-pressed={role === r} className={`${styles.roleTab} ${styles.hit}`} onClick={() => pickRole(r)}>
                    {name}
                  </button>
                ))}
              </div>
            )}

            <h1 ref={h1Ref} tabIndex={-1} className={styles.h1}>
              {titles[view]}
            </h1>
            {subs[view] ? <p className={styles.sub}>{subs[view]}</p> : null}

            {view === 'signin' && (
              <form key={`signin-${method}`} noValidate onSubmit={submitSignin} className={styles.form} aria-busy={busy}>
                <label className={styles.label}>
                  {method === 'password' ? 'דוא״ל או טלפון' : 'טלפון נייד'}
                  <input
                    value={f.ident}
                    onChange={setField('ident')}
                    dir="ltr"
                    type={method === 'password' ? 'text' : 'tel'}
                    inputMode={method === 'password' ? 'email' : 'tel'}
                    autoComplete={method === 'password' ? 'username' : 'tel'}
                    placeholder={method === 'password' ? 'hello@noaclinic.co.il' : '052-000-0000'}
                    aria-invalid={invalid(!identOk)}
                    aria-describedby={describedBy}
                    className={`${styles.input} ${styles.inputLtr}`}
                  />
                </label>

                {method === 'password' && (
                  <label className={styles.label}>
                    סיסמה
                    <span className={styles.passWrap}>
                      <input
                        value={f.pass}
                        onChange={setField('pass')}
                        type={showPass ? 'text' : 'password'}
                        autoComplete="current-password"
                        aria-invalid={invalid(!passOk)}
                        aria-describedby={describedBy}
                        className={`${styles.input} ${styles.passInput}`}
                      />
                      <button type="button" className={`${styles.eye} ${styles.hit}`} aria-pressed={showPass} onClick={() => setShowPass(v => !v)}>
                        {showPass ? 'הסתרה' : 'הצגה'}
                      </button>
                    </span>
                  </label>
                )}

                <div className={styles.row}>
                  <button type="button" role="checkbox" aria-checked={remember} className={`${styles.check} ${styles.hit}`} onClick={() => setRemember(v => !v)}>
                    <span aria-hidden="true" className={styles.box}>
                      {remember && <CheckMark />}
                    </span>
                    <span className={styles.checkText}>לזכור אותי במכשיר הזה</span>
                  </button>
                  {method === 'password' && (
                    <button type="button" className={`${styles.forgot} ${styles.hit}`} onClick={() => go('forgot', { ident: isEmail(f.ident) ? f.ident : '' })}>
                      שכחתי סיסמה
                    </button>
                  )}
                </div>

                {errorNode}

                <button type="submit" className={`${styles.primary} ${styles.primaryGap}`} disabled={busy}>
                  {method === 'password' ? 'כניסה' : 'שליחת קוד בוואטסאפ'}
                </button>

                {biz && (
                  <>
                    <div className={styles.or}>
                      <span aria-hidden="true" />
                      <span className={styles.orText}>או</span>
                      <span aria-hidden="true" />
                    </div>
                    <button
                      type="button"
                      className={styles.alt}
                      onClick={() => {
                        setMethod(m => (m === 'password' ? 'otp' : 'password'));
                        setTried(false);
                        setServerErr(null);
                      }}
                    >
                      <span aria-hidden="true" className={styles.altIcon}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M8 1.6a6.4 6.4 0 0 0-5.5 9.7L1.6 14.4l3.2-.85A6.4 6.4 0 1 0 8 1.6Z" />
                        </svg>
                      </span>
                      <span>{method === 'password' ? 'כניסה עם קוד בוואטסאפ' : 'כניסה עם סיסמה'}</span>
                    </button>
                  </>
                )}

                <p className={styles.switchP}>
                  אין לכם חשבון?{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => go('signup', isPhone(f.ident) ? { phone: f.ident } : undefined)}>
                    {biz ? 'פתיחת חשבון עסקי' : 'הרשמה'}
                  </button>
                </p>
              </form>
            )}

            {view === 'signup' && (
              <form key={`signup-${role}`} noValidate onSubmit={submitSignup} className={styles.form} aria-busy={busy}>
                <label className={styles.label}>
                  שם מלא
                  <input value={f.name} onChange={setField('name')} autoComplete="name" aria-invalid={invalid(!nameOk)} aria-describedby={describedBy} className={styles.input} />
                </label>
                {biz && (
                  <label className={styles.label}>
                    שם העסק
                    <input value={f.biz} onChange={setField('biz')} autoComplete="organization" aria-invalid={invalid(!bizOk)} aria-describedby={describedBy} className={styles.input} />
                  </label>
                )}
                <label className={styles.label}>
                  טלפון נייד
                  <input
                    value={f.phone}
                    onChange={setField('phone')}
                    dir="ltr"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="052-000-0000"
                    aria-invalid={invalid(!phoneOk)}
                    aria-describedby={describedBy}
                    className={`${styles.input} ${styles.inputLtr}`}
                  />
                </label>
                <label className={styles.label}>
                  {biz ? 'דוא״ל' : 'דוא״ל (לא חובה)'}
                  <input
                    value={f.email}
                    onChange={setField('email')}
                    dir="ltr"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    aria-invalid={invalid(!emailOk)}
                    aria-describedby={describedBy}
                    className={`${styles.input} ${styles.inputLtr}`}
                  />
                </label>
                {biz && (
                  <>
                    <label className={styles.label}>
                      סיסמה
                      <input
                        value={f.pass}
                        onChange={setField('pass')}
                        type="password"
                        autoComplete="new-password"
                        aria-invalid={invalid(!passOk)}
                        aria-describedby={describedBy}
                        className={styles.input}
                      />
                    </label>
                    <PasswordMeter value={f.pass} />
                  </>
                )}

                <ul className={styles.terms}>
                  {TERMS[role].map(([k, label]) => {
                    const on = !!terms[k];
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-invalid={k !== 'marketing' && tried && !on ? true : undefined}
                          className={styles.term}
                          onClick={() => setTerms(t => ({ ...t, [k]: !t[k] }))}
                        >
                          <span aria-hidden="true" className={styles.termBox}>
                            {on && <CheckMark />}
                          </span>
                          <span className={styles.termText}>{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {errorNode}

                <button type="submit" className={`${styles.primary} ${styles.primaryGap}`} disabled={busy}>
                  {biz ? 'פתיחת חשבון עסקי' : 'יצירת חשבון'}
                </button>
                <p className={`${styles.switchP} ${styles.switchPSignup}`}>
                  יש לכם כבר חשבון?{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => go('signin')}>
                    כניסה
                  </button>
                </p>
              </form>
            )}

            {view === 'otp' && (
              <form ref={otpForm} noValidate onSubmit={submitOtp} className={`${styles.form} ${styles.otpWrap}`} aria-busy={busy}>
                <div className={styles.info}>
                  <p>
                    שלחנו קוד בן <Ltr>6</Ltr> ספרות {sms ? 'ב־SMS' : 'בוואטסאפ'} למספר <Ltr bold>{fromE164(otpPhone)}</Ltr>.{' '}
                    <button type="button" className={styles.linkBtn} onClick={() => (otpFlow === 'signup' ? go('signup') : (setMethod('otp'), go('signin')))}>
                      שינוי מספר
                    </button>
                  </p>
                </div>

                <OtpInput
                  value={otp}
                  onChange={v => {
                    setOtp(v);
                    setOtpBad(false);
                    setServerErr(null);
                  }}
                  markEmpty={tried}
                  markAll={otpBad}
                />

                {errorNode}

                <button type="submit" className={styles.otpSubmit} data-ready={otpFull || undefined} disabled={busy}>
                  אימות והמשך
                </button>

                <div className={styles.resendRow}>
                  <button type="button" className={`${styles.resend} ${styles.hit}`} disabled={cooldown > 0 || busy} onClick={() => resend(channel)}>
                    {cooldown > 0 ? (
                      <>
                        שליחה חוזרת בעוד <Ltr>{cooldown}</Ltr> שנ׳
                      </>
                    ) : (
                      'שליחה חוזרת של הקוד'
                    )}
                  </button>
                  {channel !== 'sms' && (
                    <button type="button" className={`${styles.sms} ${styles.hit}`} disabled={cooldown > 0 || busy} onClick={() => resend('sms')}>
                      שליחה ב־SMS במקום
                    </button>
                  )}
                </div>
                <p className={styles.note}>
                  הקוד תקף <Ltr>10</Ltr> דקות. {sms ? 'אם לא קיבלתם, בדקו שהמספר נכון.' : 'אם לא קיבלתם, בדקו שהמספר נכון ושוואטסאפ מותקן במכשיר.'}
                </p>
              </form>
            )}

            {view === 'forgot' && (
              <form noValidate onSubmit={submitForgot} className={styles.form} aria-busy={busy}>
                <label className={styles.label}>
                  דוא״ל או טלפון
                  <input
                    value={f.ident}
                    onChange={setField('ident')}
                    dir="ltr"
                    inputMode="email"
                    autoComplete="username"
                    aria-invalid={invalid(!resetIdentOk)}
                    aria-describedby={describedBy}
                    className={`${styles.input} ${styles.inputLtr}`}
                  />
                </label>
                {errorNode}
                <button type="submit" className={styles.primary} disabled={busy}>
                  שליחת קישור לאיפוס
                </button>
                <button type="button" className={styles.back} onClick={() => go('signin')}>
                  חזרה לכניסה
                </button>
              </form>
            )}

            {view === 'sent' && (
              <div className={styles.sent}>
                <span aria-hidden="true" className={styles.sentIcon}>
                  <svg width="25" height="25" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.5 7.5 5.5 10.5 11.5 4" />
                  </svg>
                </span>
                <p className={styles.sentBody}>
                  {isEmail(sentTo) ? (
                    <>
                      שלחנו קישור לאיפוס סיסמה ל־<Ltr>{sentTo}</Ltr>.
                    </>
                  ) : (
                    'שלחנו קישור לאיפוס סיסמה לכתובת הדוא״ל שרשומה בחשבון.'
                  )}{' '}
                  הקישור תקף <Ltr>30</Ltr> דקות. אם לא הגיע, בדקו בתיקיית הספאם או נסו שוב.
                </p>
                <button
                  type="button"
                  className={styles.sentBtn}
                  onClick={() => {
                    setMethod('password');
                    go('signin');
                  }}
                >
                  חזרה לכניסה
                </button>
              </div>
            )}

            {view === 'reset' && reset && (
              <form noValidate onSubmit={submitReset} className={styles.form} aria-busy={busy}>
                {resetValid ? (
                  <>
                    {/* Lets password managers file the new password under the right account. */}
                    <input type="text" name="username" autoComplete="username" value={reset.email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
                    <label className={styles.label}>
                      סיסמה חדשה
                      <span className={styles.passWrap}>
                        <input
                          value={f.pass}
                          onChange={setField('pass')}
                          type={showPass ? 'text' : 'password'}
                          autoComplete="new-password"
                          aria-invalid={invalid(!passOk)}
                          aria-describedby={describedBy}
                          className={`${styles.input} ${styles.passInput}`}
                        />
                        <button type="button" className={`${styles.eye} ${styles.hit}`} aria-pressed={showPass} onClick={() => setShowPass(v => !v)}>
                          {showPass ? 'הסתרה' : 'הצגה'}
                        </button>
                      </span>
                    </label>
                    <PasswordMeter value={f.pass} />
                    {errorNode}
                    <button type="submit" className={`${styles.primary} ${styles.primaryGap}`} disabled={busy}>
                      שמירה וכניסה
                    </button>
                  </>
                ) : (
                  <>
                    <p className={styles.error} role="alert">
                      הקישור לאיפוס אינו תקף. ייתכן שפג תוקפו או שכבר נעשה בו שימוש.
                    </p>
                    <button type="button" className={styles.primary} onClick={() => go('forgot', { ident: reset.email })}>
                      שליחת קישור חדש
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={styles.back}
                  onClick={() => {
                    setMethod('password');
                    go('signin');
                  }}
                >
                  חזרה לכניסה
                </button>
              </form>
            )}

            <p className={styles.legal}>
              בכניסה אתם מאשרים את <Link href={ROUTES.terms}>התקנון ומדיניות הפרטיות</Link>. לשאלות: <Link href={ROUTES.contact}>צרו קשר</Link> ·{' '}
              <Link href={ROUTES.accessibility}>הצהרת נגישות</Link>
            </p>
          </div>
        </main>

        <aside className={styles.aside}>
          <h2 className={styles.asideH}>{aside.title}</h2>
          <ul className={styles.points}>
            {aside.points.map(p => (
              <li key={p.name}>
                <span aria-hidden="true" className={styles.pIcon}>
                  <CheckMark size={13} />
                </span>
                <span className={styles.pText}>
                  <span className={styles.pName}>{p.name}</span>
                  <span className={styles.pNote}>{p.note}</span>
                </span>
              </li>
            ))}
          </ul>
          <dl className={styles.stats}>
            {stats.map(s => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd dir="ltr">{s.n}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <div role="status" aria-live="polite" className={styles.toastRegion}>
        {toast && <div className={styles.toast}>{toast}</div>}
      </div>
    </div>
  );
}
