'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { reportReview, saveReply } from '@/app/biz/reviews/actions';
import { BottomSheet } from '../../shell/BottomSheet';
import { haptic } from '../../shell/haptics';
import { PullToRefresh } from '../../shell/PullToRefresh';
import { SwipeRow } from '../../shell/SwipeRow';
import { useShell } from '../media';
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
  // App shell: rows open the review in a sheet; reporting asks first in a confirmation sheet.
  const shell = useShell();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [confirmReport, setConfirmReport] = useState<string | null>(null);
  const where = shell ? 'sheet' : 'list';

  const start = (id: string) => {
    setComposing(id);
    setDraft(replies[id] ?? '');
    setError('');
    requestAnimationFrame(() => document.getElementById(`${draftId}-${where}-${id}`)?.focus());
  };
  const openSheet = (id: string, compose = false) => {
    setSheetId(id);
    if (compose) start(id);
  };
  const closeSheet = () => {
    setSheetId(null);
    if (!pending) cancel();
  };
  const cancel = () => { setComposing(null); setDraft(''); setError(''); };

  const send = (id: string) => {
    const text = draft.trim();
    const bad = text.length < REPLY_MIN ? `התגובה קצרה מדי. כתבו לפחות ${REPLY_MIN} תווים.` : text.length > REPLY_MAX ? `עד ${REPLY_MAX} תווים.` : '';
    if (bad) {
      haptic('warning');
      return setError(bad);
    }
    startTransition(async () => {
      const res = await saveReply(id, text);
      if (!res.ok) {
        haptic('warning');
        return setError(res.error);
      }
      haptic('success');
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

  const review = (r: ReviewItem, at: 'list' | 'sheet') => {
    const reply = replies[r.id];
    const isComposing = composing === r.id;
    const needsReply = !reply && !isComposing;
    const len = draft.trim().length;
    const tid = `${draftId}-${at}-${r.id}`;
    return (
      <article key={r.id} className={s.review} data-open={needsReply || undefined} data-at={at} aria-labelledby={`rev-${at}-${r.id}`}>
        <div className={s.revHead}>
          <span id={`rev-${at}-${r.id}`} className={s.who}>{r.who}</span>
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
              <label htmlFor={tid} className={s.label}>התגובה שלכם</label>
              <textarea
                id={tid}
                value={draft}
                onChange={e => { setDraft(e.target.value); setError(''); }}
                rows={3}
                maxLength={REPLY_MAX}
                placeholder="תשובה עניינית, בשם העסק. בלי פרטים רפואיים של הלקוח."
                aria-invalid={!!error || undefined}
                aria-describedby={`${tid}-count${error ? ` ${tid}-err` : ''}`}
                className={s.textarea}
              />
              <span id={`${tid}-count`} className={s.count}>
                <span className="ltr">{len} / {REPLY_MAX}</span> תווים · תגובה אחת לכל ביקורת, גלויה לכולם
              </span>
              {error && <span id={`${tid}-err`} role="alert" className={s.err}>{error}</span>}
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
              <button type="button" onClick={() => (at === 'sheet' ? setConfirmReport(r.id) : report(r.id))} disabled={pending} className={s.ghostBtn}>דיווח על הפרת כללים</button>
            )}
          </div>
        )}

        {reported[r.id] && (
          <p role="status" className={s.reported}>הדיווח נרשם. נבדוק את הביקורת מול הכללים ונשיב בכתב בתוך חמישה ימי עסקים.</p>
        )}
        {reportErr[r.id] && !reported[r.id] && <p role="alert" className={s.err}>{reportErr[r.id]}</p>}
      </article>
    );
  };

  const sheetItem = sheetId ? items.find(r => r.id === sheetId) : undefined;
  const reportItem = confirmReport ? items.find(r => r.id === confirmReport) : undefined;

  return (
    <>
      <div className={`${s.list} bf-desk-only`}>{items.map(r => review(r, 'list'))}</div>

      <div className={`${s.rows} bf-shell-only`}>
        <PullToRefresh>
          <ul className={s.rowList}>
            {items.map(r => {
              const reply = replies[r.id];
              const row = (
                <button type="button" className={s.mRow} onClick={() => openSheet(r.id)}>
                  <span className={s.mTop}>
                    <span className={s.mWho}>{r.who}</span>
                    <span className={`ltr ${s.stars}`} role="img" aria-label={`דירוג ${r.rating} מתוך 5`}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </span>
                    {!reply && <span className={s.pendingTag}>ממתין לתגובה</span>}
                  </span>
                  <span className={s.mBody}>{r.title || r.body}</span>
                  <span className={s.when}><CountedText c={r.when} />{r.treatment && <> · {r.treatment}</>}</span>
                </button>
              );
              return (
                <li key={r.id}>
                  {canEdit ? <SwipeRow actions={[{ label: reply ? 'עריכה' : 'תגובה', tone: 'primary', onAction: () => openSheet(r.id, true) }]}>{row}</SwipeRow> : row}
                </li>
              );
            })}
          </ul>
        </PullToRefresh>
      </div>

      <BottomSheet open={shell && !!sheetItem} onClose={closeSheet} title={sheetItem ? `הביקורת של ${sheetItem.who}` : 'ביקורת'}>
        {sheetItem && review(sheetItem, 'sheet')}
      </BottomSheet>

      <BottomSheet
        open={shell && !!reportItem}
        onClose={() => setConfirmReport(null)}
        title="דיווח על הפרת כללים"
        footer={
          <div className={s.sheetActions}>
            <button type="button" className={s.dangerBtn} disabled={pending} onClick={() => { const id = confirmReport!; setConfirmReport(null); report(id); }}>
              שליחת הדיווח
            </button>
            <button type="button" className={s.ghostBtn} onClick={() => setConfirmReport(null)}>ביטול</button>
          </div>
        }
      >
        <p className={s.confirmText}>
          נבדוק את הביקורת של {reportItem?.who} מול כללי הביקורות ונשיב בכתב בתוך חמישה ימי עסקים. הביקורת נשארת מוצגת עד להחלטה.
        </p>
      </BottomSheet>
    </>
  );
}
