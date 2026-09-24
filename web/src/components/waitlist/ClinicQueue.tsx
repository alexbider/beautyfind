'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { waHref } from '../clinic/labels';
import { useDetailParam } from '../clinic/mobile';
import { ActionBar } from '../shell/ActionBar';
import { BottomSheet } from '../shell/BottomSheet';
import { haptic } from '../shell/haptics';
import { PullToRefresh } from '../shell/PullToRefresh';
import { Segmented } from '../shell/Segmented';
import { SwipeRow } from '../shell/SwipeRow';
import { TopBar } from '../shell/TopBar';
import { clock, entryMatches, plFree, plMatching, plMinutes, plWaiting } from './shared';
import { Ltr, WaIcon } from './ui';
import { useToast } from './toast';
import styles from './Waitlist.module.css';
import cq from './ClinicQueue.module.css';

// Design: project/BeautyFind Waitlist.dc.html (view=clinic). Renders inside the clinic layout.
// Phones (spec §6 Waitlist queue): full-bleed rows with pull to refresh and swipe to remove, a row
// opens the entry's screen (?e=… in the URL, so back returns to the list), actions sit in the
// sticky action bar and the free-slot picker opens in a sheet. Desktop keeps the design's layout.

type SlotParts = { day: string; date: string; time: string };

export type QueueData = {
  holdMinutes: number;
  serverNow: number;
  treatments: { id: string; name: string; count: number }[];
  entries: {
    id: string;
    n: number;
    name: string;
    phone: string;
    phoneE164: string;
    treatmentId: string;
    treatment: string;
    pref: string;
    days: number[];
    timeRanges: string[];
    practitionerId: string | null;
    since: string;
    status: 'active' | 'offered';
  }[];
  offers: ({ id: string; name: string; treatment: string; practitioner: string | null; holdUntil: number } & SlotParts)[];
  freed: ({
    key: string;
    treatmentId: string;
    practitionerId: string | null;
    startsAt: string;
    practitioner: string | null;
    treatment: string;
    cancelledBy: string;
    matchIds: string[];
    sentTo: string | null;
  } & SlotParts)[];
  picker: {
    treatmentId: string;
    practitioners: { id: string; name: string }[];
    days: { date: string; day: string; dateText: string; dow: number; slots: { startsAt: string; time: string; hh: number; practitionerIds: string[] }[] }[];
  }[];
};

type Entry = QueueData['entries'][number];

export type OfferSlotInput = { branchId: string; treatmentId: string; practitionerId: string | null; startsAt: string };
export type OfferSlotResult = { ok: true; sentTo: string } | { ok: false; error: 'forbidden' | 'invalid' | 'no_match' };

const OFFER_ERR: Record<string, string> = {
  no_match: 'אין ממתינה שמתאימה לתור הזה, או שהוא כבר לא פנוי',
  forbidden: 'אין הרשאה לשלוח הצעות מרשימת ההמתנה',
  invalid: 'התור הזה כבר לא זמין',
};

