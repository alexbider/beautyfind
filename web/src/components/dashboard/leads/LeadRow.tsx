'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { deleteLead, logLeadUpdate, saveLeadDetails, saveLeadNotes } from '@/app/biz/leads/actions';
import { fromE164, nis, telHref } from '@/lib/format';
import {
  KINDS, LIMITS, STAGES, entriesCount, sourceName, stageOf, validateLead,
  type LeadDTO, type LeadErrors, type LeadField, type LeadFields, type StageKey,
} from './shared';
import { ConfirmSheet } from '../ConfirmSheet';
import { useSheetMode } from '../media';
import styles from './Leads.module.css';

const NONE = 'לא צוין';

interface RowProps {
  lead: LeadDTO;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onDeleted: () => void;
}

export function LeadRow({ lead: l, canEdit, open, onToggle, onDeleted }: RowProps) {
  const stg = stageOf(l.stage);
  const panelId = `lead-${l.id}`;
  const sub = [l.treatment, l.city, sourceName(l.source)].filter(Boolean).join(' · ');

  return (
    <div className={styles.row} data-open={open || undefined}>
      <div className={styles.rowMain}>
        <span className={styles.rowWho}>
          <span className={styles.rowName}>{l.name}</span>
          <span className={styles.rowSub}>{sub}</span>
        </span>
        {l.phone ? (
          <a href={telHref(l.phone)} dir="ltr" className={styles.rowPhone}>{fromE164(l.phone)}</a>
        ) : l.email ? (
          <a href={`mailto:${l.email}`} dir="ltr" className={`${styles.rowPhone} ${styles.rowMail}`}>{l.email}</a>
        ) : null}
        <span dir="ltr" className={styles.rowValue}>{l.value ? nis(l.value) : ''}</span>
        <span className={styles.pill} style={{ color: stg.color, background: stg.bg, borderColor: stg.border }}>{stg.name}</span>
        <span dir="ltr" className={styles.rowWhen}>{l.lastWhen}</span>
        <button type="button" className={styles.toggle} onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
          <span className="sr-only">פרטי {l.name}</span>
        </button>
      </div>
      {open && <LeadDetail id={panelId} lead={l} canEdit={canEdit} onDeleted={onDeleted} />}
    </div>
  );
}

// ---------- Expanded card ----------

const toFields = (l: LeadDTO): LeadFields => ({
  name: l.name,
  phone: l.phone ? fromE164(l.phone) : '',
  email: l.email ?? '',
  city: l.city ?? '',
  treatment: l.treatment ?? '',
  value: l.value ? String(l.value) : '',
  nextAction: l.nextAction ?? '',
  nextDate: l.nextDate ?? '',
});

