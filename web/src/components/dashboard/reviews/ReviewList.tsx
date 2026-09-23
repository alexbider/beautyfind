'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { reportReview, saveReply } from '@/app/biz/reviews/actions';
import { CountedText } from './Counted';
import { REPLY_MAX, REPLY_MIN, type Counted } from './stats';
import s from './Reviews.module.css';

export interface ReviewItem {
  id: string;
  who: string;
  rating: number;
  when: Counted;
  treatment: string | null;
  title: string;
  body: string;
  reply: string | null;
  reported: boolean;
}

export function ReviewList({ items, canEdit }: { items: ReviewItem[]; canEdit: boolean }) {
  const router = useRouter();
  const [replies, setReplies] = useState<Record<string, string | null>>(() => Object.fromEntries(items.map(r => [r.id, r.reply])));
  const [reported, setReported] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(r => [r.id, r.reported])));
  const [composing, setComposing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [reportErr, setReportErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const draftId = useId();

  const start = (id: string) => {
    setComposing(id);
    setDraft(replies[id] ?? '');
    setError('');
    requestAnimationFrame(() => document.getElementById(`${draftId}-${id}`)?.focus());
  };
  const cancel = () => { setComposing(null); setDraft(''); setError(''); };

  const send = (id: string) => {
    const text = draft.trim();
    if (text.length < REPLY_MIN) return setError(`התגובה קצרה מדי. כתבו לפחות ${REPLY_MIN} תווים.`);
    if (text.length > REPLY_MAX) return setError(`עד ${REPLY_MAX} תווים.`);
    startTransition(async () => {
      const res = await saveReply(id, text);
      if (!res.ok) return setError(res.error);
      setReplies(prev => ({ ...prev, [id]: res.reply }));
      cancel();
      router.refresh();
    });
  };

  const report = (id: string) =>
    startTransition(async () => {
      const res = await reportReview(id);
      if (res.ok) setReported(prev => ({ ...prev, [id]: true }));
      else setReportErr(prev => ({ ...prev, [id]: res.error }));
    });

  return (
    <div className={s.list}>
      {items.map(r => {
        const reply = replies[r.id];
        const isComposing = composing === r.id;
        const needsReply = !reply && !isComposing;
        const len = draft.trim().length;
        return (
          <article key={r.id} className={s.review} data-open={needsReply || undefined} aria-labelledby={`rev-${r.id}`}>
            <div className={s.revHead}>
              <span id={`rev-${r.id}`} className={s.who}>{r.who}</span>
              <span className={`ltr ${s.stars}`} role="img" aria-label={`דירוג ${r.rating} מתוך 5`}>
                {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
              </span>
              <span className={s.when}>
                <CountedText c={r.when} />{r.treatment && <> · {r.treatment}</>}
              </span>
              {needsReply && <span className={s.pendingTag}>ממתין לתגובה</span>}
            </div>
            {r.title && <h3 className={s.revTitle}>{r.title}</h3>}
            <p className={s.body}>{r.body}</p>

            {reply && !isComposing && (
              <div className={s.reply}>
                <span className={s.replyLabel}>התגובה שלכם · מוצגת לצד הביקורת</span>
                <p>{reply}</p>
              </div>
            )}

            {isComposing && (
              <div className={s.compose}>
                <div className={s.field}>
                  <label htmlFor={`${draftId}-${r.id}`} className={s.label}>התגובה שלכם</label>
                  <textarea
                    id={`${draftId}-${r.id}`}
                    value={draft}
                    onChange={e => { setDraft(e.target.value); setError(''); }}
                    rows={3}
                    maxLength={REPLY_MAX}
                    placeholder="תשובה עניינית, בשם העסק. בלי פרטים רפואיים של הלקוח."
                    aria-invalid={!!error || undefined}
                    aria-describedby={`${draftId}-${r.id}-count${error ? ` ${draftId}-${r.id}-err` : ''}`}
                    className={s.textarea}
                  />
                  <span id={`${draftId}-${r.id}-count`} className={s.count}>
                    <span className="ltr">{len} / {REPLY_MAX}</span> תווים · תגובה אחת לכל ביקורת, גלויה לכולם
                  </span>
                  {error && <span id={`${draftId}-${r.id}-err`} role="alert" className={s.err}>{error}</span>}
                </div>
                <div className={s.actions}>
                  <button type="button" onClick={() => send(r.id)} disabled={pending} aria-busy={pending || undefined} className={s.primaryBtn}>
                    {pending ? 'מפרסם…' : reply ? 'עדכון התגובה' : 'פרסום התגובה'}
                  </button>
                  <button type="button" onClick={cancel} disabled={pending} className={s.ghostBtn}>ביטול</button>
                  <span className={s.note}>אין אפשרות להסיר ביקורת אמיתית, רק להגיב לה.</span>
                </div>
              </div>
            )}

            {canEdit && !isComposing && (
              <div className={`${s.actions} ${reply ? s.actionsAfterReply : ''}`}>
                <button type="button" onClick={() => start(r.id)} disabled={composing !== null && pending} className={s.outlineBtn}>
                  {reply ? 'עריכת התגובה' : 'תגובה'}
                </button>
                {!reported[r.id] && (
                  <button type="button" onClick={() => report(r.id)} disabled={pending} className={s.ghostBtn}>דיווח על הפרת כללים</button>
                )}
              </div>
            )}

            {reported[r.id] && (
              <p role="status" className={s.reported}>הדיווח נרשם. נבדוק את הביקורת מול הכללים ונשיב בכתב בתוך חמישה ימי עסקים.</p>
            )}
            {reportErr[r.id] && !reported[r.id] && <p role="alert" className={s.err}>{reportErr[r.id]}</p>}
          </article>
        );
      })}
    </div>
  );
}
