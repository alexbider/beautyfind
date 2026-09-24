'use client';

import { Fragment, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useDetailParam, useShell } from '@/components/clinic/mobile';
import { ActionBar } from '@/components/shell/ActionBar';
import { BottomSheet } from '@/components/shell/BottomSheet';
import { haptic } from '@/components/shell/haptics';
import { PullToRefresh } from '@/components/shell/PullToRefresh';
import { Segmented } from '@/components/shell/Segmented';
import { TopBar } from '@/components/shell/TopBar';
import { decideAction } from './actions';
import {
  APPROVE_LABEL, DOCUMENT_REASONS, KIND_FILTERS, REJECT_REASONS, STATUS_FILTERS, STATUS_NAME, TOAST,
  errorText, inKind, isActive,
  type Action, type KindFilter, type QueueItem, type Row, type Seg, type StatusFilter, type Tone,
} from './shared';
import styles from './verification.module.css';

type Mode = 'reject' | 'request_document';
type Draft = { id: string; mode: Mode; reason: string | null; note: string };

const MARK: Record<Tone, { mark: string; sr: string }> = {
  ok: { mark: '✓', sr: 'תקין' },
  warn: { mark: '!', sr: 'לתשומת לב' },
  bad: { mark: '×', sr: 'בעייתי' },
  todo: { mark: '·', sr: 'לבדיקה' },
};

function Segs({ v }: { v: Seg[] }) {
  return (
    <>
      {v.map((s, i) =>
        s.ltr ? (
          // Short tokens (times, phones, refs) must not wrap: a split range reorders around the break.
          <span key={i} dir="ltr" className="ltr" style={{ whiteSpace: 'nowrap' }}>
            {s.t}
          </span>
        ) : (
          <Fragment key={i}>{s.t}</Fragment>
        ),
      )}
    </>
  );
}

