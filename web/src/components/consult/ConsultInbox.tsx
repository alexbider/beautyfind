'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ConsultStatus } from '@prisma/client';
import {
  approveTreatmentAction, askDetailsAction, confirmProposedAction, declineAction, proposeSlotAction, proposeSlotsAction,
} from '@/app/clinic/consults/actions';
import { telHref } from '@/lib/format';
import { useDetailParam, useShell } from '../clinic/mobile';
import { ActionBar } from '../shell/ActionBar';
import { BottomSheet } from '../shell/BottomSheet';
import { haptic } from '../shell/haptics';
import { PullToRefresh } from '../shell/PullToRefresh';
import { Segmented } from '../shell/Segmented';
import { TopBar } from '../shell/TopBar';
import { DECLINES, FLAGS, STATUS, declineMessage, firstName, proposeMessage, type DeclineKey, type FlagKey, type SlotDay } from './constants';
import { SlotPicker } from './SlotPicker';
import { LtrText, radioKeys, rove } from './ui';
import styles from './consult.module.css';
import ix from './inbox.module.css';

// Design: project/BeautyFind Consult Request.dc.html (side=clinic)
// Phones (spec §6 Consult inbox): list → detail screen with the request id in the URL (?r=), so back
// returns to the list; the actions sit in the sticky action bar and their forms open in sheets.

export interface InboxRequest {
  id: string;
  ref: string;
  name: string;
  phone: string;
  phoneE164: string;
  received: string;
  areas: string[];
  goal: string;
  prior: string;
  format: string;
  when: string;
  status: ConsultStatus;
  flags: FlagKey[];
  outcome: string | null;
  proposed: { iso: string; label: string } | null;
  booking: { label: string; live: boolean; ref: string; practitioner: string | null; lapsed: boolean } | null;
  treatment: string | null;
  branchName: string;
  feeShekels: number;
}

type Filter = 'open' | 'new' | 'awaiting_client' | 'consult_scheduled' | 'closed' | 'all';
const FILTERS: Array<{ key: Filter; name: string; match: (s: ConsultStatus) => boolean }> = [
  { key: 'open', name: 'פתוחות', match: s => s === 'new' || s === 'awaiting_client' || s === 'consult_scheduled' },
  { key: 'new', name: 'חדשות', match: s => s === 'new' },
  { key: 'awaiting_client', name: 'ממתינות למטופלת', match: s => s === 'awaiting_client' },
  { key: 'consult_scheduled', name: 'נקבע ייעוץ', match: s => s === 'consult_scheduled' },
  { key: 'closed', name: 'סגורות', match: s => s === 'closed_declined' || s === 'closed_treatment_booked' },
  { key: 'all', name: 'הכל', match: () => true },
];

type Mode = 'none' | 'propose' | 'decline' | 'approve';

interface Props {
  bizName: string;
  requests: InboxRequest[];
  initialId: string | null;
  canManage: boolean;
  isPhysician: boolean;
  viewer: { name: string; roleName: string };
  doctorName: string;
  multiBranch: boolean;
  consultHref: string | null;
}

