'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import {
  inviteStaff, removeMember, resendInvite, revokeInvite, saveMemberPerms, setMemberPreset, type InviteField,
} from '@/app/biz/team/actions';
import { EMAIL_RE } from '@/lib/format';
import { PRESET_NAMES, type Area, type Level, type Perms } from '@/lib/permissions';
import { LEVELS, STAFF_PRESETS, levelOf, nextLevel, type AreaRow, type InviteDTO, type MemberDTO, type StaffPreset } from './shared';
import styles from './Team.module.css';

type Notice = { text: ReactNode; tone: 'ok' | 'err' } | null;

const L = ({ children }: { children: ReactNode }) => <span className="ltr">{children}</span>;

function usersCount(n: number): ReactNode {
  return n === 1 ? 'משתמש אחד' : n === 2 ? 'שני משתמשים' : <><L>{n}</L> משתמשים</>;
}
function invitesCount(n: number): ReactNode {
  return n === 1 ? 'הזמנה אחת ממתינה' : n === 2 ? 'שתי הזמנות ממתינות' : <><L>{n}</L> הזמנות ממתינות</>;
}

const initialOf = (name: string) => name.replace(/^ד״ר\s+/, '').trim().slice(0, 1) || '?';
const samePerms = (a: Perms, b: Perms) => (Object.keys(a) as Area[]).every(k => a[k] === b[k]);

