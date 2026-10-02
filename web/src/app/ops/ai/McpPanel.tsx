'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { createMcpTokenAction, revokeMcpClientAction, revokeMcpTokenAction } from './actions';

// The interactive parts of the MCP tab: personal tokens (shown once) and disconnecting apps.

export function TokenCreator({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <form
        className={ui.inlineForm}
        onSubmit={e => {
          e.preventDefault();
          start(async () => {
            const r = await createMcpTokenAction(name);
            if (!r.ok) { setErr(r.error); return; }
            setErr(null); setToken(r.token); setName(''); setCopied(false); router.refresh();
          });
        }}
      >
        <input className={ui.input} value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="שם לאסימון, למשל: Claude Code במחשב של נועה" aria-label="שם האסימון" />
        <button type="submit" className={`${ui.btn} ${ui.small} ${ui.primary}`} disabled={pending || !name.trim()}>יצירת אסימון</button>
        {err ? <span className={ui.error}>{err}</span> : null}
      </form>
      {token ? (
        <div className={`${ui.card} ${ui.cardPad}`} style={{ background: '#F4FBFB', borderColor: '#BFE3E6' }}>
          <p className={ui.strong} style={{ margin: 0 }}>האסימון החדש. הוא מוצג פעם אחת בלבד; העתיקו אותו עכשיו.</p>
          <p className={ui.mono} dir="ltr" style={{ wordBreak: 'break-all', margin: '8px 0' }}>{token}</p>
          <div className={ui.actions}>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => { navigator.clipboard?.writeText(token).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'הועתק' : 'העתקה'}</button>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setToken(null)}>סגירה</button>
          </div>
          <p className={ui.hint} style={{ marginTop: 8 }}>שימוש: כותרת <span className={ui.mono} dir="ltr">Authorization: Bearer &lt;token&gt;</span> בכל בקשה ל־/api/mcp. ב־Claude Code: <span className={ui.mono} dir="ltr">claude mcp add --transport http beautyfind {'<URL>'} --header &quot;Authorization: Bearer {'<token>'}&quot;</span></p>
        </div>
      ) : null}
    </div>
  );
}

export function RevokeButton({ kind, id, label }: { kind: 'token' | 'app'; id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className={ui.actions}>
      <button
        type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={pending}
        onClick={() => {
          if (!window.confirm(kind === 'token' ? `לבטל את האסימון ״${label}״? כל חיבור שמשתמש בו יפסיק לעבוד.` : `לנתק את ״${label}״? האפליקציה תצטרך לבקש אישור מחדש.`)) return;
          start(async () => {
            const r = kind === 'token' ? await revokeMcpTokenAction(id) : await revokeMcpClientAction(id);
            if (!r.ok) setErr(r.error ?? 'הפעולה נכשלה'); else router.refresh();
          });
        }}
      >{kind === 'token' ? 'ביטול' : 'ניתוק'}</button>
      {err ? <span className={ui.error}>{err}</span> : null}
    </span>
  );
}
