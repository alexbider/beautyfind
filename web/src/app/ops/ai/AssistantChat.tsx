'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { askAssistantAction } from './actions';
import styles from './ai.module.css';

// The chat on /ops/ai. The browser keeps the turns (text only) and sends the last ones back with each
// question; the server keeps nothing but the audit row. Proposals the assistant filed show as links to
// the approvals tab.

interface Msg { role: 'user' | 'assistant'; text: string; proposals?: Array<{ ref: string; action: string; label: string | null }>; tools?: string[] }

const SUGGESTIONS = ['מה דורש טיפול היום?', 'אילו עסקים בחוב ומה הסכום?', 'סכם את המחלוקות הפתוחות והמלץ', 'כמה הכנסו החודש ומה מדיניות המע״מ?'];
const ACTION_NAMES: Record<string, string> = { hide_business: 'הסתרת עסק', restore_business: 'החזרה לאוויר', note: 'הערה בתיק' };

export function AssistantChat({ configured, firstName, model }: { configured: boolean; firstName: string; model: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs, pending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setError(null);
    const history = msgs.map(m => ({ role: m.role, text: m.text }));
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setInput('');
    start(async () => {
      const r = await askAssistantAction({ question, history });
      if (!r.ok) {
        setError(r.error === 'not_configured' ? 'העוזר לא מוגדר: חסר ANTHROPIC_API_KEY בסביבת האתר.' : r.error === 'forbidden' ? 'אין הרשאה לשאול את העוזר.' : r.error === 'invalid' ? 'שאלה קצרה מדי או ארוכה מדי.' : `השאלה נכשלה${r.detail ? `: ${r.detail}` : ''}`);
        return;
      }
      setMsgs(m => [...m, { role: 'assistant', text: r.answer.text, proposals: r.answer.proposals, tools: r.answer.tools }]);
    });
  };

  return (
    <div className={styles.chat}>
      <div className={styles.thread} aria-live="polite">
        <div className={styles.bubbleWrap}>
          <div className={styles.bubbleWho}>עוזר · Claude</div>
          <div className={styles.bubble}>
            שלום {firstName}. אני רואה את נתוני הפלטפורמה בזמן אמת: עסקים, חיובים, מע״מ, מחלוקות ותור האישורים. אפשר לשאול כל דבר; פעולות כתיבה אני רק מציע, והן נכנסות לתור האישורים.
          </div>
        </div>
        {msgs.map((m, i) => (
          <div key={i} className={styles.bubbleWrap} data-role={m.role}>
            <div className={styles.bubbleWho}>{m.role === 'user' ? firstName : 'עוזר · Claude'}</div>
            <div className={styles.bubble}>{m.text}</div>
            {m.proposals?.length ? (
              <div className={styles.proposals}>
                {m.proposals.map(p => (
                  <Link key={p.ref} href="/ops/ai?tab=queue" className={styles.proposal}>
                    <span className={ui.mono}>{p.ref}</span> · {ACTION_NAMES[p.action] ?? p.action}{p.label ? ` · ${p.label}` : ''} · ממתין לאישור
                  </Link>
                ))}
              </div>
            ) : null}
            {m.tools?.length ? <div className={styles.tools} dir="ltr">{[...new Set(m.tools)].join(' · ')}</div> : null}
          </div>
        ))}
        {pending ? <div className={styles.bubbleWrap}><div className={styles.bubbleWho}>עוזר · Claude</div><div className={`${styles.bubble} ${styles.thinking}`}>בודק בנתונים…</div></div> : null}
        {error ? <p className={ui.error}>{error}</p> : null}
        <div ref={endRef} />
      </div>
      <div className={styles.composer}>
        {!configured ? (
          <p className={ui.note}>העוזר כבוי: המפתח ANTHROPIC_API_KEY לא מוגדר בסביבת האתר (Vercel). אחרי הוספתו ופריסה מחדש הצ׳אט יעבוד עם המודל <span dir="ltr">{model}</span>.</p>
        ) : (
          <>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map(s => <button key={s} type="button" className={styles.suggestion} onClick={() => send(s)} disabled={pending}>{s}</button>)}
            </div>
            <form className={styles.form} onSubmit={e => { e.preventDefault(); send(input); }}>
              <textarea
                className={ui.textarea} value={input} onChange={e => setInput(e.target.value)} rows={2} maxLength={4000}
                placeholder="שאלה על עסקים, חיובים, מע״מ או מחלוקות" aria-label="שאלה לעוזר"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              />
              <button type="submit" className={`${ui.btn} ${ui.teal}`} disabled={pending || !input.trim()}>שליחה</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