/** The expanded card: inline under the row on desktop, inside the lead sheet (stacked) in the app shell. */
export function LeadDetail({ id, lead: l, canEdit, onDeleted, stacked }: { id: string; lead: LeadDTO; canEdit: boolean; onDeleted: () => void; stacked?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const delBtnRef = useRef<HTMLButtonElement>(null);

  const focusLater = (el: React.RefObject<HTMLElement | null>) => requestAnimationFrame(() => el.current?.focus());

  const doDelete = () => start(async () => {
    const r = await deleteLead(l.id);
    if (r.ok) onDeleted();
    else setErr(r.error);
  });

  const events = l.events.slice().reverse();

  return (
    <div id={id} className={styles.detail} data-stacked={stacked || undefined}>
      <div className={styles.col}>
        {!editing && (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>פרטי הלקוח</span>
              {canEdit && (
                <button ref={editBtnRef} type="button" className={styles.smallBtn} onClick={() => { setEditing(true); setConfirmDel(false); }}>עריכה</button>
              )}
            </div>
            <dl className={styles.facts}>
              <dt>טלפון</dt>
              <dd>{l.phone ? <a href={telHref(l.phone)} dir="ltr" className={styles.factLink}>{fromE164(l.phone)}</a> : <span className={styles.none}>{NONE}</span>}</dd>
              <dt>דוא״ל</dt>
              <dd className={styles.minw0}>{l.email ? <a href={`mailto:${l.email}`} dir="ltr" className={`${styles.factLink} ${styles.ellipsis}`}>{l.email}</a> : <span className={styles.none}>{NONE}</span>}</dd>
              <dt>יישוב</dt>
              <dd>{l.city || <span className={styles.none}>{NONE}</span>}</dd>
              <dt>טיפול</dt>
              <dd className={styles.pretty}>{l.treatment || <span className={styles.none}>{NONE}</span>}</dd>
              <dt>שווי</dt>
              <dd>{l.value ? <span dir="ltr" className={styles.factValue}>{nis(l.value)}</span> : <span className={styles.none}>{NONE}</span>}</dd>
              <dt>מקור</dt>
              <dd>{sourceName(l.source)}</dd>
            </dl>
            {(l.phone || l.email) && (
              <div className={styles.contact}>
                {l.phone && (
                  <a href={`https://wa.me/${l.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className={styles.waBtn}>
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className={styles.waGlyph}>
                      <path fill="currentColor" d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z" />
                    </svg>
                    <span>הודעה ב־WhatsApp</span>
                  </a>
                )}
                {l.phone && (
                  <a href={telHref(l.phone)} className={styles.callBtn}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.callGlyph}>
                      <path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z" />
                    </svg>
                    <span>חיוג</span>
                  </a>
                )}
                {l.email && <a href={`mailto:${l.email}`} className={styles.mailBtn}>שליחת מייל</a>}
              </div>
            )}
          </div>
        )}

        {canEdit && editing && (
          <EditCard
            lead={l}
            onDone={() => { setEditing(false); focusLater(editBtnRef); }}
          />
        )}

        {canEdit && <UpdateCard lead={l} />}

        <NotesField lead={l} canEdit={canEdit} />

        {canEdit && !confirmDel && (
          <div className={styles.delBar}>
            <span className={styles.delNote}>מחיקת הכרטיס תסיר גם את כל ההיסטוריה שנרשמה עליו.</span>
            <button ref={delBtnRef} type="button" className={styles.delBtn} onClick={() => { setConfirmDel(true); setEditing(false); setErr(''); }}>
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <path d="M3.5 5h11M7.2 5V3.4h3.6V5M5.2 5l.7 9.1h6.2L12.8 5" />
              </svg>
              <span>מחיקת לקוח</span>
            </button>
          </div>
        )}

        {canEdit && confirmDel && (
          <ConfirmBox
            title={`למחוק את הכרטיס של ${l.name}?`}
            body="הפעולה אינה הפיכה. הפרטים, הפעולה הבאה וכל רישומי ההיסטוריה יימחקו מהלוח."
            confirmLabel="כן, למחוק"
            pending={pending}
            error={err}
            onConfirm={doDelete}
            onCancel={() => { setConfirmDel(false); setErr(''); focusLater(delBtnRef); }}
          />
        )}
      </div>

      <div className={styles.col}>
        <div className={styles.nextBox}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#0B7A87" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="9" cy="9" r="7" /><path d="M9 5v4.2l2.6 1.6" />
          </svg>
          <span className={styles.nextText}>
            <span className={styles.nextWhat}>{l.nextAction || 'אין פעולה מתוזמנת'}</span>
            {l.nextDate && <span dir="ltr" className={styles.nextDate}>{l.nextDate}</span>}
          </span>
        </div>
        <div className={styles.card}>
          <div className={styles.historyHead}>
            <span className={styles.cardLabel}>מסלול הלקוח</span>
            <span className={styles.historyCount}>
              {l.events.length > 2 ? <><span className="ltr">{l.events.length}</span> רישומים</> : entriesCount(l.events.length)}
            </span>
          </div>
          {events.length === 0 ? (
            <p className={styles.none}>עדיין אין רישומים.</p>
          ) : (
            <ul className={styles.timeline}>
              {events.map(ev => {
                const k = KINDS[ev.kind] ?? KINDS.note;
                return (
                  <li key={ev.id} className={styles.event}>
                    <span aria-hidden="true" className={styles.rail}>
                      <span className={styles.railDot} style={{ background: k.dot }} />
                      <span className={styles.railLine} />
                    </span>
                    <span className={styles.eventBody}>
                      <span className={styles.eventMeta}>
                        <span className={styles.eventKind}>{k.name}</span>
                        <span dir="ltr" className={styles.eventWhen}>{ev.when}</span>
                      </span>
                      <span className={styles.eventText}>{ev.text}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Edit details ----------

function EditCard({ lead, onDone }: { lead: LeadDTO; onDone: () => void }) {
  const [f, setF] = useState<LeadFields>(() => toFields(lead));
  const [errs, setErrs] = useState<LeadErrors | null>(null);
  const [serverErr, setServerErr] = useState('');
  const [pending, start] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const set = (k: LeadField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = k === 'value' ? e.target.value.replace(/\D/g, '').slice(0, LIMITS.valueDigits) : e.target.value;
    setF(prev => ({ ...prev, [k]: v }));
    setErrs(null);
    setServerErr('');
  };

  const save = () => {
    const v = validateLead(f, { withNext: true });
    if (v.first) { setErrs(v); return; }
    start(async () => {
      const r = await saveLeadDetails({ id: lead.id, fields: f });
      if (r.ok) onDone();
      else {
        setServerErr(r.error);
        if (r.field) setErrs({ fields: { [r.field]: r.error }, first: r.error });
      }
    });
  };

  const errId = `lead-edit-err-${lead.id}`;
  const message = serverErr || errs?.first || '';
  const aria = (k: LeadField) => {
    const bad = !!errs?.fields[k];
    return { 'aria-invalid': bad || undefined, 'aria-describedby': bad ? errId : undefined };
  };

  return (
    <div className={`${styles.card} ${styles.editCard}`} role="group" aria-labelledby={`${errId}-h`} onKeyDown={e => { if (e.key === 'Escape') onDone(); }}>
      <span id={`${errId}-h`} className={styles.editTitle}>עריכת פרטי הלקוח</span>
      <div className={styles.editFields}>
        <label className={`${styles.field} ${styles.g150}`}>
          <span className={styles.labelSm}>שם</span>
          <input ref={firstRef} type="text" value={f.name} onChange={set('name')} maxLength={100} className={styles.inputSm} {...aria('name')} />
        </label>
        <label className={`${styles.field} ${styles.g140}`}>
          <span className={styles.labelSm}>טלפון</span>
          <input type="tel" dir="ltr" value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={24} className={`${styles.inputSm} ${styles.num}`} {...aria('phone')} />
        </label>
        <label className={`${styles.field} ${styles.g180}`}>
          <span className={styles.labelSm}>דוא״ל</span>
          <input type="email" dir="ltr" value={f.email} onChange={set('email')} autoComplete="email" maxLength={170} className={`${styles.inputSm} ${styles.ltrInput}`} {...aria('email')} />
        </label>
        <label className={`${styles.field} ${styles.g130}`}>
          <span className={styles.labelSm}>יישוב</span>
          <input type="text" value={f.city} onChange={set('city')} maxLength={70} className={styles.inputSm} {...aria('city')} />
        </label>
        <label className={`${styles.field} ${styles.g170}`}>
          <span className={styles.labelSm}>טיפול</span>
          <input type="text" value={f.treatment} onChange={set('treatment')} maxLength={130} className={styles.inputSm} {...aria('treatment')} />
        </label>
        <label className={`${styles.field} ${styles.w118}`}>
          <span className={styles.labelSm}>שווי ₪</span>
          <input type="text" dir="ltr" value={f.value} onChange={set('value')} inputMode="numeric" className={`${styles.inputSm} ${styles.num}`} {...aria('value')} />
        </label>
        <label className={`${styles.field} ${styles.g190}`}>
          <span className={styles.labelSm}>הפעולה הבאה</span>
          <input type="text" value={f.nextAction} onChange={set('nextAction')} maxLength={170} className={styles.inputSm} {...aria('nextAction')} />
        </label>
        <label className={`${styles.field} ${styles.w128}`}>
          <span className={styles.labelSm}>תאריך יעד</span>
          <input type="text" dir="ltr" value={f.nextDate} onChange={set('nextDate')} inputMode="decimal" placeholder="24.9.2026" maxLength={10} className={`${styles.inputSm} ${styles.num}`} {...aria('nextDate')} />
        </label>
      </div>
      {message && <p id={errId} role="alert" className={`${styles.formErr} ${styles.formErrTop}`}>{message}</p>}
      <div className={styles.editActions}>
        <button type="button" className={styles.primarySm} onClick={save} disabled={pending}>שמירה</button>
        <button type="button" className={styles.ghostSm} onClick={onDone}>ביטול</button>
        <span className={styles.editHint}>כל עריכה נרשמת בהיסטוריה עם תאריך ושעה.</span>
      </div>
    </div>
  );
}

// ---------- Stage change + note ----------

function UpdateCard({ lead }: { lead: LeadDTO }) {
  const [stage, setStage] = useState<StageKey | ''>('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const can = !pending && (!!stage || !!note.trim());

  const save = () => {
    if (!can) return;
    start(async () => {
      const r = await logLeadUpdate({ id: lead.id, stage: stage || null, note });
      if (r.ok) { setStage(''); setNote(''); setErr(''); setSaved(true); }
      else setErr(r.error);
    });
  };

  const noteId = `lead-upd-${lead.id}`;
  return (
    <div className={styles.card}>
      <span id={`${noteId}-h`} className={`${styles.cardLabel} ${styles.cardLabelBlock}`}>רישום עדכון</span>
      <div role="group" aria-label="סטטוס הלקוח" className={styles.stageBtns}>
        {STAGES.map(s => {
          const picked = stage ? stage === s.key : s.key === lead.stage;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={picked}
              className={styles.stageBtn}
              style={picked ? { background: s.bg, color: s.color, borderColor: s.border, fontWeight: 700 } : undefined}
              onClick={() => { setStage(s.key === lead.stage ? '' : s.key); setSaved(false); }}
            >
              {s.name}
              {s.key === lead.stage && <span className="sr-only"> (סטטוס נוכחי)</span>}
            </button>
          );
        })}
      </div>
      <label htmlFor={noteId} className="sr-only">מה קרה עכשיו</label>
      <textarea
        id={noteId}
        value={note}
        onChange={e => { setNote(e.target.value); setSaved(false); setErr(''); }}
        rows={2}
        maxLength={LIMITS.note}
        placeholder="מה קרה עכשיו: שיחה, הודעה, תיאום תור, סיבת סירוב."
        className={styles.textarea}
      />
      <div className={styles.logRow}>
        <button type="button" onClick={save} disabled={!can} className={styles.logBtn}>רישום בהיסטוריה</button>
        <span role="status" className={styles.savedNote}>{saved ? 'נרשם בהיסטוריה.' : ''}</span>
      </div>
      {err && <p role="alert" className={`${styles.formErr} ${styles.formErrTop}`}>{err}</p>}
    </div>
  );
}

// ---------- Fixed summary ----------

function NotesField({ lead, canEdit }: { lead: LeadDTO; canEdit: boolean }) {
  const [draft, setDraft] = useState(lead.notes);
  const [status, setStatus] = useState('');
  const [pending, start] = useTransition();
  const id = `lead-notes-${lead.id}`;

  const save = () => {
    if (!canEdit || draft.trim() === lead.notes.trim()) return;
    start(async () => {
      const r = await saveLeadNotes({ id: lead.id, notes: draft });
      setStatus(r.ok ? 'הסיכום נשמר.' : r.error);
    });
  };

  return (
    <div className={styles.notes}>
      <label htmlFor={id} className={styles.label}>סיכום קבוע על הלקוח</label>
      <textarea
        id={id}
        value={draft}
        onChange={e => { setDraft(e.target.value); setStatus(''); }}
        onBlur={save}
        readOnly={!canEdit}
        rows={2}
        maxLength={LIMITS.notes}
        placeholder={canEdit ? 'רגישויות, העדפות, מידע שחוזר בכל טיפול.' : ''}
        className={styles.textarea}
        aria-describedby={`${id}-s`}
      />
      <span id={`${id}-s`} role="status" className={styles.savedNote}>{pending ? 'שומר…' : status}</span>
    </div>
  );
}

// ---------- Confirm ----------

export function ConfirmBox(props: {
  title: string; body: string; confirmLabel: string; pending: boolean; error: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const sheet = useSheetMode();
  useEffect(() => { if (!sheet) cancelRef.current?.focus(); }, [sheet]);
  if (sheet) return <ConfirmSheet open {...props} />;
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-b`}
      className={styles.confirm}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); props.onCancel(); } }}
    >
      <p id={`${uid}-t`} className={styles.confirmTitle}>{props.title}</p>
      <p id={`${uid}-b`} className={styles.confirmBody}>{props.body}</p>
      {props.error && <p role="alert" className={`${styles.formErr} ${styles.formErrTop}`}>{props.error}</p>}
      <div className={styles.editActions}>
        <button type="button" className={styles.dangerBtn} onClick={props.onConfirm} disabled={props.pending}>{props.confirmLabel}</button>
        <button ref={cancelRef} type="button" className={styles.ghostSm} onClick={props.onCancel}>ביטול</button>
      </div>
    </div>
  );
}