export function TeamPanel({ members, invites, areas }: { members: MemberDTO[]; invites: InviteDTO[]; areas: AreaRow[] }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const removeBtns = useRef(new Map<string, HTMLButtonElement>());

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: ReactNode, after?: () => void) => {
    start(async () => {
      const r = await fn();
      setNotice(r.ok ? { text: ok, tone: 'ok' } : { text: r.error ?? 'הפעולה נכשלה.', tone: 'err' });
      if (r.ok) after?.();
    });
  };

  const openInvites = invites.filter(i => !i.expired).length;

  return (
    <section aria-labelledby="h-team" className={styles.section}>
      <div className={styles.head}>
        <h1 id="h-team" className={styles.h1}>צוות והרשאות<span className={styles.dot}>.</span></h1>
        <p className={styles.lede}>
          {usersCount(members.length)}
          {openInvites > 0 && <> · {invitesCount(openInvites)}</>}
          {' '}· רק המנהל הראשי יכול לשנות תפקידים והרשאות
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>משתמשים בעסק</div>
        {notice && (
          <p role={notice.tone === 'err' ? 'alert' : 'status'} className={styles.notice} data-tone={notice.tone}>{notice.text}</p>
        )}

        {members.map(m => (
          <div key={m.id} className={styles.memberWrap}>
            <div className={styles.member}>
              <span aria-hidden="true" className={styles.avatar}>{initialOf(m.name)}</span>
              <span className={styles.who}>
                <span className={styles.name}>{m.name}</span>
                {m.email && <span dir="ltr" className={styles.email}>{m.email}</span>}
              </span>
              {m.isOwner ? (
                <span className={styles.masterBadge}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 5.4l2.6 1.8L7 3l2.4 4.2L12 5.4l-1 5.2H3z" />
                  </svg>
                  מנהל ראשי
                </span>
              ) : (
                <span role="group" aria-label={`תפקיד של ${m.name}`} className={styles.roleChips}>
                  {STAFF_PRESETS.map(p => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={m.preset === p}
                      className={styles.roleChip}
                      disabled={pending}
                      onClick={() => m.preset !== p && run(
                        () => setMemberPreset(m.id, p),
                        <>{m.name} מוגדר/ת עכשיו כ{PRESET_NAMES[p].name}. ההרשאות חזרו לברירת המחדל של התפקיד.</>,
                      )}
                    >
                      {PRESET_NAMES[p].name}
                    </button>
                  ))}
                </span>
              )}
              <span className={styles.last}>{m.last ?? ''}</span>
              {!m.isOwner && (
                <button
                  ref={el => { if (el) removeBtns.current.set(m.id, el); else removeBtns.current.delete(m.id); }}
                  type="button"
                  className={styles.removeBtn}
                  aria-expanded={removeId === m.id}
                  onClick={() => { setRemoveId(m.id); setNotice(null); }}
                >
                  הסרה
                </button>
              )}
            </div>
            {removeId === m.id && (
              <Confirm
                title={`להסיר את ${m.name} מהעסק?`}
                body="הגישה ללוח הבקרה נחסמת מיד. מה שכבר נרשם בשמו/ה נשאר בהיסטוריה, ואפשר להזמין שוב בכל עת."
                confirmLabel="כן, להסיר"
                pending={pending}
                onConfirm={() => run(() => removeMember(m.id), <>{m.name} הוסר/ה מהעסק.</>, () => setRemoveId(null))}
                onCancel={() => {
                  setRemoveId(null);
                  const btn = removeBtns.current.get(m.id);
                  requestAnimationFrame(() => btn?.focus());
                }}
              />
            )}
          </div>
        ))}

        {invites.length > 0 && (
          <>
            <div className={styles.subHead}>הזמנות שנשלחו</div>
            {invites.map(i => (
              <div key={i.id} className={styles.member}>
                <span aria-hidden="true" className={`${styles.avatar} ${styles.avatarInvite}`}>
                  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="m3 5.5 7 5.2 7-5.2" />
                  </svg>
                </span>
                <span className={styles.who}>
                  <span className={styles.name}>{i.name ?? <L>{i.email}</L>}</span>
                  {i.name && <span dir="ltr" className={styles.email}>{i.email}</span>}
                </span>
                <span className={styles.presetTag}>{PRESET_NAMES[i.preset].name}</span>
                <span className={styles.last} data-expired={i.expired || undefined}>
                  {i.expired ? <>פג תוקף ב־<L>{i.expires}</L></> : <>ממתין לאישור · בתוקף עד <L>{i.expires}</L></>}
                </span>
                <span className={styles.inviteActions}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    disabled={pending}
                    onClick={() => run(() => resendInvite(i.id), <>ההזמנה נשלחה שוב ל־<L>{i.email}</L>, בתוקף לשבעה ימים. הקישור הקודם כבר לא פעיל.</>)}
                  >
                    שליחה חוזרת
                  </button>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    disabled={pending}
                    onClick={() => run(() => revokeInvite(i.id), <>ההזמנה ל־<L>{i.email}</L> בוטלה. הקישור שנשלח כבר לא פעיל.</>)}
                  >
                    ביטול הזמנה
                  </button>
                </span>
              </div>
            ))}
          </>
        )}

        <InviteForm />
      </div>

      <Matrix members={members} areas={areas} />
    </section>
  );
}

// ---------- Invite ----------