function Rows({ rows, onSelect }: { rows: Row[]; onSelect?: (id: string) => void }) {
  return (
    <dl className={styles.dl}>
      {rows.map((r, i) => (
        <Fragment key={i}>
          <dt className={styles.dt}>{r.k}</dt>
          <dd className={styles.dd} data-tone={r.tone}>
            {r.selectId && onSelect ? (
              <button type="button" className={styles.refLink} onClick={() => onSelect(r.selectId!)}>
                <Segs v={r.v} />
              </button>
            ) : (
              <Segs v={r.v} />
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

// Desktop-first (spec §6 BeautyFind staff). On phones: list → detail with the request id in the URL
// (?id=, so back returns to the list), a "best on a computer" note, and every decision behind a
// confirmation sheet opened from the sticky action bar. Staff have no tab bar.
export function VerificationConsole({ items, who }: { items: QueueItem[]; who: string }) {
  const shell = useShell();
  const detail = useDetailParam('id');
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selId, setSelId] = useState<string | null>(items[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  // Phones: the confirmation sheet for approve / reopen, and the "more actions" sheet.
  const [confirm, setConfirm] = useState<'approve' | 'reopen' | null>(null);
  const [more, setMore] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstReasonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Record<Mode, HTMLButtonElement | null>>({ reject: null, request_document: null });
  const focusDetail = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const headingId = useId();
  const noteId = useId();

  const list = items.filter(x => inKind(x.kind, kind) && (status === 'all' || x.status === status));
  // The request in the URL wins (phones: the detail screen stays on it after a decision).
  const routed = detail.id ? items.find(x => x.id === detail.id) ?? null : null;
  const cur = routed ?? list.find(x => x.id === selId) ?? list[0] ?? null;
  const view = detail.id ? 'detail' : 'list';
  const d = draft && cur && draft.id === cur.id ? draft : null;
  const err = error && cur && error.id === cur.id ? error.text : null;

  // Move focus to the detail heading after picking an item or after a decision closes the action bar.
  useEffect(() => {
    if (focusDetail.current) {
      focusDetail.current = false;
      headingRef.current?.focus();
    }
  }, [cur?.id, cur?.status]);

  useEffect(() => {
    if (d) firstReasonRef.current?.focus();
  }, [d?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function flash(t: string) {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(''), 3400);
  }

  function pick(id: string) {
    if (!list.some(x => x.id === id)) {
      setKind('all');
      setStatus('all');
    }
    setSelId(id);
    setDraft(null);
    setError(null);
    setConfirm(null);
    if (shell) {
      detail.open(id);
      return;
    }
    detail.replace(id);
    focusDetail.current = true;
  }

  // Desktop: a selection outside the new filter gives way to the list's first row.
  function filterBy(next: { kind?: KindFilter; status?: StatusFilter }) {
    const k = next.kind ?? kind;
    const s = next.status ?? status;
    setKind(k);
    setStatus(s);
    if (routed && !(inKind(routed.kind, k) && (s === 'all' || routed.status === s))) detail.replace(null);
  }

  function openMode(mode: Mode) {
    if (!cur) return;
    setError(null);
    setDraft({ id: cur.id, mode, reason: null, note: '' });
  }

  function closeMode() {
    const mode = d?.mode;
    setDraft(null);
    setError(null);
    if (mode) requestAnimationFrame(() => triggerRef.current[mode]?.focus());
  }

  function run(action: Action, reason?: string) {
    if (!cur) return;
    const id = cur.id;
    setError(null);
    start(async () => {
      let res: Awaited<ReturnType<typeof decideAction>>;
      try {
        res = await decideAction({ requestId: id, action, reason });
      } catch {
        res = { ok: false, error: 'failed' };
      }
      if (!res.ok) {
        haptic('warning');
        setError({ id, text: errorText(res, action) });
        return;
      }
      haptic('success');
      setDraft(null);
      setConfirm(null);
      flash(TOAST[action]);
      focusDetail.current = true;
    });
  }

  function submitDraft() {
    if (!d) return;
    const reason = [d.reason, d.note.trim()].filter(Boolean).join('. ');
    if (!reason) {
      setError({ id: d.id, text: errorText({ ok: false, error: 'reason_required' }, d.mode) });
      return;
    }
    run(d.mode, reason);
  }

  const activeIn = (k: KindFilter) => items.filter(x => isActive(x.status) && inKind(x.kind, k)).length;
  const statusCount = (s: StatusFilter) =>
    s === 'open' || s === 'awaiting_document' ? items.filter(x => x.status === s && inKind(x.kind, kind)).length : null;

  const reasons = cur && d ? (d.mode === 'reject' ? REJECT_REASONS : DOCUMENT_REASONS)[cur.kind] : [];
  const canSubmit = !!d && (!!d.reason || d.note.trim() !== '');

  return (
    <div className={styles.page} data-view={view}>
      {view === 'detail' && cur ? (
        <TopBar mode="pushed" title={cur.who} onBack={detail.close} />
      ) : (
        <TopBar mode="root" largeTitle="תור אימות" />
      )}

      <div className={styles.listPane}>
        <p className={`${styles.deskNote} bf-shell-only`}>
          <strong>הכי נוח במחשב.</strong> תור האימות בנוי למסך רחב, עם השוואה בין מה שהוגש למקור. בטלפון אפשר לעבור על בקשות ולהחליט, וכל החלטה מבקשת אישור.
          <span className={styles.deskNoteWho}>{who}</span>
        </p>
        <div className={`${styles.phoneFilters} bf-shell-only`}>
          <Segmented
            label="סטטוס"
            value={status}
            onChange={k => filterBy({ status: k as StatusFilter })}
            items={STATUS_FILTERS.map(f => ({ key: f.key, label: f.name, count: statusCount(f.key) ?? undefined }))}
          />
          <Segmented
            label="סוג"
            value={kind}
            onChange={k => filterBy({ kind: k as KindFilter })}
            items={KIND_FILTERS.map(f => ({ key: f.key, label: f.name, count: activeIn(f.key) }))}
          />
        </div>
      </div>

      <div className={`${styles.titleRow} bf-desk-only`}>
        <h1 className={styles.h1}>תור אימות</h1>
        <div role="group" aria-label="סטטוס" className={styles.seg}>
          {STATUS_FILTERS.map(f => {
            const n = statusCount(f.key);
            return (
              <button key={f.key} type="button" aria-pressed={status === f.key} className={styles.segBtn} onClick={() => filterBy({ status: f.key })}>
                {f.name}
                {n != null && (
                  <>
                    {' '}
                    <span dir="ltr" className={`ltr ${styles.segN}`}>{n}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="סוג" className={styles.seg}>
          {KIND_FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={kind === f.key} className={styles.segBtn} onClick={() => filterBy({ kind: f.key })}>
              {f.name}{' '}
              <span dir="ltr" className={`ltr ${styles.segN}`}>{activeIn(f.key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.shell}>
        <div className={styles.listPane}>
        <PullToRefresh>
        <ul aria-label="בקשות" className={styles.queue}>
          {list.length === 0 && <li className={styles.queueEmpty}>אין בקשות בסינון הזה.</li>}
          {list.map(x => {
            const on = x.id === cur?.id;
            const active = isActive(x.status);
            return (
              <li key={x.id}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  className={styles.item}
                  data-on={on || undefined}
                  onClick={() => pick(x.id)}
                >
                  <span className={styles.itemTop}>
                    <span className={styles.itemWho}>{x.who}</span>
                    <span className={styles.itemSla} data-urgent={(active && x.slaUrgent) || undefined}>
                      <Segs v={x.sla} />
                    </span>
                  </span>
                  <span className={styles.itemWhat}>
                    {x.what} · {x.biz}
                  </span>
                  <span className={styles.chips}>
                    <span className={styles.chip} data-st={x.status}>{STATUS_NAME[x.status]}</span>
                    {x.flags.slice(0, 1).map(f => (
                      <span key={f.text} className={styles.flag} data-tone={f.tone} title={f.text}>
                        {f.text}
                      </span>
                    ))}
                    {x.flags.length > 1 && (
                      <span className={styles.flag} data-tone={x.flags[1].tone} aria-label={`ועוד ${x.flags.length - 1} סימונים`}>
                        +<span dir="ltr" className="ltr">{x.flags.length - 1}</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        </PullToRefresh>
        </div>

        {!cur ? (
          <section aria-labelledby={headingId} className={styles.detail}>
            <div className={styles.empty}>
              <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.emptyTitle}>
                אין בקשות בתור הזה
              </h2>
              <p className={styles.emptyText}>
                {items.length
                  ? 'נסו סינון אחר, או חזרו ל״הכול״.'
                  : 'כשעסק יגיש רישום, רישיון, תעודה או בקשת בעלות, הבקשה תופיע כאן עם יעד ה־SLA שלה.'}
              </p>
            </div>
          </section>
        ) : (
          <section key={cur.id} aria-labelledby={headingId} className={styles.detail} aria-busy={pending || undefined}>
            <div className={styles.head}>
              <div className={styles.headMain}>
                <span className={styles.headKicker}>
                  {cur.what} · <span dir="ltr" className="ltr">{cur.ref}</span>
                </span>
                <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.h2}>
                  {cur.who}
                </h2>
                <span className={styles.headSub}>
                  {cur.biz ? `${cur.biz} · ` : ''}הוגשה <Segs v={cur.when} />
                </span>
              </div>
              <span className={styles.badge} data-st={cur.status}>
                {STATUS_NAME[cur.status]}
              </span>
            </div>

            <div className={styles.body}>
              <div className={styles.cmp}>
                <div className={styles.card}>
                  <span className={styles.cardTitle}>מה הוגש</span>
                  {cur.submitted.length ? <Rows rows={cur.submitted} /> : <p className={styles.muted}>לא נשמרו פרטים בבקשה.</p>}
                </div>
                <div className={`${styles.card} ${styles.source}`}>
                  <span className={styles.cardTitle}>{cur.source.name}</span>
                  <Rows rows={cur.source.rows} />
                </div>
              </div>

              {cur.context.length > 0 && (
                <div className={styles.card}>
                  <span className={styles.cardTitle}>העסק במערכת כרגע</span>
                  <Rows rows={cur.context} onSelect={pick} />
                </div>
              )}

              {cur.doc && (
                <div>
                  <span className={styles.label}>מסמך שהועלה</span>
                  {cur.doc.isImage ? (
                    <a href={cur.doc.url} target="_blank" rel="noopener noreferrer" className={styles.docFrame}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cur.doc.url} alt={cur.doc.label} loading="lazy" className={styles.docImg} />
                    </a>
                  ) : (
                    <a href={cur.doc.url} target="_blank" rel="noopener noreferrer" className={`${styles.docFrame} ${styles.docFile}`}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M7 3h7l5 5v13H7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                      <span>פתיחת {cur.doc.label} (<span dir="ltr" className="ltr">PDF</span>)</span>
                    </a>
                  )}
                </div>
              )}

              <div>
                <span className={styles.label}>בדיקות</span>
                {cur.checks.length ? (
                  <ul className={styles.checks}>
                    {cur.checks.map((c, i) => (
                      <li key={i} className={styles.check}>
                        <span aria-hidden="true" className={styles.mark} data-tone={c.tone}>
                          {MARK[c.tone].mark}
                        </span>
                        <span className="sr-only">{MARK[c.tone].sr}: </span>
                        <span className={styles.checkText}>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>אין בדיקות רשומות לבקשה הזו.</p>
                )}
              </div>

              {cur.outcome && (
                <p className={styles.outcome}>
                  <Segs v={cur.outcome} />
                </p>
              )}

              <div className={styles.log}>
                <span className={styles.logTitle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  יומן החלטות
                </span>
                {cur.log.length ? (
                  <ol className={styles.logList} aria-label="החלטות, מהחדשה לישנה">
                    {cur.log.map(e => (
                      <li key={e.id} className={styles.logItem}>
                        <span className={styles.logTop}>
                          <span className={styles.logAction}>{e.action}</span>
                          <span className={styles.logWho}>
                            {e.actor}
                            {e.role ? ` · ${e.role}` : ''}
                          </span>
                          <span className={styles.logAt}>
                            <Segs v={e.at} />
                          </span>
                        </span>
                        {e.reason && <span className={styles.logReason}>{e.reason}</span>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.muted}>עדיין לא התקבלו החלטות בבקשה הזו.</p>
                )}
                <span className={styles.logNote}>רשומות קבועות: אי אפשר לערוך או למחוק החלטה.</span>
              </div>
            </div>

            {isActive(cur.status) && (
              <div className={`${styles.foot} bf-desk-only`}>
                {d && (
                  <div className={styles.reasons} role="group" aria-labelledby={`${noteId}-t`}>
                    <span id={`${noteId}-t`} className={styles.reasonsTitle}>
                      {d.mode === 'reject' ? 'סיבת הדחייה (תישלח לעסק)' : 'איזה מסמך לבקש (הבקשה תישלח לעסק)'}
                    </span>
                    {reasons.map((r, i) => {
                      const on = d.reason === r;
                      return (
                        <button
                          key={r}
                          ref={i === 0 ? firstReasonRef : undefined}
                          type="button"
                          aria-pressed={on}
                          className={styles.reason}
                          data-mode={d.mode}
                          onClick={() => setDraft({ ...d, reason: on ? null : r })}
                        >
                          {r}
                        </button>
                      );
                    })}
                    <label htmlFor={noteId} className={styles.noteLabel}>
                      {d.mode === 'reject' ? 'סיבה אחרת או פירוט' : 'מסמך אחר או פירוט'}
                    </label>
                    <textarea
                      id={noteId}
                      className={styles.note}
                      rows={2}
                      maxLength={500}
                      value={d.note}
                      onChange={e => setDraft({ ...d, note: e.target.value })}
                    />
                  </div>
                )}

                {err && (
                  <p role="alert" className={styles.error}>
                    {err}
                  </p>
                )}

                <div className={styles.btns}>
                  {!d && (
                    <>
                      <button type="button" className={styles.approve} disabled={pending} onClick={() => run('approve')}>
                        {APPROVE_LABEL[cur.kind]}
                      </button>
                      {cur.status === 'awaiting_document' && (
                        <button type="button" className={styles.ghost} disabled={pending} onClick={() => run('reopen')}>
                          המסמך התקבל, החזרה לתור
                        </button>
                      )}
                      <button
                        type="button"
                        ref={el => { triggerRef.current.request_document = el; }}
                        className={styles.ghost}
                        disabled={pending}
                        onClick={() => openMode('request_document')}
                      >
                        בקשת מסמך נוסף
                      </button>
                      <button
                        type="button"
                        ref={el => { triggerRef.current.reject = el; }}
                        className={styles.reject}
                        disabled={pending}
                        onClick={() => openMode('reject')}
                      >
                        דחייה
                      </button>
                    </>
                  )}
                  {d && (
                    <>
                      <button
                        type="button"
                        className={d.mode === 'reject' ? styles.confirmReject : styles.confirmDoc}
                        aria-disabled={!canSubmit || pending}
                        data-ready={canSubmit || undefined}
                        onClick={() => !pending && submitDraft()}
                      >
                        {d.mode === 'reject' ? 'אישור הדחייה' : 'שליחת הבקשה לעסק'}
                      </button>
                      <button type="button" className={styles.cancel} onClick={closeMode}>
                        ביטול
                      </button>
                    </>
                  )}
                </div>
                <p className={styles.footNote}>ההחלטה נרשמת עם שמך ושעת ההחלטה, ואינה ניתנת לעריכה. תיקון: רק בהחלטה חדשה שמפנה לקודמת.</p>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Phones: decisions from the action bar, each confirmed in a sheet. */}
      {view === 'detail' && cur && isActive(cur.status) && (
        <ActionBar mobileOnly error={!d && !confirm && err ? err : undefined} className={styles.bar}>
          <button type="button" className={styles.reject} disabled={pending} onClick={() => openMode('reject')}>
            דחייה
          </button>
          <button type="button" className={styles.ghost} disabled={pending} onClick={() => setMore(true)} aria-haspopup="dialog">
            עוד
          </button>
          <button type="button" className={styles.approve} disabled={pending} onClick={() => { setError(null); setConfirm('approve'); }}>
            {APPROVE_LABEL[cur.kind]}
          </button>
        </ActionBar>
      )}

      {shell && cur && (
        <>
          <BottomSheet open={more} onClose={() => setMore(false)} title="פעולות נוספות">
            <div className={styles.sheetList}>
              <button type="button" className={styles.sheetRow} onClick={() => { setMore(false); openMode('request_document'); }}>
                בקשת מסמך נוסף מהעסק
              </button>
              {cur.status === 'awaiting_document' && (
                <button type="button" className={styles.sheetRow} onClick={() => { setMore(false); setError(null); setConfirm('reopen'); }}>
                  המסמך התקבל, החזרה לתור
                </button>
              )}
            </div>
          </BottomSheet>

          <BottomSheet
            open={!!confirm}
            onClose={() => setConfirm(null)}
            title={confirm === 'reopen' ? 'להחזיר את הבקשה לתור?' : `${APPROVE_LABEL[cur.kind]}?`}
            footer={
              <>
                {err && <p role="alert" className={styles.error} style={{ marginBottom: 10 }}>{err}</p>}
                <div className={styles.sheetBtns}>
                  <button type="button" className={styles.ghost} onClick={() => setConfirm(null)}>ביטול</button>
                  <button type="button" className={styles.approve} disabled={pending} aria-busy={pending || undefined} onClick={() => confirm && run(confirm)}>
                    {confirm === 'reopen' ? 'החזרה לתור' : 'אישור'}
                  </button>
                </div>
              </>
            }
          >
            <p className={styles.sheetText}>
              {confirm === 'reopen'
                ? `הבקשה של ${cur.who} (${cur.what}) תחזור לתור הפתוח, ושעון ה־SLA יתחיל מחדש.`
                : `${cur.what}: ${cur.who}${cur.biz ? `, ${cur.biz}` : ''}. העסק יקבל הודעה על האישור.`}
            </p>
            <p className={styles.footNote}>ההחלטה נרשמת עם שמך ושעת ההחלטה, ואינה ניתנת לעריכה.</p>
          </BottomSheet>

          <BottomSheet
            open={!!d}
            onClose={closeMode}
            title={d?.mode === 'reject' ? 'דחיית הבקשה' : 'בקשת מסמך נוסף'}
            size="full"
            footer={
              <>
                {err && <p role="alert" className={styles.error} style={{ marginBottom: 10 }}>{err}</p>}
                <div className={styles.sheetBtns}>
                  <button type="button" className={styles.ghost} onClick={closeMode}>ביטול</button>
                  <button
                    type="button"
                    className={d?.mode === 'reject' ? styles.confirmReject : styles.confirmDoc}
                    aria-disabled={!canSubmit || pending}
                    data-ready={canSubmit || undefined}
                    onClick={() => !pending && submitDraft()}
                  >
                    {d?.mode === 'reject' ? 'אישור הדחייה' : 'שליחת הבקשה לעסק'}
                  </button>
                </div>
              </>
            }
          >
            {d && (
              <div className={styles.reasons} role="group" aria-labelledby={`${noteId}-st`}>
                <span id={`${noteId}-st`} className={styles.reasonsTitle}>
                  {d.mode === 'reject' ? 'סיבת הדחייה (תישלח לעסק)' : 'איזה מסמך לבקש (הבקשה תישלח לעסק)'}
                </span>
                {reasons.map(r => {
                  const on = d.reason === r;
                  return (
                    <button key={r} type="button" aria-pressed={on} className={styles.reason} data-mode={d.mode} onClick={() => setDraft({ ...d, reason: on ? null : r })}>
                      {r}
                    </button>
                  );
                })}
                <label htmlFor={`${noteId}-s`} className={styles.noteLabel}>
                  {d.mode === 'reject' ? 'סיבה אחרת או פירוט' : 'מסמך אחר או פירוט'}
                </label>
                <textarea id={`${noteId}-s`} className={styles.note} rows={3} maxLength={500} value={d.note} onChange={e => setDraft({ ...d, note: e.target.value })} />
              </div>
            )}
          </BottomSheet>
        </>
      )}

      <div role="status" aria-live="polite" className={styles.toastRegion}>
        {toast && <div className={styles.toast}>{toast}</div>}
      </div>
    </div>
  );
}
