import 'server-only';
import type { Prisma } from '@prisma/client';
import { OPS_ROLE_NAMES } from '@/components/ops/roles';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { fromE164 } from '@/lib/format';
import { db } from '@/lib/server/db';
import type { Kind, LogEntry, QueueItem, Row, Seg, Status, Tone } from './shared';

// Loads the verification queue and turns each request into the console's view model.
// All time-dependent text (SLA, relative "when") is computed here, in Asia/Jerusalem.

const DECIDED_SHOWN = 40;
const HOUR = 3_600_000;
const URGENT_HOURS = 4;
const TZ = 'Asia/Jerusalem';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const txt = (t: string): Seg[] => [{ t }];
const ltr = (t: string): Seg[] => [{ t, ltr: true }];
const phone = (e164: unknown) => (str(e164) ? ltr(fromE164(str(e164)!)) : null);

// ---------- Time ----------

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function local(d: Date) {
  const p = Object.fromEntries(PARTS.formatToParts(d).map(x => [x.type, x.value]));
  const day = Date.UTC(+p.year, +p.month - 1, +p.day) / 86_400_000;
  return { y: p.year, mo: p.month, d: p.day, hh: p.hour, mm: p.minute, day };
}

const WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];

/** היום 08:12 · אתמול 17:40 · יום ב׳ · 14/09 */
function relWhen(d: Date, now: Date): Seg[] {
  const a = local(d);
  const diff = local(now).day - a.day;
  if (diff <= 0) return [{ t: 'היום ' }, { t: `${a.hh}:${a.mm}`, ltr: true }];
  if (diff === 1) return [{ t: 'אתמול ' }, { t: `${a.hh}:${a.mm}`, ltr: true }];
  if (diff < 7) return txt(WEEKDAYS[new Date(a.day * 86_400_000).getUTCDay()]);
  return ltr(`${a.d}/${a.mo}`);
}

/** 23/09/2026 10:02 */
function stamp(d: Date) {
  const a = local(d);
  return `${a.d}/${a.mo}/${a.y} ${a.hh}:${a.mm}`;
}

function sla(status: Status, due: Date | null, when: Seg[], now: Date): { sla: Seg[]; urgent: boolean } {
  if (status === 'awaiting_document') return { sla: txt('ממתין למסמך'), urgent: false };
  if (status !== 'open') return { sla: when, urgent: false };
  if (!due) return { sla: txt('SLA · ללא יעד'), urgent: false };
  const left = due.getTime() - now.getTime();
  if (left <= 0) {
    const late = Math.max(1, Math.floor(-left / HOUR));
    return { sla: [{ t: 'SLA · באיחור ' }, { t: String(late), ltr: true }, { t: ' ש׳' }], urgent: true };
  }
  const h = Math.ceil(left / HOUR);
  return { sla: [{ t: 'SLA · ' }, { t: String(h), ltr: true }, { t: ' ש׳' }], urgent: h <= URGENT_HOURS };
}

// ---------- Labels ----------

const BIZ_TYPE: Record<string, string> = { clinic: 'קליניקה רפואית', medspa: 'מדספא', cosmetics: 'קוסמטיקה', salon: 'עסק יופי' };
const BIZ_STATUS: Record<string, [string, Tone]> = {
  pending: ['ממתין לאישור', 'todo'], live: ['באוויר', 'ok'], past_due: ['חוב פתוח', 'warn'], hidden: ['מוסתר', 'warn'],
};
const BRANCH_STATUS: Record<string, string> = { draft: 'טיוטה', live: 'באוויר', unpublished: 'לא מפורסם' };
const LICENSE_STATUS: Record<string, [string, Tone]> = {
  pending: ['ממתין לאימות', 'warn'], verified: ['מאומת', 'ok'], rejected: ['נדחה', 'bad'], expired: ['פג תוקף', 'bad'],
};
const REQ_STATUS: Record<Status, string> = { open: 'ממתין', awaiting_document: 'ממתין למסמך', approved: 'אושר', rejected: 'נדחה' };
const PLAN_NAME: Record<string, string> = { basic: 'רישום בסיסי', advanced: 'רישום מתקדם + CRM' };
const CLAIM_METHOD: Record<string, string> = { sms: 'קוד ב־SMS למספר הרשום', call: 'שיחה קולית למספר הרשום', mail: 'קוד לדואר האלקטרוני הרשום' };
const ACTION_NAME: Record<string, string> = {
  approve: 'אושר', reject: 'נדחה', request_document: 'נשלחה בקשה למסמך', reopen: 'הוחזר לתור',
};
const SHORT_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

