'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { submitProfileLead } from '@/app/[region]/biz/[slug]/actions';
import { LEAD_LIMITS, leadErrors, type LeadField } from '@/app/[region]/biz/[slug]/lead-shared';
import { track } from '@/lib/client/track';
import { ROUTES } from '@/lib/routes';
import { SHEET_MQ } from '@/lib/ui/shell';
import { BottomSheet } from '../shell/BottomSheet';
import { CallButton, WhatsAppButton } from './ContactLinks';
import { CheckMark, CloseGlyph } from './icons';
import styles from './ContactDialog.module.css';

export interface ContactBranch {
  id: string;
  name: string;
  phone: string | null; // E.164
  whatsapp: string | null; // E.164
}

interface Ctx {
  /** Opens the contact popup, optionally with a treatment prefilled. Returns focus to the opener on close. */
  openContact: (treatment?: string) => void;
}

const ContactCtx = createContext<Ctx | null>(null);

export function useContact(): Ctx {
  const c = useContext(ContactCtx);
  if (!c) throw new Error('useContact outside ContactProvider');
  return c;
}

/**
 * Owns the profile's contact popup ("contact us form as a popup that registers the lead in the CRM
 * and emails the business"). Every contact CTA on the page (booking card, services, mobile bar) opens it.
 * A `#contact` hash on arrival (Practitioner page CTA) opens it too.
 */
