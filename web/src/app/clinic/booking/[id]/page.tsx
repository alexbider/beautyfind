import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PaymentStatus } from '@prisma/client';
import { ActionPanel, OpButton, type ActView } from '@/components/clinic/BookingControls';
import { SOURCE, dayName, ddmm, ddmmHhmm, roleOfProfession, waHref } from '@/components/clinic/labels';
import { UpgradeCard } from '@/components/clinic/UpgradeCard';
import styles from '@/components/clinic/ClinicBooking.module.css';
import { TopBar } from '@/components/shell/TopBar';
import { QUESTIONS, plAnswers, type SealedDeclaration } from '@/components/declaration/questions';
import { fromE164, nisFromAgorot, telHref } from '@/lib/format';
import { VAT_RATE } from '@/lib/pricing';
import { bookingToken } from '@/lib/server/booking';
import { clinicContext } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { open } from '@/lib/server/secure';
import { hhmm, ilDate, ilParts } from '@/lib/time';
import {
  actorFrom, canAck, canFinish, canStart, isValidDecl, loadForActor, readerOf, undoableNoShow, type ClinicBooking,
} from '../transitions';

// Design: project/BeautyFind Clinic Booking.dc.html
// Rules: 03-states.md "Booking" / "Health declaration", 04-permissions.md (answers: treating
// practitioner + branch doctor only, every read audit-logged; front desk sees the status only).

