'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { clock, entryMatches, plFree, plMatching, plMinutes, plWaiting } from './shared';
import { Ltr } from './ui';
import { Toast, useToast } from './toast';
import styles from './Waitlist.module.css';

// Design: project/BeautyFind Waitlist.dc.html (view=clinic). Renders inside the clinic layout.

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

export type OfferSlotInput = { branchId: string; treatmentId: string; practitionerId: string | null; startsAt: string };
export type OfferSlotResult = { ok: true; sentTo: string } | { ok: false; error: 'forbidden' | 'invalid' | 'no_match' };

const OFFER_ERR: Record<string, string> = {
  no_match: 'אין ממתינה שמתאימה לתור הזה, או שהוא כבר לא פנוי',
  forbidden: 'אין לך הרשאה לשלוח הצעות מרשימת ההמתנה',
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
  const now = useNow(data.serverNow, data.offers.length > 0);

  const matchSet = useMemo(() => new Set(data.freed.filter(f => !f.sentTo).flatMap(f => f.matchIds)), [data.freed]);
  const shown = filter === 'all' ? data.entries : data.entries.filter(e => e.treatmentId === filter);
  const groups = data.treatments.filter(t => filter === 'all' || t.id === filter).map(t => ({ ...t, rows: shown.filter(e => e.treatmentId === t.id) }));

  const send = (input: OfferSlotInput) =>
    start(async () => {
      const r = await offerSlot(input).catch((): OfferSlotResult => ({ ok: false, error: 'invalid' }));
      if (r.ok) flash(`ההצעה נשלחה ל${r.sentTo} בוואטסאפ · שמירה ל־${plMinutes(data.holdMinutes)}`);
      else flash(OFFER_ERR[r.error] ?? OFFER_ERR.invalid);
      router.refresh();
    });

  const remove = (entryId: string) =>
    start(async () => {
      const r = await removeEntry({ branchId, entryId }).catch(() => ({ ok: false }));
      setConfirmId(null);
      flash(r.ok ? 'הוסרה מרשימת ההמתנה' : 'לא הצלחנו להסיר. נסו שוב.');
      router.refresh();
    });

  return (
    <div className={styles.fade}>
      <Toast text={toast} />
      <div className={styles.qHead}>
        <div className={styles.qHeadText}>
          <span className={styles.qKicker}>{kicker}</span>
          <h1 className={styles.qH1}>רשימת המתנה</h1>
        </div>
        <span className={styles.qCount}>{plWaiting(data.entries.length)}</span>
      </div>

      {branches.length > 1 && (
        <nav aria-label="סניף" className={styles.filters}>
          {branches.map(b => (
            <a key={b.id} href={b.href} className={`${styles.filter} ${b.id === branchId ? styles.filterOn : ''}`} aria-current={b.id === branchId ? 'page' : undefined}>
              {b.name}
            </a>
          ))}
        </nav>
      )}

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
              {f.sentTo ? `נשלח ל${f.sentTo} · ממתין` : 'הצעה לראשונה המתאימה'}
            </button>
          )}
        </div>
      ))}

      {data.offers.length > 0 && (
        <section className={styles.panel} aria-labelledby="wl-offers">
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

      {canManage && data.picker.some(p => p.days.length) && <ManualOffer data={data} branchId={branchId} pending={pending} onSend={send} />}

      <section className={styles.panel} aria-labelledby="wl-queue">
        <div className={styles.panelHead}>
          <h2 id="wl-queue" className={styles.panelH}>
            ממתינות לפי טיפול
          </h2>
        </div>
        {data.treatments.length > 1 && (
          <div className={styles.panelBody}>
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
        )}
        {data.entries.length === 0 && <p className={styles.empty}>אין כרגע ממתינות. לקוחות מצטרפות לרשימה מעמוד ההזמנה כשאין תור שמתאים להן.</p>}
        {groups.map(g => (
          <div key={g.id}>
            {(filter === 'all' || data.treatments.length > 1) && <h3 className={styles.groupH}>{g.name}</h3>}
            <ul className={styles.list}>
              {g.rows.map(q => {
                const sent = q.status === 'offered';
                const match = !sent && matchSet.has(q.id);
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
                    <span className={`${styles.pill} ${sent ? styles.pillSent : match ? styles.pillMatch : styles.pillWait}`}>
                      {sent ? 'נשלחה הצעה' : match ? 'מתאימה לפינוי' : 'ממתינה'}
                    </span>
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
          </div>
        ))}
      </section>

      <p className={styles.foot}>ההצעה נשלחת לפי סדר ההצטרפות, רק למי שהעדפות היום, השעה והמטפלת שלה מתאימות. זמן השמירה נקבע בהגדרות הקליניקה.</p>
    </div>
  );
}

/** Pick a free slot (treatment → day → time → practitioner) and offer it to the first match. */
function ManualOffer({ data, branchId, pending, onSend }: { data: QueueData; branchId: string; pending: boolean; onSend: (i: OfferSlotInput) => void }) {
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
  return (
    <section className={styles.panel} aria-labelledby="wl-manual">
      <div className={styles.panelHead}>
        <h2 id="wl-manual" className={styles.panelH}>
          הצעת תור פנוי מהיומן
        </h2>
        <span className={styles.panelNote}>נשלח לראשונה ברשימה שההעדפות שלה מתאימות</span>
      </div>
      <div className={styles.panelBody}>
        {options.length > 1 && (
          <>
            <span id="wl-m-t" className={styles.pickLabel}>
              טיפול
            </span>
            <div role="radiogroup" aria-labelledby="wl-m-t" className={styles.chips}>
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
        <span id="wl-m-d" className={styles.pickLabel}>
          יום {options.length === 1 ? `· ${tName}` : ''}
        </span>
        <div role="radiogroup" aria-labelledby="wl-m-d" className={styles.chips}>
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
            <span id="wl-m-s" className={styles.pickLabel}>
              שעה
            </span>
            <div role="radiogroup" aria-labelledby="wl-m-s" className={styles.chips}>
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
            <span id="wl-m-p" className={styles.pickLabel}>
              מטפלת
            </span>
            <div role="radiogroup" aria-labelledby="wl-m-p" className={styles.chips}>
              {staff.map(s => (
                <button key={s.id} type="button" role="radio" aria-checked={s.id === who?.id} className={`${styles.chip} ${s.id === who?.id ? styles.on : ''}`} onClick={() => setStaffId(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className={styles.pickFoot}>
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
            className={styles.bannerBtn}
            disabled={!slot || !who || !matches || pending}
            onClick={() => slot && who && onSend({ branchId, treatmentId: pick.treatmentId, practitionerId: who.id, startsAt: slot.startsAt })}
          >
            הצעה לראשונה המתאימה
          </button>
        </div>
      </div>
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