export function ContactProvider({ branch, treatments, children }: { branch: ContactBranch; treatments: Array<{ name: string; isMedical: boolean }>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState('');
  const opener = useRef<HTMLElement | null>(null);

  const openContact = useCallback(
    (treatment?: string) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPreset(treatment ?? '');
      setOpen(true);
      track(branch.id, 'contact_click');
    },
    [branch.id],
  );

  const close = useCallback(() => {
    setOpen(false);
    const el = opener.current;
    opener.current = null;
    // After unmount, so focus lands on the button that opened the dialog.
    requestAnimationFrame(() => el?.focus());
  }, []);

  useEffect(() => {
    if (window.location.hash === '#contact') {
      setOpen(true);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <ContactCtx.Provider value={{ openContact }}>
      {children}
      {open && <ContactDialog branch={branch} treatments={treatments} preset={preset} onClose={close} />}
    </ContactCtx.Provider>
  );
}

/** Button that opens the popup. Styling comes from the caller. */
export function ContactTrigger({ treatment, className, children, dataSize, dataTone }: { treatment?: string; className?: string; children: React.ReactNode; dataSize?: string; dataTone?: string }) {
  const { openContact } = useContact();
  return (
    <button type="button" className={className} data-size={dataSize} data-tone={dataTone} aria-haspopup="dialog" onClick={() => openContact(treatment)}>
      {children}
    </button>
  );
}

type Values = { name: string; phone: string; email: string; treatment: string; message: string };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ContactDialog({ branch, treatments, preset, onClose }: { branch: ContactBranch; treatments: Array<{ name: string; isMedical: boolean }>; preset: string; onClose: () => void }) {
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<Values>({ name: '', phone: '', email: '', treatment: preset, message: '' });
  const [website, setWebsite] = useState('');
  const [tried, setTried] = useState(false);
  const [serverFields, setServerFields] = useState<Partial<Record<LeadField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  // Only ever mounted in the browser (after a tap, or the #contact hash), so the query is safe here.
  const [sheet] = useState(() => window.matchMedia(SHEET_MQ).matches);
  // BottomSheet moves focus in only when `open` turns true after it has mounted, so open it one tick later.
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => setSheetOpen(true), []);

  // Validation runs on submit, then live.
  const errs = tried ? { ...serverFields, ...leadErrors(v) } : {};
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setServerFields({});
    setFormError(null);
    setV(cur => ({ ...cur, [k]: e.target.value }));
  };

  useEffect(() => {
    if (sheet) return; // BottomSheet owns focus, scroll lock and Escape.
    first.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Escape closes even when focus drifted outside the panel (e.g. after a click on the backdrop).
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, sheet]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
    if (items.length === 0) return;
    const a = items[0];
    const z = items[items.length - 1];
    if (e.shiftKey && document.activeElement === a) {
      e.preventDefault();
      z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault();
      a.focus();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(leadErrors(v)).length > 0) {
      requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSending(true);
    setFormError(null);
    const res = await submitProfileLead({ branchId: branch.id, ...v, website }).catch(() => ({ ok: false as const, error: 'failed' as const }));
    setSending(false);
    if (res.ok) {
      track(branch.id, 'form_submit');
      setDone(true);
      return;
    }
    if (res.error === 'invalid') setServerFields(res.fields);
    else if (res.error === 'rate_limited') setFormError('כבר שלחתם לעסק הזה כמה פניות היום. העסק יחזור אליכם, ואפשר גם לפנות אליו בוואטסאפ או בטלפון.');
    else if (res.error === 'not_found') setFormError('העסק הזה לא מקבל כרגע פניות דרך האתר.');
    else setFormError('השליחה לא הצליחה, והפנייה לא נשמרה. נסו שוב בעוד רגע.');
  };

  const medical = treatments.find(t => t.name === v.treatment.trim())?.isMedical ?? false;
  const errCount = Object.keys(errs).length;
  const summary = formError ?? (errCount > 0 ? (errs.contact ?? 'יש לתקן את השדות המסומנים') : null);
  const titleId = `${uid}-t`;
  const fid = (k: string) => `${uid}-${k}`;

  const title = done ? 'הפנייה נשלחה' : `פנייה ל${branch.name}`;
  const content = (
    <>
      {done ? (
        <div className={styles.done} role="status">
          <span className={styles.doneIcon} aria-hidden="true">
            <CheckMark size={26} strokeWidth={2} />
          </span>
          <p className={styles.doneText}>
            העברנו את הפרטים ל{branch.name}. העסק יחזור אליכם בטלפון או בדוא״ל שהשארתם.
          </p>
          <button type="button" className={styles.doneBtn} onClick={onClose} autoFocus>
            סגירה
          </button>
        </div>
      ) : (
        <>
          <p className={styles.sub}>השאירו פרטים והעסק יחזור אליכם. הפנייה נשלחת ישירות לעסק ונשמרת אצלו.</p>
          <form className={styles.form} onSubmit={submit} noValidate>
            <div className={styles.field}>
              <label htmlFor={fid('name')} className={styles.label}>שם מלא</label>
              <input
                ref={first}
                id={fid('name')}
                className={styles.input}
                value={v.name}
                onChange={set('name')}
                autoComplete="name"
                maxLength={LEAD_LIMITS.name}
                aria-invalid={!!errs.name}
                aria-describedby={errs.name ? fid('name-e') : undefined}
              />
              {errs.name && <span id={fid('name-e')} className={styles.fieldErr}>{errs.name}</span>}
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor={fid('phone')} className={styles.label}>טלפון</label>
                <input
                  id={fid('phone')}
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  className={styles.input}
                  value={v.phone}
                  onChange={set('phone')}
                  autoComplete="tel"
                  placeholder="050-0000000"
                  maxLength={LEAD_LIMITS.phone}
                  aria-invalid={!!(errs.phone || errs.contact)}
                  aria-describedby={errs.phone ? fid('phone-e') : undefined}
                />
                {errs.phone && <span id={fid('phone-e')} className={styles.fieldErr}>{errs.phone}</span>}
              </div>
              <div className={styles.field}>
                <label htmlFor={fid('email')} className={styles.label}>דוא״ל</label>
                <input
                  id={fid('email')}
                  type="email"
                  dir="ltr"
                  inputMode="email"
                  className={styles.input}
                  value={v.email}
                  onChange={set('email')}
                  autoComplete="email"
                  maxLength={LEAD_LIMITS.email}
                  aria-invalid={!!(errs.email || errs.contact)}
                  aria-describedby={errs.email ? fid('email-e') : undefined}
                />
                {errs.email && <span id={fid('email-e')} className={styles.fieldErr}>{errs.email}</span>}
              </div>
            </div>
            <span className={styles.hint}>מספיק טלפון או דוא״ל.</span>

            <div className={styles.field}>
              <label htmlFor={fid('treatment')} className={styles.label}>
                טיפול שמעניין אתכם <span className={styles.opt}>(לא חובה)</span>
              </label>
              <input
                id={fid('treatment')}
                className={styles.input}
                value={v.treatment}
                onChange={set('treatment')}
                list={treatments.length ? fid('tx') : undefined}
                maxLength={LEAD_LIMITS.treatment}
                aria-invalid={!!errs.treatment}
              />
              {treatments.length > 0 && (
                <datalist id={fid('tx')}>
                  {treatments.map(t => <option key={t.name} value={t.name} />)}
                </datalist>
              )}
              {errs.treatment && <span className={styles.fieldErr}>{errs.treatment}</span>}
            </div>
            {medical && <p className={styles.medNote}>טיפול רפואי נקבע אחרי ייעוץ רפואי. העסק יחזור אליכם לתיאום הייעוץ.</p>}

            <div className={styles.field}>
              <label htmlFor={fid('message')} className={styles.label}>
                הודעה <span className={styles.opt}>(לא חובה)</span>
              </label>
              <textarea
                id={fid('message')}
                className={styles.textarea}
                value={v.message}
                onChange={set('message')}
                maxLength={LEAD_LIMITS.message}
                placeholder="למשל: מתי נוח לכם שיחזרו אליכם"
                aria-invalid={!!errs.message}
              />
              {errs.message && <span className={styles.fieldErr}>{errs.message}</span>}
            </div>

            <div className={styles.trap} aria-hidden="true">
              <label htmlFor={fid('website')}>אתר</label>
              <input id={fid('website')} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
            </div>

            {summary && (
              <p className={styles.summary} role="alert">
                {summary}
              </p>
            )}
            <button type="submit" className={styles.submit} disabled={sending}>
              {sending ? 'שולחים…' : 'שליחת הפנייה'}
            </button>
            <p className={styles.fine}>
              הפרטים מועברים לעסק בלבד, כדי שיחזור אליכם. <Link href={ROUTES.privacy}>מדיניות פרטיות</Link>
            </p>
          </form>

          {(branch.whatsapp || branch.phone) && (
            <div className={styles.alt}>
              <span className={styles.altLabel}>מעדיפים לדבר עכשיו?</span>
              {branch.whatsapp && <WhatsAppButton branchId={branch.id} e164={branch.whatsapp} businessName={branch.name} />}
              {branch.phone && <CallButton branchId={branch.id} e164={branch.phone} />}
            </div>
          )}
        </>
      )}
    </>
  );

  // Phones: a full-height bottom sheet (spec §3, forms). Wider screens keep the centred dialog.
  if (sheet) {
    return (
      <BottomSheet open={sheetOpen} onClose={onClose} title={title} size="full">
        <div ref={panel} className={styles.sheetBody}>
          {content}
        </div>
      </BottomSheet>
    );
  }

  return (
    <div className={styles.overlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.panel} onKeyDown={onKeyDown}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} aria-label="סגירה" onClick={onClose}>
            <CloseGlyph size={14} />
          </button>
        </div>

        {content}
      </div>
    </div>
  );
}