export const metadata: Metadata = { title: 'כרטיס תור', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STEPS = ['מאושר', 'הגיעה', 'בטיפול', 'הסתיים'];
const STAGE: Partial<Record<ClinicBooking['status'], number>> = { pending_payment: 0, confirmed: 0, checked_in: 1, in_treatment: 2, completed: 3 };
const NOT_VISIBLE = 'גלוי למטפל/ת ולרופא/ה בלבד';

const DECISION_TEXT: Record<string, string> = {
  check_in: 'צ׳ק־אין · המטופלת הגיעה',
  start: 'הטיפול התחיל',
  physician_ack: 'ממצאי ההצהרה אושרו על ידי רופא/ה',
  finish: 'הטיפול הסתיים · הנחיות אחרי הטיפול נשלחו',
  no_show: 'סומן: לא הגיעה',
  undo_no_show: 'בוטל הסימון ״לא הגיעה״',
  resend_declaration: 'נשלח שוב קישור להצהרת בריאות',
  cancel: 'התור בוטל על ידי הקליניקה',
};

const plRest = (n: number) => (n === 1 ? 'השאלה הנוספת: לא.' : n === 2 ? 'שתי השאלות הנוספות: לא.' : `שאר ${n} השאלות: לא.`);

export default async function ClinicBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await clinicContext('bookings');
  if (!ctx.advanced) return <><TopBar mode="pushed" title="כרטיס תור" backHref="/clinic" /><div className={styles.page}><UpgradeCard area="תורים והצהרות בריאות" /></div></>;

  const a = actorFrom(ctx);
  const b = await loadForActor(id, a);
  if (!b) notFound();

  const now = new Date();
  const reader = readerOf(a, b);
  const pr = b.practitioner;
  const prName = pr?.displayName ?? 'מטפל/ת';
  const medical = !!b.treatment?.isMedical;
  const token = bookingToken(b.id);

  // ---------- declaration ----------
  const d = b.declaration;
  const valid = isValidDecl(d, now);
  const hdState: 'none' | 'pending' | 'signed' | 'flagged' = !b.requiresDeclaration && !d ? 'none' : !valid ? 'pending' : d!.flagged ? 'flagged' : 'signed';
  let sealed: SealedDeclaration | null = null;
  if (reader && valid && d) {
    try {
      sealed = open<SealedDeclaration>(d.answersEnc);
    } catch (e) {
      console.error('[clinic] declaration unseal failed', e);
    }
    if (sealed) {
      await db.auditLog.create({
        data: { actorId: a.userId, action: 'read_declaration', subjectType: 'health_declaration', subjectId: d.id, businessId: a.businessId, meta: { bookingId: b.id, memberId: a.memberId } },
      });
    }
  }
  const qs = d ? QUESTIONS[d.type] : [];
  const yesAnswers = sealed?.answers.filter(x => x.yes) ?? [];
  const staffIds: string[] = d?.physicianAckById ? [d.physicianAckById] : [];

  // ---------- clinical record ----------
  let clinical: { productBatch: string; units: number | null; notes: string; recordedBy: string } | null = null;
  if (reader && b.clinicalEnc) {
    try {
      clinical = open(b.clinicalEnc);
      await db.auditLog.create({
        data: { actorId: a.userId, action: 'read_clinical', subjectType: 'booking', subjectId: b.id, businessId: a.businessId, meta: { memberId: a.memberId } },
      });
    } catch (e) {
      console.error('[clinic] clinical unseal failed', e);
    }
  }
  if (clinical?.recordedBy) staffIds.push(clinical.recordedBy);

  // ---------- log ----------
  const decisions = await db.decision.findMany({
    where: { OR: [{ subjectType: 'booking', subjectId: b.id }, ...(d ? [{ subjectType: 'health_declaration', subjectId: d.id }] : [])] },
    orderBy: { createdAt: 'desc' },
  });
  const actorUserIds = [...new Set(decisions.map(x => x.actorId).filter((x): x is string => !!x))];
  const [staffById, staffByUser, visits, undo] = await Promise.all([
    staffIds.length ? db.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, displayName: true } }) : [],
    actorUserIds.length ? db.staffMember.findMany({ where: { businessId: a.businessId, userId: { in: actorUserIds } }, select: { userId: true, displayName: true } }) : [],
    db.booking.findMany({
      where: { clientPhone: b.clientPhone, status: 'completed', branch: { businessId: a.businessId }, id: { not: b.id } },
      select: { startsAt: true }, orderBy: { startsAt: 'desc' },
    }),
    b.status === 'no_show' ? undoableNoShow(b.id) : null,
  ]);
  const nameOfMember = (mid: string | null | undefined) => staffById.find(s => s.id === mid)?.displayName;
  const nameOfUser = (uid: string | null) => staffByUser.find(s => s.userId === uid)?.displayName;

  type LogRow = { at: Date; what: string };
  const log: LogRow[] = [{ at: b.createdAt, what: `התור נקבע ${SOURCE[b.source]}` }];
  for (const p of b.payments) {
    const label = p.purpose === 'deposit' ? 'מקדמה' : p.purpose === 'consult' ? 'תשלום ייעוץ' : 'תשלום';
    if (p.paidAt) {
      const doc = p.documents.find(x => x.type === 'tax_invoice_receipt');
      log.push({ at: p.paidAt, what: `${label}: נגבו ${nisFromAgorot(p.grossAgorot)}${doc ? ` · קבלה ${doc.number}` : ''}` });
    }
    for (const r of p.refunds) if (r.status !== 'failed') log.push({ at: r.createdAt, what: `${nisFromAgorot(r.amountAgorot)} הוחזרו לכרטיס · ${r.reason}` });
  }
  if (d) log.push({ at: d.signedAt, what: `הצהרת בריאות נחתמה דיגיטלית${d.flagged ? ' · יש ממצאים לעיון' : ''}` });
  const has = (action: string) => decisions.some(x => x.action === action);
  if (b.checkedInAt && !has('check_in')) log.push({ at: b.checkedInAt, what: DECISION_TEXT.check_in });
  if (b.startedAt && !has('start')) log.push({ at: b.startedAt, what: DECISION_TEXT.start });
  if (b.finishedAt && !has('finish')) log.push({ at: b.finishedAt, what: 'הטיפול הסתיים' });
  const cancellation = b.cancellation as { by?: string; at?: string; reason?: string; late?: boolean } | null;
  if (cancellation?.by === 'client' && cancellation.at) log.push({ at: new Date(cancellation.at), what: `המטופלת ביטלה את התור${cancellation.late ? ' · בתוך חלון הביטול' : ''}` });
  for (const x of decisions) {
    const base = DECISION_TEXT[x.action] ?? x.action;
    const who = nameOfUser(x.actorId);
    log.push({ at: x.createdAt, what: [base, x.action === 'cancel' ? x.reason : null, who].filter(Boolean).join(' · ') });
  }
  log.sort((p, q) => q.at.getTime() - p.at.getTime());

  // ---------- payment ----------
  const price = b.priceAgorot;
  const vat = price != null ? Math.round(price * VAT_RATE) : 0;
  const dep = [...b.payments].reverse().find(p => p.purpose === 'deposit') ?? null;
  const depositOn = b.depositAgorot > 0;
  const DEP_TEXT: Record<PaymentStatus, { t: string; tone: string }> = {
    pending: { t: 'ממתינה לתשלום', tone: 'warn' },
    succeeded: { t: `−${nisFromAgorot(dep?.grossAgorot ?? 0)}`, tone: 'ok' },
    applied: { t: `−${nisFromAgorot(dep?.grossAgorot ?? 0)}`, tone: 'ok' },
    failed: { t: 'התשלום נכשל', tone: 'bad' },
    refunded: { t: `${nisFromAgorot(dep?.grossAgorot ?? 0)} · הוחזרה`, tone: 'muted' },
    partially_refunded: { t: 'הוחזרה חלקית', tone: 'muted' },
    forfeited: { t: `${nisFromAgorot(dep?.grossAgorot ?? 0)} · נשמרה לפי המדיניות`, tone: 'warn' },
  };
  const depRow = !depositOn ? { t: 'אין', tone: 'muted' } : dep ? DEP_TEXT[dep.status] : { t: 'לא נגבתה', tone: 'warn' };
  const paidDeposit = dep && (dep.status === 'succeeded' || dep.status === 'applied') ? dep.grossAgorot : 0;
  const due = price != null ? price + vat - paidDeposit : null;
  const receipt = dep?.documents.find(x => x.type === 'tax_invoice_receipt') ?? null;
  const creditNotes = dep?.documents.filter(x => x.type === 'credit_note') ?? [];

  // ---------- action panel ----------
  const flaggedUnacked = hdState === 'flagged' && !d!.physicianAckAt;
  const ackName = d?.physicianAckById ? nameOfMember(d.physicianAckById) ?? 'רופא/ה' : null;
  const act: ActView = (() => {
    switch (b.status) {
      case 'pending_payment':
        return { kind: 'waiting', title: 'ממתין לתשלום מקדמה', body: `התור יאושר אחרי תשלום המקדמה${b.holdUntil ? `. המקום שמור עד ${hhmm(b.holdUntil)}` : ''}.`, canCancel: ctx.canManage };
      case 'abandoned':
        return { kind: 'cancelled', title: 'התור לא הושלם', body: 'המקדמה לא שולמה בזמן והמקום שוחרר.' };
      case 'confirmed': {
        const before = b.startsAt > now;
        return {
          kind: 'checkin', title: 'צ׳ק־אין', cta: 'המטופלת הגיעה',
          body: `סמנו כשהמטופלת הגיעה. היומן יתעדכן ותישלח התראה ל${prName}.`,
          blocked: !ctx.canManage, blockMsg: 'צ׳ק־אין שמור לצוות עם הרשאת ניהול תורים.',
          showNoShow: ctx.canManage, noShowHint: before ? `אפשר לסמן ״לא הגיעה״ אחרי ${hhmm(b.startsAt)}.` : undefined,
          canCancel: ctx.canManage,
        };
      }
      case 'checked_in': {
        const needDecl = b.requiresDeclaration && !valid;
        const doctorCanAck = flaggedUnacked && canAck(a, b);
        const blockMsg = !canStart(a, b) ? `תחילת הטיפול שמורה ל${prName} או לרופא/ה האחראי/ת.`
          : medical && a.profession !== 'doctor' && a.profession !== 'nurse' ? 'טיפול רפואי מתחיל רק על ידי רופא/ה או אח/ות.'
          : needDecl ? `אי אפשר להתחיל ${medical ? 'טיפול בהזרקה' : 'את הטיפול'} בלי הצהרת בריאות חתומה.`
          : flaggedUnacked && !doctorCanAck ? 'אישור ממצאים בהצהרה שמור לרופא/ה.'
          : '';
        return {
          kind: 'start', title: 'תחילת טיפול',
          body: hdState === 'flagged'
            ? d!.physicianAckAt ? `ממצאי ההצהרה אושרו על ידי ${ackName}.` : 'יש תשובות ״כן״ בהצהרה. לפני שמתחילים נדרש אישור רופא/ה שהממצאים נבדקו.'
            : hdState === 'signed' ? 'ההצהרה נחתמה ללא ממצאים.'
            : hdState === 'pending' ? 'ההצהרה עוד לא נחתמה.'
            : 'לא נדרשת הצהרת בריאות לטיפול הזה.',
          cta: doctorCanAck ? 'עברתי על ההצהרה · תחילת טיפול' : 'תחילת טיפול',
          blocked: !!blockMsg, blockMsg,
        };
      }
      case 'in_treatment': {
        const allowed = canFinish(a, b) && (!medical || a.profession === 'doctor' || a.profession === 'nurse');
        return {
          kind: 'finish', title: 'סיום טיפול', medical, cta: 'סיום ושליחת הנחיות',
          body: 'הרישום הקליני נשמר בתיק המטופלת. בסיום תישלח הודעה עם הנחיות אחרי הטיפול, וכעבור 3 ימים בקשה לכתוב ביקורת.',
          blocked: !allowed, blockMsg: allowed ? '' : `רישום קליני וסיום הטיפול שמורים ל${prName}.`,
        };
      }
      case 'completed':
        return { kind: 'done', title: 'הטיפול הסתיים', body: `הנחיות אחרי הטיפול נשלחו בוואטסאפ${b.finishedAt ? ` ב־${hhmm(b.finishedAt)}` : ''}. בעוד 3 ימים תישלח בקשת ביקורת.` };
      case 'no_show':
        return {
          kind: 'noshow', title: 'סומן: לא הגיעה',
          body: dep?.status === 'forfeited' ? `המקדמה ${nisFromAgorot(dep.grossAgorot)} נשמרת לפי מדיניות הביטול. אפשר לבטל את הסימון בתוך 24 שעות.` : 'אפשר לבטל את הסימון בתוך 24 שעות.',
          canUndo: ctx.canManage && !!undo,
        };
      default: {
        const byClinic = b.status === 'cancelled_clinic';
        const refunded = b.payments.flatMap(p => p.refunds).filter(r => r.status !== 'failed').reduce((n, r) => n + r.amountAgorot, 0);
        return {
          kind: 'cancelled', title: byClinic ? 'התור בוטל על ידי הקליניקה' : 'המטופלת ביטלה את התור',
          body: [cancellation?.reason ? `סיבה: ${cancellation.reason}.` : '', refunded ? `הוחזרו ${nisFromAgorot(refunded)} לכרטיס.` : cancellation?.late ? 'ביטול מאוחר: המקדמה נשמרה לפי המדיניות.' : ''].filter(Boolean).join(' '),
        };
      }
    }
  })();

  const stage = STAGE[b.status] ?? -1;
  const ended = b.status === 'no_show' || b.status.startsWith('cancelled') || b.status === 'abandoned';
  const endMin = ilParts(new Date(b.startsAt.getTime() + b.durationMin * 60_000));
  const endTime = `${String(endMin.hh).padStart(2, '0')}:${String(endMin.mm).padStart(2, '0')}`;
  const consents = (b.consents ?? {}) as { policyAcceptedAt?: string; marketingOptIn?: boolean };
  const lastVisit = visits[0]?.startsAt;
  const lv = lastVisit ? ilParts(lastVisit) : null;

  // ---------- declaration panel content ----------
  const hdHead = hdState === 'pending' ? { status: d && !valid && d.validUntil <= now ? 'פג תוקף · ממתינה לחתימה' : 'ממתינה לחתימה', tone: 'warn' }
    : hdState === 'flagged' ? {
        status: d!.physicianAckAt ? `יש ממצאים · אושר על ידי ${ackName}` : reader ? `${plAnswers(yesAnswers.length)} ״כן״ · לעיון הרופא/ה` : 'יש ממצאים · לעיון הרופא/ה',
        tone: d!.physicianAckAt ? 'ok' : 'warn',
      }
    : { status: 'נחתמה · ללא ממצאים', tone: 'ok' };
  const shown = sealed
    ? [...yesAnswers, ...sealed.answers.filter(x => !x.yes).slice(0, Math.max(0, 3 - yesAnswers.length))]
    : [];
  const restN = sealed ? sealed.answers.length - shown.length : 0;
  const qLabel = (key: string) => qs.find(q => q.key === key)?.short ?? key;

  return (
    <>
    <TopBar mode="pushed" title="כרטיס תור" backHref="/clinic" />
    <div className={styles.page}>
      <div className={styles.context}>
        <Link href="/clinic" className={`${styles.back} bf-desk-only`}>
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7H2M6 3 2 7l4 4" /></svg>
          לרשימת התורים
        </Link>
        <span className={styles.contextLine}>{b.branch.name} · {dayName(b.startsAt)} <span className="ltr tnum">{ddmm(b.startsAt)}</span></span>
      </div>

      <div className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <span className={styles.kicker}>
            <span className="ltr tnum">{b.ref} · {hhmm(b.startsAt)}–{endTime}</span>
            {b.room ? <> · חדר {b.room}</> : null}
          </span>
          <h1 className={styles.h1}>{b.clientName}</h1>
          <p className={styles.sub}>{b.treatment?.name ?? 'פגישת ייעוץ'}{pr ? ` · ${pr.displayName}` : ''}</p>
        </div>
        <div className={styles.contact}>
          <a href={waHref(b.clientPhone)} target="_blank" rel="noopener noreferrer" className={styles.wa}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z" /></svg>
            <span>וואטסאפ</span>
          </a>
          <a href={telHref(b.clientPhone)} className={styles.tel}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z" /></svg>
            <span>חיוג <span className={`${styles.telNum} ltr tnum`}>{fromE164(b.clientPhone)}</span></span>
          </a>
        </div>
      </div>

      <ol aria-label="מצב התור" className={styles.steps} data-ended={ended || undefined}>
        {STEPS.map((n, i) => {
          const done = !ended && (stage > i || stage === 3);
          const cur = !ended && stage === i && stage !== 3;
          return (
            <li key={n} aria-current={cur ? 'step' : undefined} data-cur={cur || undefined} data-done={done || undefined}>
              <span aria-hidden="true">{done ? '✓' : i + 1}</span>
              <span>{n}</span>
            </li>
          );
        })}
      </ol>

      <div className={styles.shell}>
        <div className={styles.main}>
          {hdState !== 'none' && (
            <section aria-labelledby="cb-hd" className={styles.hd} data-tone={hdHead.tone}>
              <div className={styles.hdHead}>
                <h2 id="cb-hd" className={styles.h2} style={{ flex: 1, margin: 0 }}>הצהרת בריאות</h2>
                <span className={styles.hdStatus}>{hdHead.status}</span>
              </div>

              {hdState === 'pending' ? (
                <div className={styles.hdPending}>
                  <p>המטופלת עוד לא חתמה. {medical ? 'בטיפול בהזרקה אי אפשר' : 'אי אפשר'} להתחיל בלי הצהרה חתומה.</p>
                  {ctx.canManage && ['pending_payment', 'confirmed', 'checked_in'].includes(b.status) && (
                    <div className={styles.row}>
                      <OpButton bookingId={b.id} op="resend" label="שליחת קישור שוב" done={`הקישור נשלח ל${b.clientName.split(' ')[0]} בוואטסאפ`} variant="small" />
                      <a href={`/b/${token}/declaration?kiosk=1`} target="_blank" rel="noopener" className={styles.smallSecondary}>מילוי בטאבלט בקבלה</a>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.hdBody}>
                  <p className={styles.meta}>
                    נחתמה <span className="ltr tnum">{ilDate(d!.signedAt)} {hhmm(d!.signedAt)}</span> · {reader ? 'גלוי לצוות המטפל בלבד' : NOT_VISIBLE}
                  </p>
                  {sealed ? (
                    <>
                      <ul className={styles.answers}>
                        {shown.map(x => (
                          <li key={x.key} data-yes={x.yes || undefined}>
                            <span className={styles.ansRow}><span className={styles.ansQ}>{qLabel(x.key)}</span><span className={styles.ansA}>{x.yes ? 'כן' : 'לא'}</span></span>
                            {x.yes && x.detail && <span className={styles.ansDetail}>{x.detail}</span>}
                          </li>
                        ))}
                      </ul>
                      {restN > 0 && <p className={styles.meta} style={{ margin: '10px 0 0' }}>{plRest(restN)}</p>}
                      <dl className={styles.hdDl}>
                        <dt>תרופות קבועות</dt><dd>{sealed.noMedications ? 'אין' : sealed.medications}</dd>
                        {sealed.birthDate && <><dt>תאריך לידה</dt><dd><span className="ltr tnum">{sealed.birthDate.split('-').reverse().join('/')}</span></dd></>}
                        {sealed.idLast4 && <><dt>ת״ז</dt><dd><span className="ltr tnum">•••••{sealed.idLast4}</span></dd></>}
                        <dt>חתימה</dt>
                        <dd>
                          <span className={styles.sigName}>{d!.signedName}{sealed.signatureMode === 'typed' ? ' · בהקלדת שם' : ''}</span>
                          {/* Plain <img>: a private, no-store image that next/image must not cache. */}
                          <img src={`/clinic/booking/${b.id}/signature`} alt={`חתימה: ${d!.signedName}`} className={styles.sigImg} loading="lazy" />
                        </dd>
                      </dl>
                    </>
                  ) : (
                    <p className={styles.meta} style={{ margin: 0 }}>התשובות גלויות למטפל/ת ולרופא/ה בלבד.</p>
                  )}

                  {hdState === 'flagged' && !d!.physicianAckAt && (
                    canAck(a, b) ? (
                      <div className={styles.row} style={{ marginTop: 12 }}>
                        <OpButton bookingId={b.id} op="ack" label="אישור: עברתי על הממצאים" done="אישור הממצאים נרשם" variant="small" />
                      </div>
                    ) : (
                      <p className={styles.reserved}>אישור הממצאים שמור לרופא/ה</p>
                    )
                  )}
                  {hdState === 'flagged' && d!.physicianAckAt && (
                    <p className={styles.meta} style={{ margin: '10px 0 0' }}>
                      אושר על ידי {ackName} · <span className="ltr tnum">{ddmmHhmm(d!.physicianAckAt)}</span>
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <ActionPanel bookingId={b.id} act={act} clientFirst={b.clientName.split(' ')[0]}>
            {b.status === 'completed' && (
              <div className={styles.clinical}>
                <h3 className={styles.h3}>רישום קליני</h3>
                {clinical ? (
                  <dl className={styles.hdDl} style={{ marginTop: 0 }}>
                    {clinical.productBatch && <><dt>חומר ואצווה</dt><dd><span className={styles.isolate}>{clinical.productBatch}</span></dd></>}
                    {clinical.units != null && <><dt>יחידות</dt><dd><span className="ltr tnum">{clinical.units}</span></dd></>}
                    <dt>רישום</dt><dd className={styles.pre}>{clinical.notes}</dd>
                    <dt>נרשם על ידי</dt><dd>{nameOfMember(clinical.recordedBy) ?? prName}</dd>
                  </dl>
                ) : (
                  <p className={styles.meta} style={{ margin: 0 }}>הרישום הקליני {NOT_VISIBLE}.</p>
                )}
                <a href={`/b/${token}/aftercare`} target="_blank" rel="noopener" className={styles.textLink}>ההנחיות שנשלחו למטופלת</a>
              </div>
            )}
          </ActionPanel>

          <section aria-labelledby="cb-log" className={styles.card}>
            <h2 id="cb-log" className={styles.h2} style={{ marginBottom: 10 }}>יומן פעולות</h2>
            <ol className={styles.log}>
              {log.map((l, i) => (
                <li key={i}><span className="ltr tnum">{ddmmHhmm(l.at)}</span><span>{l.what}</span></li>
              ))}
            </ol>
          </section>
        </div>

        <aside className={styles.side}>
          <div className={styles.card} style={{ padding: '14px 16px' }}>
            <h2 className={styles.h2sm}>תשלום</h2>
            <dl className={styles.pay}>
              {price != null && <><dt>מחיר הטיפול</dt><dd><span className="ltr">{nisFromAgorot(price)}</span></dd></>}
              <dt>{depositOn && dep?.status === 'succeeded' ? 'מקדמה ששולמה' : 'מקדמה'}</dt>
              <dd data-tone={depRow.tone}><span className={styles.isolate}>{depRow.t}</span></dd>
              {price != null && <><dt>מע״מ <span className="ltr">{Math.round(VAT_RATE * 100)}%</span></dt><dd className={styles.w600}><span className="ltr">{nisFromAgorot(vat)}</span></dd></>}
              {due != null && <><dt className={styles.total}>יתרה לתשלום</dt><dd className={styles.total}><span className="ltr">{nisFromAgorot(Math.max(0, due))}</span></dd></>}
            </dl>
            {dep?.refunds.filter(r => r.status !== 'failed').map(r => (
              <p key={r.id} className={styles.meta} style={{ margin: '8px 0 0' }}>
                זיכוי <span className="ltr">{nisFromAgorot(r.amountAgorot)}</span> · {r.status === 'received' ? 'התקבל בכרטיס' : 'בדרך לכרטיס'}
                {r.expectedBy && r.status !== 'received' ? <> עד <span className="ltr tnum">{ilDate(r.expectedBy)}</span></> : null}
              </p>
            ))}
            {receipt && (receipt.pdfUrl
              ? <a href={receipt.pdfUrl} target="_blank" rel="noopener noreferrer" className={styles.textLink}>קבלה וחשבונית מס <span className="ltr">{receipt.number}</span></a>
              : <p className={styles.meta} style={{ margin: '8px 0 0' }}>חשבונית מס/קבלה <span className="ltr">{receipt.number}</span></p>)}
            {creditNotes.map(cn => (
              <p key={cn.id} className={styles.meta} style={{ margin: '4px 0 0' }}>חשבונית זיכוי <span className="ltr">{cn.number}</span></p>
            ))}
          </div>
          <div className={styles.card} style={{ padding: '14px 16px' }}>
            <h2 className={styles.h2sm}>המטופלת</h2>
            <dl className={styles.client}>
              <dt>ביקורים</dt>
              <dd>{visits.length === 0 ? 'ביקור ראשון' : <><span className="ltr">{visits.length}</span> · אחרון ב־<span className="ltr tnum">{String(lv!.m).padStart(2, '0')}/{lv!.y}</span></>}</dd>
              <dt>הסכמות</dt>
              <dd>מדיניות ביטול {consents.policyAcceptedAt ? '✓' : '✗'} · וואטסאפ שיווקי {consents.marketingOptIn ? '✓' : '✗'}</dd>
              {b.notes && <><dt>הערה</dt><dd>{b.notes}</dd></>}
              {pr && <><dt>{roleOfProfession(pr.profession)}</dt><dd>{pr.displayName}</dd></>}
            </dl>
          </div>
        </aside>
      </div>
    </div>
    </>
  );
}
