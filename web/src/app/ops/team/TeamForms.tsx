'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LEVELS, LEVEL_NAMES, OPS_ROLES, OPS_ROLE_NAMES, type Level } from '@/components/ops/roles';
import { ui } from '@/components/ops/ui';
import { inviteStaffAction, setPermissionAction, setStaffRoleAction } from './actions';
import styles from './team.module.css';

export function InviteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('support');
  const [res, setRes] = useState<{ ok: true; link: string; expires: string } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className={`${ui.btn} ${ui.teal}`} onClick={() => setOpen(true)}>הזמנת איש צוות</button>;
  return (
    <form
      className={styles.invite}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await inviteStaffAction({ email, fullName: name, role });
          setRes(r.ok ? { ok: true, link: r.link, expires: r.expires } : { ok: false, error: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className={ui.formGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className={ui.field}><label className={ui.label} htmlFor="inv-name">שם מלא</label><input id="inv-name" className={ui.input} value={name} onChange={e => setName(e.target.value)} required maxLength={120} /></div>
        <div className={ui.field}><label className={ui.label} htmlFor="inv-email">דוא״ל</label><input id="inv-email" className={ui.input} type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div className={ui.field}><label className={ui.label} htmlFor="inv-role">תפקיד</label>
          <select id="inv-role" className={ui.select} value={role} onChange={e => setRole(e.target.value)}>{OPS_ROLES.map(r => <option key={r} value={r}>{OPS_ROLE_NAMES[r]}</option>)}</select>
        </div>
      </div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>יצירת הזמנה</button>
        <button type="button" className={ui.btn} onClick={() => { setOpen(false); setRes(null); }}>סגירה</button>
      </div>
      {res ? res.ok ? (
        <div className={styles.inviteResult}>
          <div className={ui.ok}>ההזמנה נוצרה. אין ספק הודעות מחובר, לכן שלחו את הקישור בעצמכם. תקף 7 ימים, לשימוש חד־פעמי.</div>
          <input className={ui.input} dir="ltr" readOnly value={res.link} onFocus={e => e.currentTarget.select()} aria-label="קישור ההזמנה" />
        </div>
      ) : <p className={ui.error}>{res.error}</p> : null}
    </form>
  );
}

export function RoleSelect({ userId, role, self }: { userId: string; role: string; self: boolean }) {
  const router = useRouter();
  const [val, setVal] = useState(role);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (self) return <span className={ui.note}>{OPS_ROLE_NAMES[role] ?? role} · החשבון שלך</span>;
  return (
    <span className={ui.inlineForm}>
      <select
        className={`${ui.select} ${styles.roleSelect}`} value={val} disabled={pending} aria-label="תפקיד"
        onChange={e => {
          const v = e.target.value;
          if (v === 'remove' && !confirm('להסיר את תפקיד הצוות? החשבון יישאר, אבל בלי גישה לניהול.')) return;
          setVal(v);
          start(async () => {
            const r = await setStaffRoleAction({ userId, role: v === 'remove' ? null : v });
            if (!r.ok) { setErr(r.error); setVal(role); } else { setErr(null); router.refresh(); }
          });
        }}
      >
        {OPS_ROLES.map(r => <option key={r} value={r}>{OPS_ROLE_NAMES[r]}</option>)}
        <option value="remove">הסרת תפקיד</option>
      </select>
      {err ? <span className={ui.error}>{err}</span> : null}
    </span>
  );
}

/** One matrix cell: a click moves to the next level (none, view, edit, full) for every area in the group. */
export function PermissionCell({ role, areas, level, locked, mixed }: { role: string; areas: string[]; level: Level; locked: boolean; mixed?: boolean }) {
  const router = useRouter();
  const [cur, setCur] = useState<Level>(level);
  const [isMixed, setMixed] = useState(!!mixed);
  const [err, setErr] = useState(false);
  const [pending, start] = useTransition();
  const next = LEVELS[(LEVELS.indexOf(cur) + 1) % LEVELS.length];
  if (locked) return <span className={styles.cell} data-level="full" data-locked="true">מלא</span>;
  return (
    <button
      type="button" className={styles.cell} data-level={isMixed ? 'mixed' : cur} disabled={pending} title={`לחיצה: ${LEVEL_NAMES[next]}`}
      aria-label={`${areas.join(', ')}: ${isMixed ? 'מעורב' : LEVEL_NAMES[cur]}, לחיצה משנה ל${LEVEL_NAMES[next]}`}
      onClick={() => start(async () => {
        const r = await setPermissionAction({ role, areas, level: next });
        if (r.ok) { setCur(r.level); setMixed(false); setErr(false); router.refresh(); } else setErr(true);
      })}
    >
      {err ? 'שגיאה' : isMixed ? 'מעורב' : LEVEL_NAMES[cur]}
    </button>
  );
}