const catNames = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter((c): c is string => typeof c === 'string').map(c => categoryBySlug(c)?.name ?? c).join(', ');

const plural = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${n} ${many}`);

/** א׳–ד׳ 09:00–19:00, ה׳ 09:00–20:00, שבת סגור */
function hoursSummary(v: unknown): Seg[] | null {
  if (!Array.isArray(v) || v.length !== 7) return null;
  const days = v.map(obj).map(h => (h.closed === true || !str(h.open) ? 'סגור' : `${str(h.open)}–${str(h.close) ?? ''}`));
  const out: Seg[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && days[j + 1] === days[i]) j++;
    if (out.length) out.push({ t: ', ' });
    out.push({ t: (j > i ? `${SHORT_DAYS[i]}–${SHORT_DAYS[j]}` : SHORT_DAYS[i]) + ' ' });
    out.push(days[i] === 'סגור' ? { t: 'סגור' } : { t: days[i], ltr: true });
    i = j + 1;
  }
  return out;
}

function push(rows: Row[], k: string, v: Seg[] | string | null | undefined, extra?: Partial<Row>) {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return;
  rows.push({ k, v: typeof v === 'string' ? txt(v) : v, ...extra });
}

// ---------- Loading ----------

const include = { submittedBy: { select: { fullName: true, email: true } } } satisfies Prisma.VerificationRequestInclude;
type Req = Prisma.VerificationRequestGetPayload<{ include: typeof include }>;

export async function loadQueue(now = new Date()): Promise<QueueItem[]> {
  const [active, decided] = await Promise.all([
    db.verificationRequest.findMany({ where: { status: { in: ['open', 'awaiting_document'] } }, include }),
    db.verificationRequest.findMany({
      where: { status: { in: ['approved', 'rejected'] } }, include, orderBy: { updatedAt: 'desc' }, take: DECIDED_SHOWN,
    }),
  ]);
  const reqs: Req[] = [...active, ...decided];
  if (!reqs.length) return [];

  const ids = reqs.map(r => r.id);
  const businessIds = [...new Set(reqs.map(r => r.businessId).filter((x): x is string => !!x))];
  const branchIds = [...new Set(reqs.map(r => r.branchId).filter((x): x is string => !!x))];
  const licenseIds = [...new Set(reqs.map(r => str(obj(r.submitted).licenseId)).filter((x): x is string => !!x && UUID_RE.test(x)))];
  const docIds = [...new Set(reqs.map(r => str(obj(r.submitted).document)).filter((x): x is string => !!x && UUID_RE.test(x)))];

  const [businesses, branches, licenses, docs, decisions, related] = await Promise.all([
    db.business.findMany({ where: { id: { in: businessIds } }, include: { owner: { select: { id: true, fullName: true, email: true } } } }),
    db.branch.findMany({
      where: { id: { in: branchIds } },
      include: { medicalResponsible: { include: { license: true } } },
    }),
    db.license.findMany({ where: { id: { in: licenseIds } } }),
    db.mediaFile.findMany({ where: { id: { in: docIds }, isPrivate: true } }),
    db.decision.findMany({ where: { subjectType: 'verification_request', subjectId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
    db.verificationRequest.findMany({
      where: { businessId: { in: businessIds } },
      select: { id: true, ref: true, kind: true, status: true, businessId: true, branchId: true, submittedById: true },
    }),
  ]);
  const actorIds = [...new Set(decisions.map(d => d.actorId).filter((x): x is string => !!x))];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } });

  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  const bizMap = byId(businesses), branchMap = byId(branches), licMap = byId(licenses), docMap = byId(docs), actorMap = byId(actors);

  const items = reqs.map(r => {
    const sub = obj(r.submitted);
    const business = r.businessId ? bizMap.get(r.businessId) ?? null : null;
    const branch = r.branchId ? branchMap.get(r.branchId) ?? null : null;
    const license = str(sub.licenseId) ? licMap.get(str(sub.licenseId)!) ?? null : null;
    const kind = r.kind as Kind;
    const status = r.status as Status;
    const submitter = r.submittedBy?.fullName ?? r.submittedBy?.email ?? 'לא ידוע';
    const isOwner = !!business?.ownerUserId && business.ownerUserId === r.submittedById;

    // --- Headline ---
    let what: string, who: string, biz: string;
    const branchLabel = branch ? `${branch.name} · ${branch.cityName}` : '';
    if (kind === 'license') {
      what = license?.kind === 'nurse' ? 'רישיון אחות' : 'רישיון רופא';
      who = str(sub.doctorName) ?? str(sub.name) ?? license?.nameOnRecord ?? 'ללא שם';
      biz = branchLabel;
    } else if (kind === 'cert') {
      what = 'תעודת קוסמטיקה';
      who = str(sub.name) ?? license?.nameOnRecord ?? 'ללא שם';
      biz = branchLabel;
    } else if (kind === 'claim') {
      const b = obj(sub.branch);
      what = 'בקשת בעלות';
      who = submitter;
      biz = str(b.name) ? `${str(b.name)} · ${str(b.cityName) ?? ''}` : branchLabel;
    } else {
      const b = obj(sub.business), br = obj(sub.branch);
      what = 'רישום עסק חדש';
      who = str(b.name) ?? branch?.name ?? 'עסק ללא שם';
      biz = [BIZ_TYPE[str(b.type) ?? ''] ?? null, str(br.city) ?? branch?.cityName ?? null].filter(Boolean).join(' · ');
    }

    // --- What was submitted ---
    const submitted: Row[] = [];
    const byLine = [{ t: submitter }, ...(isOwner ? [{ t: ' (בעלים)' }] : [])];
    if (kind === 'license') {
      push(submitted, 'מספר', str(sub.licenseNumber) ? ltr(str(sub.licenseNumber)!) : null);
      push(submitted, 'שם', who);
      push(submitted, 'מומחיות', str(sub.specialty));
      push(submitted, 'תפקיד', license?.kind === 'nurse' ? 'אח/ות מוסמך/ת' : 'רופא/ה · אחריות רפואית');
      push(submitted, 'נוכחות', str(sub.presence));
      push(submitted, 'הוגש ע״י', byLine);
    } else if (kind === 'cert') {
      push(submitted, 'שם', who);
      push(submitted, 'תעודה', str(sub.certificate) ?? license?.number ?? null);
      push(submitted, 'ניסיון', str(sub.years) ? [{ t: str(sub.years)!, ltr: true }, { t: ' שנים' }] : null);
      push(submitted, 'תפקיד', 'קוסמטיקאי/ת · איש מקצוע אחראי');
      push(submitted, 'הוגש ע״י', byLine);
    } else if (kind === 'claim') {
      const d = obj(sub.details), v = obj(sub.verification);
      push(submitted, 'מבקש/ת', [{ t: submitter }, ...(r.submittedBy?.email && r.submittedBy.fullName ? [{ t: ' · ' }, { t: r.submittedBy.email, ltr: true }] : [])]);
      push(submitted, 'שיטה', CLAIM_METHOD[str(v.method) ?? ''] ?? str(v.method));
      push(submitted, 'יעד הקוד', str(v.target) ? ltr(str(v.target)!) : null);
      push(submitted, 'קוד אומת', str(v.verifiedAt) ? relWhen(new Date(str(v.verifiedAt)!), now) : null);
      push(submitted, 'שם העסק', str(d.name));
      push(submitted, 'כתובת', str(d.address));
      push(submitted, 'טלפון', phone(d.phone));
      push(submitted, 'וואטסאפ', phone(d.whatsapp));
      push(submitted, 'קטגוריות', catNames(d.categories));
      push(submitted, 'אחראי רפואי', str(d.medicalResponsible));
      push(submitted, 'שעות', hoursSummary(d.hours));
    } else {
      const b = obj(sub.business), br = obj(sub.branch), resp = obj(sub.responsibility);
      const services = Array.isArray(sub.services) ? sub.services.map(obj) : [];
      const decl = Array.isArray(obj(sub.declarations).accepted) ? (obj(sub.declarations).accepted as unknown[]).length : 0;
      push(submitted, 'שם העסק', str(b.name));
      push(submitted, 'שם משפטי', str(b.legalName));
      push(submitted, 'ח.פ. / ע.מ.', str(b.companyNo) ? ltr(str(b.companyNo)!) : null);
      push(submitted, 'סוג', BIZ_TYPE[str(b.type) ?? ''] ?? null);
      push(submitted, 'כתובת', [str(br.address), str(br.city)].filter(Boolean).join(', '));
      push(submitted, 'אזור', regionBySlug(str(br.region) ?? '')?.name ?? null);
      push(submitted, 'טלפון', phone(br.phone));
      push(submitted, 'וואטסאפ', phone(br.whatsapp));
      push(submitted, 'אימייל', str(br.email) ? ltr(str(br.email)!) : null);
      push(submitted, 'קטגוריות', catNames(sub.categories));
      if (resp.kind === 'medical') {
        push(submitted, 'אחריות רפואית', [
          { t: str(resp.doctorName) ?? '' },
          ...(str(resp.licenseNumber) ? [{ t: ' · רישיון ' }, { t: str(resp.licenseNumber)!, ltr: true }] : []),
        ]);
      } else if (resp.kind === 'professional') {
        push(submitted, 'איש מקצוע', [str(resp.name), str(resp.certificate)].filter(Boolean).join(' · '));
      }
      if (services.length) {
        push(submitted, 'טיפולים', `${plural(services.length, 'טיפול אחד', 'שני טיפולים', 'טיפולים')}: ${services.map(s => str(s.name)).filter(Boolean).join(', ')}`);
      }
      push(submitted, 'שעות', hoursSummary(sub.hours));
      push(submitted, 'מסלול', PLAN_NAME[str(sub.plan) ?? ''] ?? null);
      push(submitted, 'הצהרות', decl ? plural(decl, 'הצהרה אחת אושרה', 'שתי הצהרות אושרו', 'הצהרות אושרו') : null);
    }

    // --- Business / branch as it is now ---
    const context: Row[] = [];
    const flags: QueueItem['flags'] = [];
    if (branch && kind !== 'business') push(context, 'כרטיס', branchLabel);
    if (business) {
      const [bs, bt] = BIZ_STATUS[business.status] ?? [business.status, 'todo' as Tone];
      push(context, 'סטטוס העסק', bs, { tone: bt });
      const owner = business.owner;
      const ownerIsOther = !!owner && owner.id !== r.submittedById;
      push(
        context,
        'בעלים',
        owner ? [{ t: owner.fullName ?? '' }, ...(owner.email ? [{ t: owner.fullName ? ' · ' : '' }, { t: owner.email, ltr: true }] : [])] : 'אין בעלים מאומת/ת',
        kind === 'claim' && ownerIsOther && isActive(status) ? { tone: 'bad' } : undefined,
      );
      if (kind === 'claim' && ownerIsOther && isActive(status)) flags.push({ tone: 'bad', text: 'לעסק כבר יש בעלים' });
    }
    if (branch) {
      const claimedByOther = branch.isClaimed && business?.ownerUserId !== r.submittedById;
      push(context, 'סטטוס הסניף', `${BRANCH_STATUS[branch.status] ?? branch.status} · ${branch.isClaimed ? 'בבעלות מאומתת' : 'ללא בעלות מאומתת'}`, kind === 'claim' && claimedByOther && isActive(status) ? { tone: 'bad' } : undefined);
      const mr = branch.medicalResponsible;
      if (mr) {
        const [ls, lt] = mr.license ? LICENSE_STATUS[mr.license.status] ?? [mr.license.status, 'todo' as Tone] : ['ללא רישיון', 'bad' as Tone];
        push(context, 'אחראי רפואי', `${mr.displayName} · ${ls}`, { tone: lt });
      }
    }
    for (const o of related) {
      if (o.id === r.id || o.businessId !== r.businessId) continue;
      if (kind === 'claim' && o.kind === 'claim' && o.branchId === r.branchId && o.submittedById !== r.submittedById && isActive(o.status as Status)) {
        push(context, 'בקשה נוספת', [{ t: o.ref, ltr: true }, { t: ` · ${REQ_STATUS[o.status as Status]}` }], { tone: 'warn', selectId: o.id });
        if (isActive(status) && !flags.some(f => f.text === 'בקשה נוספת על העסק')) flags.push({ tone: 'warn', text: 'בקשה נוספת על העסק' });
      } else if (kind !== 'claim' && o.kind !== 'claim') {
        push(context, 'בקשה קשורה', [{ t: o.ref, ltr: true }, { t: ` · ${REQ_STATUS[o.status as Status]}` }], { selectId: o.id });
      }
    }

    // --- Registry comparison ---
    // TODO(registry): no Ministry of Health / company registry / Google Business integration yet.
    // When one exists, fill sourceLookup and render its rows with ok/warn/bad tones instead.
    const registry =
      kind === 'license' ? (license?.kind === 'nurse' ? 'פנקס האחיות · משרד הבריאות' : 'פנקס הרופאים · משרד הבריאות')
      : kind === 'cert' ? 'אין מאגר ציבורי, בדיקה מול המסמך'
      : kind === 'claim' ? 'רשם החברות ו־Google Business'
      : 'רשם החברות';
    const toCheck =
      kind === 'license' ? 'מספר, שם וסטטוס הרישיון'
      : kind === 'cert' ? 'שם, מוסד, חותמת וחתימה'
      : kind === 'claim' ? 'בעלות רשומה ומי מנהל את הכרטיס ב־Google'
      : 'ח.פ. / ע.מ., שם רשום וכתובת';
    const source = {
      name: 'בדיקה ידנית: אין חיבור אוטומטי למאגר',
      rows: [
        { k: 'מאגר', v: txt(registry) },
        { k: 'לבדוק', v: txt(toCheck) },
        { k: 'תוצאה', v: txt('טרם נבדק'), tone: 'todo' as Tone },
      ],
    };

    // --- Checks and flags ---
    const checks = (Array.isArray(r.checks) ? r.checks : []).map(obj).map(c => {
      const tone: Tone = c.result === 'ok' || c.result === 'warn' || c.result === 'bad' ? c.result : 'todo';
      return { tone, text: str(c.text) ?? '' };
    });
    if (isActive(status)) {
      for (const c of [...checks.filter(c => c.tone === 'bad'), ...checks.filter(c => c.tone === 'warn')]) {
        flags.push({ tone: c.tone as 'warn' | 'bad', text: c.text });
      }
    }
    flags.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));

    // --- Document ---
    const docRow = str(sub.document) ? docMap.get(str(sub.document)!) : undefined;
    const doc = docRow ? { url: `/ops/media/${docRow.id}`, isImage: docRow.mime.startsWith('image/'), label: `סריקת ${what}` } : null;

    // --- Decision log (newest first) ---
    const mine = decisions.filter(d => d.subjectId === r.id);
    const actorName = (id: string | null) => {
      if (!id) return 'BeautyFind';
      const a = actorMap.get(id);
      return a?.fullName ?? a?.email ?? 'משתמש שנמחק';
    };
    const log: LogEntry[] = mine.map(d => ({
      id: d.id,
      action: ACTION_NAME[d.action] ?? d.action,
      actor: actorName(d.actorId),
      role: OPS_ROLE_NAMES[d.actorRole] ?? d.actorRole,
      at: ltr(stamp(d.createdAt)),
      reason: d.reason,
    }));

    // --- Outcome line ---
    const outcomeAction = status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : status === 'awaiting_document' ? 'request_document' : null;
    const last = outcomeAction ? mine.find(d => d.action === outcomeAction) : undefined;
    let outcome: Seg[] | null = null;
    if (last) {
      const by = last.actorId ? `ע״י ${actorName(last.actorId)}` : 'אוטומטית';
      const at = { t: stamp(last.createdAt), ltr: true };
      const reason = (last.reason ?? '').replace(/[.\s]+$/, '');
      if (outcomeAction === 'approve') {
        const tail =
          kind === 'license' ? (license?.kind === 'nurse' ? 'בדיקה חוזרת אוטומטית כל 90 יום.' : 'השם יופיע בפרופיל כאחריות רפואית. בדיקה חוזרת אוטומטית כל 90 יום.')
          : kind === 'cert' ? 'ההסמכה תוצג בעמוד איש המקצוע.'
          : kind === 'claim' ? 'הבעלות הועברה והפרטים שהוגשו עודכנו בכרטיס.'
          : 'העסק והסניפים שלו עלו לאוויר.';
        outcome = [{ t: `אושר ${by} · ` }, at, { t: `. ${tail}` }];
      } else if (outcomeAction === 'reject') {
        const tail = !last.actorId && kind === 'claim' ? 'בקשת בעלות אחרת על העסק אושרה.' : 'העסק קיבל הסבר ואפשרות להגיש מחדש.';
        outcome = [{ t: `נדחה ${by} · ` }, at, { t: `${reason ? `: ${reason}` : ''}. ${tail}` }];
      } else {
        outcome = [{ t: `נשלחה בקשה למסמך נוסף ${by} · ` }, at, { t: `: ${reason}. שעון ה־SLA מושהה עד לקבלת תשובה.` }];
      }
    }

    const when = relWhen(r.createdAt, now);
    const s = sla(status, r.slaDueAt, when, now);
    const item: QueueItem = {
      id: r.id, ref: r.ref, kind, status, what, who, biz, when,
      sla: s.sla, slaUrgent: s.urgent, flags,
      submitted, context, source, doc, checks, outcome, log,
    };
    return { item, due: r.slaDueAt?.getTime() ?? Infinity, created: r.createdAt.getTime(), updated: r.updatedAt.getTime() };
  });

  // Most urgent first: open by SLA, then paused (awaiting a document), then recent decisions.
  const rank = (s: Status) => (s === 'open' ? 0 : s === 'awaiting_document' ? 1 : 2);
  items.sort((a, b) => {
    const d = rank(a.item.status) - rank(b.item.status);
    if (d) return d;
    if (a.item.status === 'open') return a.due - b.due || a.created - b.created;
    if (a.item.status === 'awaiting_document') return a.created - b.created;
    return b.updated - a.updated;
  });
  return items.map(x => x.item);
}

function isActive(s: Status) {
  return s === 'open' || s === 'awaiting_document';
}

/** The open license/cert request that blocks a business approval, for the error message. */
export async function pendingLicenseRef(requestId: string): Promise<string | undefined> {
  const req = await db.verificationRequest.findUnique({ where: { id: requestId }, select: { businessId: true } });
  if (!req?.businessId) return undefined;
  const lic = await db.verificationRequest.findFirst({
    where: { businessId: req.businessId, kind: { in: ['license', 'cert'] }, status: { in: ['open', 'awaiting_document'] } },
    select: { ref: true },
  });
  return lic?.ref;
}