export function ConsultInbox({ bizName, requests, initialId, canManage, isPhysician, viewer, doctorName, multiBranch, consultHref }: Props) {
  const router = useRouter();
  const shell = useShell();
  const detail = useDetailParam('r');
  const initialReq = initialId ? requests.find(q => q.id === initialId) : null;
  const [filter, setFilter] = useState<Filter>(initialReq && !FILTERS[0].match(initialReq.status) ? 'all' : 'open');
  const [selId, setSelId] = useState<string | null>(initialId);
  const [mode, setMode] = useState<Mode>('none');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const detailH = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const f = FILTERS.find(x => x.key === filter)!;
  const list = requests.filter(q => f.match(q.status));
  // The request in the URL wins (phones: the detail screen stays on it even after its status moves
  // it out of the current filter); otherwise the desktop selection, then the first in the list.
  const routed = detail.id ? requests.find(q => q.id === detail.id) ?? null : null;
  const sel = routed ?? list.find(q => q.id === selId) ?? list[0] ?? null;
  const view = detail.id ? 'detail' : 'list';
  const nNew = requests.filter(q => q.status === 'new').length;
  const counts = Object.fromEntries(FILTERS.map(x => [x.key, requests.filter(q => x.match(q.status)).length])) as Record<Filter, number>;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Leaving the detail screen (back) closes any open form.
  useEffect(() => {
    if (!detail.id) setMode('none');
  }, [detail.id]);

  const pick = (id: string) => {
    setSelId(id);
    setMode('none');
    if (shell) {
      detail.open(id);
      return;
    }
    detail.replace(id);
    // Narrow desktop windows stack the detail under the list: bring it into view.
    requestAnimationFrame(() => {
      detailH.current?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 1023px)').matches) detailH.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const changeFilter = (k: Filter) => {
    setFilter(k);
    setMode('none');
    // Desktop: a selection outside the new filter gives way to the list's first row.
    const next = FILTERS.find(x => x.key === k)!;
    if (routed && !next.match(routed.status)) detail.replace(null);
  };

  const openMode = (m: Mode) => {
    setMode(m);
    if (!shell) requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('button:not([aria-disabled="true"]), textarea')?.focus());
  };

  const act = async (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        setMode('none');
        haptic('success');
        setToast({ text: res.message });
        router.refresh();
      } else {
        haptic('warning');
        setToast({ text: res.error, bad: true });
      }
    } catch {
      haptic('warning');
      setToast({ text: 'הפעולה נכשלה. בדקו את החיבור ונסו שוב.', bad: true });
    } finally {
      setBusy(false);
    }
  };

  const filterIdx = FILTERS.findIndex(x => x.key === filter);
  const manageable = !!sel && canManage && sel.status !== 'closed_declined' && sel.status !== 'closed_treatment_booked';

  return (
    <div className={ix.screen} data-view={view}>
      {view === 'detail' && sel ? (
        <TopBar mode="pushed" title={sel.name} onBack={detail.close} />
      ) : (
        <TopBar mode="root" largeTitle="בקשות ייעוץ" />
      )}

      <div className={ix.listPane}>
        <div className={ix.top}>
          <div className={ix.topText}>
            <span className={styles.kicker}>{bizName} · פניות</span>
            <h1 className={`${styles.h1} ${ix.h1} bf-desk-only`}>בקשות ייעוץ רפואי</h1>
          </div>
          <span className={ix.newCount}>
            {nNew === 0 ? 'אין בקשות חדשות' : nNew === 1 ? 'בקשה חדשה אחת' : nNew === 2 ? 'שתי בקשות חדשות' : <><span className="ltr tnum">{nNew}</span> בקשות חדשות</>}
          </span>
        </div>

        <div role="radiogroup" aria-label="סינון לפי סטטוס" onKeyDown={radioKeys} className={`${styles.chipsTight} ${ix.filters} bf-desk-only`}>
          {FILTERS.map((x, i) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={filter === x.key}
              tabIndex={rove(i, filterIdx)}
              onClick={() => changeFilter(x.key)}
              className={`${styles.chip} ${ix.filterChip}`}
            >
              {x.name} <span className={`ltr tnum ${styles.chipCount}`}>{counts[x.key]}</span>
            </button>
          ))}
        </div>
        <div className={`${ix.seg} bf-shell-only`}>
          <Segmented
            label="סינון לפי סטטוס"
            value={filter}
            onChange={k => changeFilter(k as Filter)}
            items={FILTERS.map(x => ({ key: x.key, label: x.name, count: counts[x.key] }))}
          />
        </div>
      </div>

      {requests.length === 0 ? (
        <div className={ix.empty}>
          <h2 className={styles.h2}>עוד לא התקבלו בקשות ייעוץ</h2>
          <p className={styles.hint} style={{ margin: 0 }}>
            מטופלות שולחות בקשה מעמוד הייעוץ של הקליניקה, או מתפריט הטיפולים כשבוחרים טיפול רפואי.
            {consultHref && (
              <>
                {' '}
                <Link href={consultHref}>לעמוד הייעוץ</Link>
              </>
            )}
          </p>
        </div>
      ) : (
        <div className={ix.grid}>
          <div className={ix.listPane}>
            <PullToRefresh>
              {list.length === 0 ? (
                <p className={ix.emptyList}>אין בקשות בסינון הזה.</p>
              ) : (
                <ul aria-label="רשימת בקשות" className={ix.list}>
                  {list.map(q => {
                    const st = STATUS[q.status];
                    return (
                      <li key={q.id}>
                        <button type="button" aria-current={sel?.id === q.id ? 'true' : undefined} onClick={() => pick(q.id)} className={ix.item}>
                          <span className={ix.itemTop}>
                            <span className={ix.itemName}>{q.name}</span>
                            <span className={ix.itemWhen}><LtrText text={q.received} /></span>
                          </span>
                          <span className={ix.itemAreas}>{q.areas.join(' · ')}</span>
                          <span className={ix.badges}>
                            <span className={ix.badge} data-tone={st.tone}>{st.name}</span>
                            {q.flags.length > 0 && <span className={ix.badge} data-tone="flag">דורש עיון רפואי</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </PullToRefresh>
          </div>

          {sel && (
            <section aria-labelledby="cs-dt" className={ix.detail}>
              <div className={ix.detailHead}>
                <div className={ix.topText}>
                  <h2 id="cs-dt" ref={detailH} tabIndex={-1} className={ix.detailName}>{sel.name}</h2>
                  <span className={ix.detailSub}>
                    <span className="ltr tnum">{sel.ref}</span> · התקבלה <LtrText text={sel.received} />
                  </span>
                </div>
                <span className={`${ix.badge} ${ix.badgeLg}`} data-tone={STATUS[sel.status].tone}>{STATUS[sel.status].name}</span>
              </div>

              <dl className={ix.facts}>
                {multiBranch && (
                  <>
                    <dt>סניף</dt>
                    <dd>{sel.branchName}</dd>
                  </>
                )}
                {sel.treatment && (
                  <>
                    <dt>טיפול</dt>
                    <dd>{sel.treatment}</dd>
                  </>
                )}
                <dt>אזורים</dt>
                <dd className={styles.strong}>{sel.areas.join(' · ')}</dd>
                <dt>מה חשוב לה</dt>
                <dd className={ix.goal}>{sel.goal}</dd>
                <dt>הזרקות קודמות</dt>
                <dd>{sel.prior}</dd>
                <dt>ייעוץ</dt>
                <dd>
                  {sel.format}
                  {sel.when && (
                    <>
                      {' · '}
                      <LtrText text={sel.when} />
                    </>
                  )}
                </dd>
                <dt>טלפון</dt>
                <dd>
                  <a href={telHref(sel.phoneE164)} className={ix.phone}>
                    <span className="ltr tnum">{sel.phone}</span>
                  </a>
                </dd>
                {sel.booking && (
                  <>
                    <dt>תור ייעוץ</dt>
                    <dd>
                      <LtrText text={sel.booking.label} />
                      {sel.booking.practitioner && <> · {sel.booking.practitioner}</>} · <span className="ltr tnum">{sel.booking.ref}</span>
                    </dd>
                  </>
                )}
              </dl>

              {FLAGS.filter(fl => sel.flags.includes(fl.key)).map(fl => (
                <p key={fl.key} className={`${styles.warn} ${ix.inset}`}>
                  <strong>{fl.title}</strong> {fl.body}
                </p>
              ))}
              {sel.outcome && (
                <p className={`${styles.neutralNote} ${ix.inset}`}>
                  <LtrText text={sel.outcome} />
                </p>
              )}
              {sel.booking?.lapsed && sel.status === 'consult_scheduled' && (
                <p className={`${styles.warn} ${ix.inset}`}>
                  <strong>תור הייעוץ בוטל או שהתשלום לא הושלם.</strong> אפשר להציע מועד חדש או לסגור את הבקשה.
                </p>
              )}

              {manageable && (
                <div ref={panelRef} className={ix.panel}>
                  <Panel
                    key={sel.id + mode}
                    req={sel}
                    mode={mode}
                    busy={busy}
                    isPhysician={isPhysician}
                    doctorName={doctorName}
                    viewerName={viewer.name}
                    bizName={bizName}
                    openMode={openMode}
                    act={act}
                    sheet={shell}
                  />
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <p className={ix.roleNote}>
        {!canManage
          ? `מחובר/ת כ${viewer.roleName} (צפייה בלבד). פעולות על בקשות שמורות לבעלי הרשאת הזמנות.`
          : isPhysician
            ? `מחובר/ת כ־${viewer.name}. הצעת מועד ובקשת פרטים פתוחות לכל בעלי הרשאת הזמנות; סגירה מסיבה רפואית ואישור טיפול לרופא/ה בלבד.`
            : `מחובר/ת כ${viewer.roleName} (הרשאת הזמנות). סגירה מסיבה רפואית ואישור טיפול שמורים לרופא/ה: העבירי את הבקשה לעיון ${doctorName}.`}
      </p>

      {/* Phones: the detail screen's actions, above the tab bar. */}
      {view === 'detail' && manageable && sel && (
        <ActionBar mobileOnly className={ix.bar}>
          <Actions req={sel} busy={busy} isPhysician={isPhysician} openMode={openMode} act={act} compact />
        </ActionBar>
      )}

      {toast && (
        <div role={toast.bad ? 'alert' : 'status'} className={`${styles.toast} ${toast.bad ? styles.toastBad : ''} ${ix.toastPos}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ---------- Action panel ----------

type Act = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => Promise<void>;

const MODE_TITLE: Record<Exclude<Mode, 'none'>, string> = {
  propose: 'הצעת מועד לייעוץ',
  decline: 'סגירת הבקשה',
  approve: 'אישור טיפול',
};

function Panel({
  req, mode, busy, isPhysician, doctorName, viewerName, bizName, openMode, act, sheet,
}: {
  req: InboxRequest;
  mode: Mode;
  busy: boolean;
  isPhysician: boolean;
  doctorName: string;
  viewerName: string;
  bizName: string;
  openMode: (m: Mode) => void;
  act: Act;
  /** Phones: the forms open in a sheet and the buttons live in the action bar. */
  sheet: boolean;
}) {
  const first = firstName(req.name);
  const canSchedule = !(req.status === 'consult_scheduled' && !!req.booking?.live);

  const form =
    mode === 'propose' ? <ProposePanel req={req} busy={busy} doctorName={doctorName} bizName={bizName} openMode={openMode} act={act} />
    : mode === 'decline' ? <DeclinePanel req={req} busy={busy} isPhysician={isPhysician} viewerName={viewerName} openMode={openMode} act={act} />
    : mode === 'approve' ? <ApprovePanel req={req} busy={busy} openMode={openMode} act={act} />
    : null;

  if (form && !sheet) return form;

  return (
    <div className={ix.panelStack}>
      {req.proposed && canSchedule && (
        <div className={ix.proposed}>
          <span className={ix.proposedText}>
            הוצע ל{first}: <LtrText text={req.proposed.label} />. אישרה בוואטסאפ?
          </span>
          <button type="button" disabled={busy} onClick={() => act(() => confirmProposedAction(req.id))} className={ix.btnPrimary}>
            אישרה, לקבוע את הייעוץ
          </button>
        </div>
      )}
      <div className={`${styles.row} bf-desk-only`} style={{ gap: 8 }}>
        <Actions req={req} busy={busy} isPhysician={isPhysician} openMode={openMode} act={act} />
      </div>
      {form && mode !== 'none' && (
        <BottomSheet open onClose={() => openMode('none')} title={MODE_TITLE[mode]} size={mode === 'propose' ? 'full' : 'auto'}>
          {form}
        </BottomSheet>
      )}
    </div>
  );
}

/** The request's actions: a row in the desktop panel, the action bar on phones (short labels). */
function Actions({ req, busy, isPhysician, openMode, act, compact }: { req: InboxRequest; busy: boolean; isPhysician: boolean; openMode: (m: Mode) => void; act: Act; compact?: boolean }) {
  const scheduledLive = req.status === 'consult_scheduled' && !!req.booking?.live;
  const canSchedule = !scheduledLive; // new / awaiting, or a scheduled consult whose booking lapsed
  const decline = (
    <button key="decline" type="button" disabled={busy} onClick={() => openMode('decline')} className={ix.btnDanger}>
      לא מתאימה
    </button>
  );
  const ask = (req.status === 'new' || req.status === 'awaiting_client') && (
    <button key="ask" type="button" disabled={busy} onClick={() => act(() => askDetailsAction(req.id))} className={ix.btnGhost}>
      {compact ? 'בקשת פרטים' : req.status === 'awaiting_client' ? 'בקשת פרטים שוב בוואטסאפ' : 'בקשת פרטים בוואטסאפ'}
    </button>
  );
  const propose = canSchedule && (
    <button key="propose" type="button" disabled={busy} onClick={() => openMode('propose')} className={req.proposed && !compact ? ix.btnGhost : ix.btnPrimary}>
      {req.proposed ? 'הצעת מועד אחר' : compact ? 'הצעת מועד' : 'הצעת מועד לייעוץ'}
    </button>
  );
  const approve = scheduledLive && (
    <span key="approve" className={ix.gated}>
      <button
        type="button"
        aria-disabled={!isPhysician || busy || undefined}
        aria-describedby={isPhysician ? undefined : 'cs-approve-why'}
        onClick={() => isPhysician && !busy && openMode('approve')}
        className={ix.btnPrimary}
      >
        אישור טיפול
      </button>
      {!isPhysician && <span id="cs-approve-why" className={ix.gatedWhy}>שמור לרופא/ה</span>}
    </span>
  );
  // Desktop keeps the design's order; the phone bar puts the primary action last (it takes the width).
  return compact ? <>{decline}{ask}{approve || propose}</> : <>{propose}{ask}{approve}{decline}</>;
}

function ProposePanel({ req, busy, doctorName, bizName, openMode, act }: { req: InboxRequest; busy: boolean; doctorName: string; bizName: string; openMode: (m: Mode) => void; act: Act }) {
  const [days, setDays] = useState<SlotDay[] | null>(null);
  const [error, setError] = useState('');
  const [slot, setSlot] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    proposeSlotsAction(req.id)
      .then(res => {
        if (!live) return;
        if (res.ok) setDays(res.days);
        else setError(res.error);
      })
      .catch(() => live && setError('לא הצלחנו לטעון מועדים. נסו שוב.'));
    return () => {
      live = false;
    };
  }, [req.id]);

  const picked = days?.flatMap(d => d.slots.map(s => ({ ...s, day: d.label }))).find(s => s.startsAt === slot) ?? null;
  const msg = picked
    ? proposeMessage({ first: firstName(req.name), business: bizName, doctor: doctorName, day: picked.day, time: picked.time, fee: req.feeShekels })
    : 'בחרי מועד כדי לראות את נוסח ההודעה';

  return (
    <div>
      <span className={styles.subLabel} style={{ fontSize: 14 }}>בחרי מועד להציע</span>
      {!days && !error && <p className={styles.hintSm} role="status">טוען מועדים פנויים…</p>}
      {error && <p className={styles.alert} role="alert" style={{ marginBottom: 11 }}>{error}</p>}
      {days && days.length === 0 && <p className={styles.emptySlots}>אין מועדים פנויים ביומן הרופא/ה בשבועיים הקרובים.</p>}
      {days && days.length > 0 && <SlotPicker days={days} value={slot} onChange={setSlot} label="מועד להציע" />}
      <p className={ix.preview}><LtrText text={msg} /></p>
      <div className={`${styles.row} ${ix.formBtns}`} style={{ gap: 8 }}>
        <button type="button" disabled={!slot || busy} onClick={() => slot && act(() => proposeSlotAction(req.id, slot))} className={ix.btnPrimary}>
          שליחה בוואטסאפ
        </button>
        <button type="button" onClick={() => openMode('none')} className={ix.btnText}>ביטול</button>
      </div>
    </div>
  );
}

function DeclinePanel({ req, busy, isPhysician, viewerName, openMode, act }: { req: InboxRequest; busy: boolean; isPhysician: boolean; viewerName: string; openMode: (m: Mode) => void; act: Act }) {
  const [reason, setReason] = useState<DeclineKey | null>(null);
  const msg = reason ? declineMessage(reason, { first: firstName(req.name), doctor: viewerName }) : 'בחרי סיבה כדי לראות את נוסח ההודעה';
  return (
    <div>
      <span id="cs-reason" className={styles.subLabel} style={{ fontSize: 14 }}>סיבה</span>
      <div role="group" aria-labelledby="cs-reason" className={ix.reasons}>
        {DECLINES.map(d => {
          const locked = d.physicianOnly && !isPhysician;
          return (
            <button
              key={d.key}
              type="button"
              aria-pressed={reason === d.key}
              aria-disabled={locked || undefined}
              onClick={() => !locked && setReason(d.key)}
              className={ix.reason}
            >
              <span className={ix.reasonName}>{d.name}</span>
              <span className={ix.reasonWho}>{locked ? 'שמור לרופא/ה' : d.who}</span>
            </button>
          );
        })}
      </div>
      {req.status === 'consult_scheduled' && req.booking?.live && (
        <p className={styles.hintSm}>תור הייעוץ יבוטל, ודמי ייעוץ ששולמו יוחזרו במלואם.</p>
      )}
      <p className={ix.preview} style={{ borderColor: 'var(--line)' }}>{msg}</p>
      <div className={`${styles.row} ${ix.formBtns}`} style={{ gap: 8 }}>
        <button type="button" disabled={!reason || busy} onClick={() => reason && act(() => declineAction(req.id, reason))} className={ix.btnBad}>
          שליחת התשובה
        </button>
        <button type="button" onClick={() => openMode('none')} className={ix.btnText}>ביטול</button>
      </div>
    </div>
  );
}

function ApprovePanel({ req, busy, openMode, act }: { req: InboxRequest; busy: boolean; openMode: (m: Mode) => void; act: Act }) {
  const [note, setNote] = useState('');
  return (
    <div>
      <label className={styles.field} style={{ marginTop: 0 }}>
        סיכום קצר להחלטה (לא חובה)
        <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 500))} rows={2} maxLength={500} className={styles.textarea} placeholder="למשל: מתאימה לטיפול באזור בין הגבות, אפשר באותו ביקור." />
      </label>
      <p className={styles.hintSm} style={{ marginTop: 9 }}>
        {req.feeShekels > 0 ? (
          <>
            דמי הייעוץ, <span className="ltr tnum">₪{req.feeShekels}</span>, מתקזזים מהטיפול.{' '}
          </>
        ) : null}
        את תור הטיפול קובעים מהיומן, או מטפלים כבר בביקור הזה.
      </p>
      <div className={`${styles.row} ${ix.formBtns}`} style={{ gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => act(() => approveTreatmentAction(req.id, note))} className={ix.btnPrimary}>
          אישור טיפול
        </button>
        <button type="button" onClick={() => openMode('none')} className={ix.btnText}>ביטול</button>
      </div>
    </div>
  );
}