function InviteForm() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<StaffPreset>('front');
  const [err, setErr] = useState<{ text: string; field: InviteField | null } | null>(null);
  const [sent, setSent] = useState<ReactNode>(null);
  const [pending, start] = useTransition();
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const v = email.trim();
    if (!v || !EMAIL_RE.test(v)) {
      setErr({ text: 'נדרשת כתובת דואר אלקטרוני תקינה. ההזמנה נשלחת אליה.', field: 'email' });
      emailRef.current?.focus();
      return;
    }
    start(async () => {
      const r = await inviteStaff({ email: v, name, preset });
      if (r.ok) {
        const msg = <>הזמנה נשלחה ל־<L>{v.toLowerCase()}</L> בתור {PRESET_NAMES[preset].name}. היא בתוקף לשבעה ימים.</>;
        setSent(msg);
        setEmail('');
        setName('');
        setErr(null);
      } else {
        const field = 'field' in r ? r.field : null;
        setErr({ text: r.error, field });
        (field === 'name' ? nameRef : emailRef).current?.focus();
      }
    });
  };

  const bad = (f: InviteField) => err?.field === f;
  return (
    <form className={styles.invite} onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
      <p id="inv-h" className={styles.inviteTitle}>הזמנת משתמש חדש</p>
      <div className={styles.inviteRow}>
        <label className={`${styles.field} ${styles.g200}`}>
          <span className={styles.label}>דואר אלקטרוני</span>
          <input
            ref={emailRef}
            type="email"
            dir="ltr"
            value={email}
            onChange={e => { setEmail(e.target.value); setErr(null); setSent(null); }}
            placeholder="name@clinic.co.il"
            autoComplete="off"
            maxLength={160}
            required
            className={`${styles.input} ${styles.ltrInput}`}
            aria-invalid={bad('email') || undefined}
            aria-describedby={bad('email') ? 'inv-err' : undefined}
          />
        </label>
        <label className={`${styles.field} ${styles.g160}`}>
          <span className={styles.label}>שם <span className={styles.optional}>(לא חובה)</span></span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setErr(null); setSent(null); }}
            autoComplete="off"
            maxLength={80}
            className={styles.input}
            aria-invalid={bad('name') || undefined}
            aria-describedby={bad('name') ? 'inv-err' : undefined}
          />
        </label>
        <span role="group" aria-label="תפקיד" className={styles.roleChips}>
          {STAFF_PRESETS.map(p => (
            <button key={p} type="button" aria-pressed={preset === p} className={`${styles.roleChip} ${styles.roleChipLg}`} onClick={() => setPreset(p)}>
              {PRESET_NAMES[p].name}
            </button>
          ))}
        </span>
        <button type="submit" className={styles.sendBtn} disabled={pending}>שליחת הזמנה</button>
      </div>
      {err && <p id="inv-err" role="alert" className={styles.invErr}>{err.text}</p>}
      {sent && !err && <p role="status" className={styles.invOk}>{sent}</p>}
    </form>
  );
}

// ---------- Permissions matrix (areas × members) ----------