export function ClinicQueue({
  kicker,
  branchId,
  branches,
  canManage,
  data,
  offerSlot,
  removeEntry,
}: {
  kicker: string;
  branchId: string;
  branches: { id: string; name: string; href: string }[];
  canManage: boolean;
  data: QueueData;
  offerSlot: (input: OfferSlotInput) => Promise<OfferSlotResult>;
  removeEntry: (input: { branchId: string; entryId: string }) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [toast, flash] = useToast();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<string>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [picking, setPicking] = useState(false);
  const detail = useDetailParam('e');
  const now = useNow(data.serverNow, data.offers.length > 0);

  const matchSet = useMemo(() => new Set(data.freed.filter(f => !f.sentTo).flatMap(f => f.matchIds)), [data.freed]);
  const shown = filter === 'all' ? data.entries : data.entries.filter(e => e.treatmentId === filter);
  const groups = data.treatments.filter(t => filter === 'all' || t.id === filter).map(t => ({ ...t, rows: shown.filter(e => e.treatmentId === t.id) }));
  const entry = detail.id ? data.entries.find(e => e.id === detail.id) ?? null : null;
  const view = detail.id ? 'detail' : 'list';
  const canPick = canManage && data.picker.some(p => p.days.length);

  const send = (input: OfferSlotInput) =>
    start(async () => {
      const r = await offerSlot(input).catch((): OfferSlotResult => ({ ok: false, error: 'invalid' }));
      if (r.ok) {
        haptic('success');
        setPicking(false);
        flash(`ההצעה נשלחה ל${r.sentTo} בוואטסאפ · שמירה ל־${plMinutes(data.holdMinutes)}`);
      } else {
        haptic('warning');
        flash(OFFER_ERR[r.error] ?? OFFER_ERR.invalid);
      }
      router.refresh();
    });

  const remove = (entryId: string) =>
    start(async () => {
      const r = await removeEntry({ branchId, entryId }).catch(() => ({ ok: false }));
      setConfirmId(null);
      setRemoving(null);
      if (r.ok && detail.id === entryId) detail.close();
      if (!r.ok) haptic('warning');
      flash(r.ok ? 'הוסרה מרשימת ההמתנה' : 'לא הצלחנו להסיר. נסו שוב.');
      router.refresh();
    });

  const statusPill = (q: Entry) => {
    const sent = q.status === 'offered';
    const match = !sent && matchSet.has(q.id);
    return (
      <span className={`${styles.pill} ${sent ? styles.pillSent : match ? styles.pillMatch : styles.pillWait}`}>
        {sent ? 'נשלחה הצעה' : match ? 'מתאימה לפינוי' : 'ממתינה'}
      </span>
    );
  };

  return (
    <div className={cq.screen} data-view={view}>
      {view === 'detail' ? (
        <TopBar mode="pushed" title={entry?.name ?? 'רשימת המתנה'} onBack={detail.close} />
      ) : (
        <TopBar mode="root" largeTitle="רשימת המתנה" />
      )}

      <div className={cq.listPane}>
        <div className={`${styles.qHead} ${cq.head}`}>
          <div className={styles.qHeadText}>
            <span className={styles.qKicker}>{kicker}</span>
            <h1 className={`${styles.qH1} bf-desk-only`}>רשימת המתנה</h1>
          </div>
          <span className={styles.qCount}>{plWaiting(data.entries.length)}</span>
        </div>

        {branches.length > 1 && (
          <>
            <nav aria-label="סניף" className={`${styles.filters} bf-desk-only`}>
              {branches.map(b => (
                <a key={b.id} href={b.href} className={`${styles.filter} ${b.id === branchId ? styles.filterOn : ''}`} aria-current={b.id === branchId ? 'page' : undefined}>
                  {b.name}
                </a>
              ))}
            </nav>
            <div className={`${cq.seg} bf-shell-only`}>
              <Segmented label="סניף" value={branchId} items={branches.map(b => ({ key: b.id, label: b.name, href: b.href }))} />
            </div>
          </>
        )}

        <PullToRefresh>
          <div className={cq.cards}>
            {data.freed.map(f => (
              <div key={f.key} className={styles.banner}>
                <span className={styles.bannerText}>
                  <strong>התפנה תור:</strong> {f.day}{' '}
                  <Ltr className={styles.num}>
                    {f.date} {f.time}
                  </Ltr>{' '}
                  · {[f.practitioner, f.treatment].filter(Boolean).join(' · ')} (ביטול של {f.cancelledBy}). {f.sentTo ? '' : plMatching(f.matchIds.length)}
                </span>
                {canManage && (
                  <button
                    type="button"
                    className={styles.bannerBtn}
                    disabled={!!f.sentTo || !f.matchIds.length || pending}
                    onClick={() => send({ branchId, treatmentId: f.treatmentId, practitionerId: f.practitionerId, startsAt: f.startsAt })}
                  >
                    {f.sentTo ? `נשלח ל${f.sentTo} · ממתין` : 'הצעה לראשונה שמתאימה'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {data.offers.length > 0 && (
            <section className={`${styles.panel} ${cq.panel}`} aria-labelledby="wl-offers">
              <div className={styles.panelHead}>
                <h2 id="wl-offers" className={styles.panelH}>
                  הצעות פתוחות
                </h2>
                <span className={styles.panelNote}>
                  שמירה ל־<Ltr>{data.holdMinutes}</Ltr> דקות מרגע ההודעה
                </span>
              </div>
              <ul className={styles.list}>
                {data.offers.map(o => {
                  const left = Math.max(0, Math.round((o.holdUntil - now) / 1000));
                  return (
                    <li key={o.id} className={styles.row}>
                      <span className={styles.who}>
                        <span className={styles.whoName}>{o.name}</span>
                        <span className={styles.whoSub}>
                          {o.treatment} · {o.day}{' '}
                          <Ltr className={styles.num}>
                            {o.date} {o.time}
                          </Ltr>
                          {o.practitioner ? ` · ${o.practitioner}` : ''}
                        </span>
                      </span>
                      <span className={`${styles.pill} ${styles.pillSent}`}>נשלחה הצעה</span>
                      <span role="timer" aria-label={`זמן שנותר להצעה של ${o.name}`} dir="ltr" className={`${styles.miniTimer} ${left < 300 ? styles.miniTimerLow : ''}`}>
                        {left > 0 ? clock(left) : 'עבר'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {canPick && (
            <div className="bf-desk-only">
              <ManualOffer data={data} branchId={branchId} pending={pending} onSend={send} />
            </div>
          )}

          <section className={`${styles.panel} ${cq.panel}`} aria-labelledby="wl-queue">
            <div className={styles.panelHead}>
              <h2 id="wl-queue" className={styles.panelH}>
                ממתינות לפי טיפול
              </h2>
            </div>
            {data.treatments.length > 1 && (
              <>
                <div className={`${styles.panelBody} bf-desk-only`}>
                  <div role="radiogroup" aria-label="סינון לפי טיפול" className={styles.filters}>
                    {[{ id: 'all', name: 'הכל', count: data.entries.length }, ...data.treatments].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={filter === t.id}
                        className={`${styles.filter} ${filter === t.id ? styles.filterOn : ''}`}
                        onClick={() => setFilter(t.id)}
                      >
                        {t.name}
                        <Ltr className={styles.filterN}>{t.count}</Ltr>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bf-shell-only">
                  <Segmented
                    label="סינון לפי טיפול"
                    value={filter}
                    onChange={setFilter}
                    items={[{ id: 'all', name: 'הכל', count: data.entries.length }, ...data.treatments].map(t => ({ key: t.id, label: t.name, count: t.count }))}
                  />
                </div>
              </>
            )}
            {data.entries.length === 0 && <p className={styles.empty}>אין כרגע ממתינות. לקוחות מצטרפות לרשימה מעמוד ההזמנה כשאין תור שמתאים להן.</p>}
            {groups.map(g => (
              <div key={g.id}>
                {(filter === 'all' || data.treatments.length > 1) && <h3 className={styles.groupH}>{g.name}</h3>}
                {/* Desktop rows: the design's inline two-step remove. */}
                <ul className={`${styles.list} bf-desk-only`}>
                  {g.rows.map(q => {
                    const match = q.status !== 'offered' && matchSet.has(q.id);
                    return (
                      <li key={q.id} className={`${styles.row} ${match ? styles.rowMatch : ''}`}>
                        <span dir="ltr" className={styles.n}>
                          {q.n}
                        </span>
                        <span className={styles.who}>
                          <span className={styles.whoName}>{q.name}</span>
                          <span className={styles.whoSub}>
                            {q.treatment} · {q.pref}
                          </span>
                          <a href={`tel:${q.phoneE164}`} className={styles.whoPhone}>
                            <Ltr>{q.phone}</Ltr>
                          </a>
                        </span>
                        {statusPill(q)}
                        <span className={styles.sinceTxt}>{q.since}</span>
                        {canManage && (
                          <button
                            type="button"
                            className={styles.remove}
                            disabled={pending}
                            onClick={() => (confirmId === q.id ? remove(q.id) : setConfirmId(q.id))}
                            onBlur={() => setConfirmId(c => (c === q.id ? null : c))}
                            aria-label={confirmId === q.id ? `לאשר הסרה של ${q.name}` : `הסרה של ${q.name} מהרשימה`}
                          >
                            {confirmId === q.id ? 'לאשר הסרה' : 'הסרה'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {/* Phone rows: tap opens the entry, swipe reveals "הסרה" (confirmed in a sheet). */}
                <ul className={`${cq.mList} bf-shell-only`}>
                  {g.rows.map(q => {
                    const match = q.status !== 'offered' && matchSet.has(q.id);
                    const row = (
                      <button type="button" className={cq.mRow} data-match={match || undefined} onClick={() => detail.open(q.id)}>
                        <span dir="ltr" className={styles.n}>
                          {q.n}
                        </span>
                        <span className={cq.mWho}>
                          <span className={styles.whoName}>{q.name}</span>
                          <span className={cq.mSub}>{q.pref}</span>
                        </span>
                        {statusPill(q)}
                        <Chevron />
                      </button>
                    );
                    return (
                      <li key={q.id}>
                        {canManage ? <SwipeRow actions={[{ label: 'הסרה', tone: 'danger', onAction: () => setRemoving(q) }]}>{row}</SwipeRow> : row}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          <p className={`${styles.foot} ${cq.foot}`}>ההצעה נשלחת לפי סדר ההצטרפות, רק למי שהעדפות היום, השעה והמטפלת שלה מתאימות. זמן השמירה נקבע בהגדרות הקליניקה.</p>
        </PullToRefresh>
      </div>

      {/* Phone detail screen for one entry. */}
      {view === 'detail' && (
        <section className={`${cq.detail} bf-shell-only`} aria-labelledby="wl-entry">
          {entry ? (
            <>
              <div className={cq.dHead}>
                <span dir="ltr" className={styles.n} aria-label={`מקום ${entry.n} ברשימה`}>
                  {entry.n}
                </span>
                <h2 id="wl-entry" className={cq.dName}>
                  {entry.name}
                </h2>
                {statusPill(entry)}
              </div>
              <dl className={cq.dl}>
                <dt>טיפול</dt>
                <dd>{entry.treatment}</dd>
                <dt>העדפות</dt>
                <dd>{entry.pref}</dd>
                <dt>טלפון</dt>
                <dd>
                  <a href={`tel:${entry.phoneE164}`} className={cq.phone}>
                    <Ltr>{entry.phone}</Ltr>
                  </a>
                </dd>
                <dt>ברשימה</dt>
                <dd>{entry.since}</dd>
              </dl>
              <p className={cq.note}>
                {entry.status === 'offered'
                  ? 'נשלחה לה הצעה לתור שהתפנה, והתור שמור לה עד שתענה או עד שזמן השמירה יסתיים.'
                  : matchSet.has(entry.id)
                    ? 'מתאימה לתור שהתפנה. ההצעה נשלחת לראשונה ברשימה שמתאימה, לפי סדר ההצטרפות.'
                    : 'כשיתפנה תור שמתאים להעדפות שלה, הוא יוצע לה לפי סדר ההצטרפות.'}
              </p>
            </>
          ) : (
            <p className={cq.note}>הממתינה כבר לא ברשימה.</p>
          )}
        </section>
      )}

      {/* Phones: list screen → the free-slot picker; entry screen → call, WhatsApp, remove. */}
      {view === 'list' && canPick && (
        <ActionBar mobileOnly>
          <button type="button" className={cq.barPrimary} onClick={() => setPicking(true)}>
            הצעת תור פנוי מהיומן
          </button>
        </ActionBar>
      )}
      {view === 'detail' && entry && (
          <ActionBar mobileOnly>
            {canManage && (
              <button type="button" className={cq.barDanger} disabled={pending} onClick={() => setRemoving(entry)}>
                הסרה
              </button>
            )}
            <a href={waHref(entry.phoneE164)} target="_blank" rel="noopener noreferrer" className={cq.barGhost} aria-label={`וואטסאפ ל${entry.name}`}>
              <WaIcon />
            </a>
            <a href={`tel:${entry.phoneE164}`} className={cq.barPrimary}>
              חיוג
            </a>
          </ActionBar>
      )}

      {canPick && (
        <BottomSheet open={picking} onClose={() => setPicking(false)} title="הצעת תור פנוי מהיומן" size="full">
          <ManualOffer data={data} branchId={branchId} pending={pending} onSend={send} bare />
        </BottomSheet>
      )}

      <BottomSheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing ? `להסיר את ${removing.name} מרשימת ההמתנה?` : 'הסרה מרשימת ההמתנה'}
        footer={
          <div className={cq.sheetBtns}>
            <button type="button" className={cq.barGhostText} onClick={() => setRemoving(null)}>
              חזרה
            </button>
            <button type="button" className={cq.barDangerSolid} disabled={pending} onClick={() => removing && remove(removing.id)}>
              הסרה מהרשימה
            </button>
          </div>
        }
      >
        <p className={cq.sheetText}>
          {removing?.status === 'offered' ? 'ההצעה הפתוחה שנשלחה לה תעבור לממתינה הבאה שמתאימה.' : 'היא לא תקבל יותר הצעות לתורים שמתפנים.'}
        </p>
      </BottomSheet>

      <div role="status" aria-live="polite">
        {toast && <div className={cq.toast}>{toast}</div>}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className={cq.chev} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3 5 7l4 4" />
    </svg>
  );
}

/** Pick a free slot (treatment → day → time → practitioner) and offer it to the first match. */
function ManualOffer({ data, branchId, pending, onSend, bare }: { data: QueueData; branchId: string; pending: boolean; onSend: (i: OfferSlotInput) => void; bare?: boolean }) {
  const options = data.picker.filter(p => p.days.length);
  const [tId, setTId] = useState(options[0]?.treatmentId ?? '');
  const pick = options.find(p => p.treatmentId === tId) ?? options[0];
  const [date, setDate] = useState<string | null>(null);
  const [slotAt, setSlotAt] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);

  const day = pick?.days.find(d => d.date === date) ?? null;
  const slot = day?.slots.find(s => s.startsAt === slotAt) ?? null;
  const staff = slot ? pick.practitioners.filter(p => slot.practitionerIds.includes(p.id)) : [];
  const who = staff.find(s => s.id === staffId) ?? staff[0] ?? null;
  const tName = data.treatments.find(t => t.id === pick?.treatmentId)?.name ?? '';

  const matches =
    slot && day && who
      ? data.entries.filter(e => e.status === 'active' && e.treatmentId === pick.treatmentId && entryMatches(e, { dow: day.dow, hh: slot.hh, practitionerId: who.id })).length
      : 0;

  if (!pick) return null;
  const idp = bare ? 'wl-ms' : 'wl-m';
  const body = (
    <div className={bare ? cq.pickBare : styles.panelBody}>
      {bare && <p className={cq.sheetText}>נשלח לראשונה ברשימה שההעדפות שלה מתאימות.</p>}
      {options.length > 1 && (
        <>
          <span id={`${idp}-t`} className={styles.pickLabel}>
            טיפול
          </span>
          <div role="radiogroup" aria-labelledby={`${idp}-t`} className={styles.chips}>
            {options.map(o => (
              <button
                key={o.treatmentId}
                type="button"
                role="radio"
                aria-checked={o.treatmentId === pick.treatmentId}
                className={`${styles.chip} ${o.treatmentId === pick.treatmentId ? styles.on : ''}`}
                onClick={() => {
                  setTId(o.treatmentId);
                  setDate(null);
                  setSlotAt(null);
                  setStaffId(null);
                }}
              >
                {data.treatments.find(t => t.id === o.treatmentId)?.name}
              </button>
            ))}
          </div>
        </>
      )}
      <span id={`${idp}-d`} className={styles.pickLabel}>
        יום {options.length === 1 ? `· ${tName}` : ''}
      </span>
      <div role="radiogroup" aria-labelledby={`${idp}-d`} className={styles.chips}>
        {pick.days.map(d => (
          <button
            key={d.date}
            type="button"
            role="radio"
            aria-checked={d.date === date}
            className={`${styles.chip} ${styles.dateChip} ${d.date === date ? styles.on : ''}`}
            onClick={() => {
              setDate(d.date);
              setSlotAt(null);
              setStaffId(null);
            }}
          >
            <span>
              {d.day} <Ltr className={styles.num}>{d.dateText}</Ltr>
            </span>
            <span className={styles.dateSub}>{plFree(d.slots.length)}</span>
          </button>
        ))}
      </div>
      {day && (
        <>
          <span id={`${idp}-s`} className={styles.pickLabel}>
            שעה
          </span>
          <div role="radiogroup" aria-labelledby={`${idp}-s`} className={styles.chips}>
            {day.slots.map(s => (
              <button
                key={s.startsAt}
                type="button"
                role="radio"
                aria-checked={s.startsAt === slotAt}
                className={`${styles.chip} ${s.startsAt === slotAt ? styles.on : ''}`}
                onClick={() => {
                  setSlotAt(s.startsAt);
                  setStaffId(null);
                }}
              >
                <Ltr className={styles.num}>{s.time}</Ltr>
              </button>
            ))}
          </div>
        </>
      )}
      {slot && staff.length > 1 && (
        <>
          <span id={`${idp}-p`} className={styles.pickLabel}>
            מטפלת
          </span>
          <div role="radiogroup" aria-labelledby={`${idp}-p`} className={styles.chips}>
            {staff.map(s => (
              <button key={s.id} type="button" role="radio" aria-checked={s.id === who?.id} className={`${styles.chip} ${s.id === who?.id ? styles.on : ''}`} onClick={() => setStaffId(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className={`${styles.pickFoot} ${bare ? cq.pickFoot : ''}`}>
        <span className={styles.pickSummary}>
          {slot && day && who ? (
            <>
              {day.day} <Ltr className={styles.num}>{day.dateText} {slot.time}</Ltr> · {who.name}. {plMatching(matches)}
            </>
          ) : (
            'בחרו יום ושעה פנויים ביומן.'
          )}
        </span>
        <button
          type="button"
          className={bare ? cq.barPrimary : styles.bannerBtn}
          disabled={!slot || !who || !matches || pending}
          onClick={() => slot && who && onSend({ branchId, treatmentId: pick.treatmentId, practitionerId: who.id, startsAt: slot.startsAt })}
        >
          הצעה לראשונה שמתאימה
        </button>
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <section className={styles.panel} aria-labelledby="wl-manual">
      <div className={styles.panelHead}>
        <h2 id="wl-manual" className={styles.panelH}>
          הצעת תור פנוי מהיומן
        </h2>
        <span className={styles.panelNote}>נשלח לראשונה ברשימה שההעדפות שלה מתאימות</span>
      </div>
      {body}
    </section>
  );
}

/** Ticks once a second while there are open offers; starts from the server's clock. */
function useNow(serverNow: number, active: boolean) {
  const skew = useRef(serverNow - Date.now());
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    skew.current = serverNow - Date.now();
    setNow(serverNow);
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => clearInterval(iv);
  }, [serverNow, active]);
  return now;
}