function Matrix({ members, areas }: { members: MemberDTO[]; areas: AreaRow[] }) {
  const saved = useMemo(() => Object.fromEntries(members.map(m => [m.id, m.perms])) as Record<string, Perms>, [members]);
  const [draft, setDraft] = useState<Record<string, Perms>>(saved);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  // Fresh server data (after a save or a preset switch) replaces only the rows whose saved values changed,
  // so unsaved edits on other members survive the refresh.
  const prevSaved = useRef(saved);
  useEffect(() => {
    const before = prevSaved.current;
    prevSaved.current = saved;
    setDraft(d => {
      const out: Record<string, Perms> = {};
      for (const id of Object.keys(saved)) {
        out[id] = d[id] && before[id] && samePerms(before[id], saved[id]) ? d[id] : saved[id];
      }
      return out;
    });
  }, [saved]);

  const staff = members.filter(m => !m.isOwner);
  const dirty = (id: string) => !!draft[id] && !samePerms(draft[id], saved[id]);

  const cycle = (id: string, a: Area) => {
    setNotice(null);
    setDraft(d => ({ ...d, [id]: { ...d[id], [a]: nextLevel(d[id][a]) } }));
  };

  const save = (m: MemberDTO) => {
    setBusy(m.id);
    start(async () => {
      const r = await saveMemberPerms(m.id, draft[m.id]);
      setBusy(null);
      setNotice(r.ok ? { text: <>ההרשאות של {m.name} נשמרו.</>, tone: 'ok' } : { text: r.error, tone: 'err' });
    });
  };

  const gridStyle = { '--cols': members.length } as CSSProperties;

  return (
    <div className={styles.card}>
      <div className={styles.matrixHead}>
        <h2 className={styles.h2}>מה כל משתמש רואה ויכול לשנות</h2>
        <p className={styles.matrixNote}>
          לחיצה על תא מחליפה בין אין גישה, צפייה וצפייה ועריכה. כל משתמש נשמר בנפרד. המנהל הראשי תמיד רואה ומנהל הכול.
        </p>
      </div>
      {staff.length === 0 ? (
        <p className={styles.matrixEmpty}>עדיין אין משתמשים נוספים בעסק. הזמינו משתמש כדי לקבוע מה הוא רואה.</p>
      ) : (
        <div className={styles.scroll}>
          <div className={styles.grid} style={gridStyle}>
            <div className={`${styles.gridRow} ${styles.gridHead}`}>
              <span className={styles.colLabel}>מסך</span>
              {members.map(m => (
                <span key={m.id} className={styles.colHead}>
                  <span className={styles.colName}>{m.name}</span>
                  <span className={styles.colSub}>{m.isOwner ? 'מנהל ראשי' : PRESET_NAMES[m.preset ?? 'practitioner'].name}</span>
                </span>
              ))}
            </div>
            {areas.map(a => (
              <div key={a.key} className={styles.gridRow}>
                <span className={styles.areaName}>{a.name}</span>
                {members.map(m => {
                  const lv = levelOf(m.isOwner ? 'edit' : (draft[m.id]?.[a.key] ?? m.perms[a.key]));
                  const style = { background: lv.bg, color: lv.color, borderColor: lv.border } as CSSProperties;
                  return m.isOwner ? (
                    <span key={m.id} className={`${styles.cell} ${styles.cellLocked}`} style={style}>
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                        <rect x="4" y="8.6" width="12" height="8" rx="2.2" /><path d="M7 8.6V6.4a3 3 0 0 1 6 0v2.2" />
                      </svg>
                      {lv.name}
                      <span className="sr-only">, נעול</span>
                    </span>
                  ) : (
                    <button
                      key={m.id}
                      type="button"
                      className={styles.cell}
                      style={style}
                      onClick={() => cycle(m.id, a.key)}
                      aria-label={`הרשאת ${m.name} במסך ${a.name}: ${lv.name}. לחיצה מחליפה ל${levelOf(nextLevel(lv.key as Level)).name}`}
                    >
                      {lv.name}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className={`${styles.gridRow} ${styles.gridFoot}`}>
              <span />
              {members.map(m => m.isOwner ? (
                <span key={m.id} className={styles.lockedNote}>לא ניתן לשינוי</span>
              ) : (
                <span key={m.id} className={styles.footCell}>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    disabled={!dirty(m.id) || busy !== null}
                    onClick={() => save(m)}
                    aria-label={`שמירת ההרשאות של ${m.name}`}
                  >
                    {busy === m.id ? 'שומר…' : 'שמירה'}
                  </button>
                  {dirty(m.id) && (
                    <button type="button" className={styles.resetBtn} onClick={() => setDraft(d => ({ ...d, [m.id]: saved[m.id] }))} aria-label={`ביטול השינויים של ${m.name}`}>
                      ביטול
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {notice && <p role={notice.tone === 'err' ? 'alert' : 'status'} className={styles.matrixNotice} data-tone={notice.tone}>{notice.text}</p>}
      <div className={styles.legend}>
        <span className={styles.legendLabel}>מפתח:</span>
        {LEVELS.map(l => (
          <span key={l.key} className={styles.legendKey} style={{ background: l.bg, color: l.color, borderColor: l.border }}>{l.name}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- Confirm ----------

function Confirm(props: { title: string; body: string; confirmLabel: string; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const uid = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
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
      <div className={styles.confirmActions}>
        <button type="button" className={styles.dangerBtn} onClick={props.onConfirm} disabled={props.pending}>{props.confirmLabel}</button>
        <button ref={cancelRef} type="button" className={styles.ghostBtn} onClick={props.onCancel}>ביטול</button>
      </div>
    </div>
  );
}
