import 'server-only';
import { Prisma } from '@prisma/client';
import { unsubscribeUrl } from '@/components/unsubscribe/token';
import { profileHref } from '../category';
import { db } from './db';
import { enqueue } from './scheduler';
import { siteUrl } from './site';

// The welcome SMS to unclaimed businesses (M_claim_welcome): one per business, to its mobile, with a short link
// to its profile (/c/<code>) and a short opt-out link (/u/<code>). Rides the claim_invite automation, so it
// shares its switch, its "never invite twice" key (CLAIM:<businessId>), its guard (skip once claimed), the
// marketing send window (no nights, Shabbat or holidays) and the opt-out check. The sender is alphanumeric and
// cannot receive replies, so opting out is by link, never by reply.

/** First 8 hex characters of the branch id: unique across the directory and short enough for an SMS. */
export const shortCode = (branchId: string) => branchId.replace(/-/g, '').slice(0, 8).toLowerCase();

const isMobile = (p: string | null | undefined): p is string => !!p && /^\+9725\d{8}$/.test(p);

/** The mobile a branch is reached on: WhatsApp when it is a mobile, else the phone when it is one. */
export const branchMobile = (b: { whatsapp: string | null; phone: string | null }) => (isMobile(b.whatsapp) ? b.whatsapp : isMobile(b.phone) ? b.phone : null);

/** The branch behind a short code, or null. */
export async function branchByCode(code: string) {
  if (!/^[0-9a-f]{8}$/.test(code)) return null;
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id::text AS id FROM branches WHERE replace(id::text, '-', '') LIKE ${code + '%'} LIMIT 2`);
  if (rows.length !== 1) return null;
  return db.branch.findUnique({ where: { id: rows[0].id }, select: { id: true, slug: true, regionSlug: true, status: true, phone: true, whatsapp: true, categories: { select: { categorySlug: true, isPrimary: true } } } });
}

/** How the category reads in "בעמוד ___ ב<city>". */
const CATEGORY_PAGE: Record<string, string> = {
  'facials': 'הקוסמטיקה', 'hair-salons': 'המספרות', 'dental-aesthetics': 'האסתטיקה הדנטלית', 'nails': 'הציפורניים',
  'brows-lashes': 'הגבות והריסים', 'plastic-surgery': 'הכירורגיה הפלסטית', 'medical-aesthetics': 'האסתטיקה הרפואית',
  'hair-restoration': 'השתלות השיער', 'makeup': 'האיפור', 'hair-removal': 'הסרת השיער', 'spa-massage': 'הספא והעיסויים',
  'permanent-makeup': 'האיפור הקבוע', 'tanning': 'השיזוף', 'body-contouring': 'עיצוב הגוף',
};

export interface WelcomeCandidate { businessId: string; branchId: string; name: string; mobile: string; category: string; city: string; code: string }

/** Unclaimed businesses with a live branch reachable on a mobile, never invited (by email or SMS) before. */
export async function welcomeCandidates(limit: number): Promise<{ rows: WelcomeCandidate[]; total: number }> {
  const [invited, list] = await Promise.all([
    db.scheduledMessage.findMany({ where: { automation: 'claim_invite' }, select: { businessId: true } }),
    db.business.findMany({
      where: { ownerUserId: null, branches: { some: { status: 'live', OR: [{ phone: { startsWith: '+9725' } }, { whatsapp: { startsWith: '+9725' } }] } } },
      select: { id: true, branches: { where: { status: 'live' }, select: { id: true, name: true, phone: true, whatsapp: true, cityName: true, slug: true, regionSlug: true, categories: { select: { categorySlug: true, isPrimary: true } } }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' }, take: 5000,
    }),
  ]);
  const skip = new Set(invited.map(d => d.businessId));
  const seenPhones = new Set<string>();
  const all: WelcomeCandidate[] = [];
  for (const b of list) {
    if (skip.has(b.id)) continue;
    const br = b.branches.find(x => branchMobile(x));
    const mobile = br ? branchMobile(br) : null;
    if (!br || !mobile || seenPhones.has(mobile)) continue;
    seenPhones.add(mobile);
    const cat = profileHref(br).split('/')[2];
    all.push({ businessId: b.id, branchId: br.id, name: br.name, mobile, category: CATEGORY_PAGE[cat] ?? '', city: br.cityName, code: shortCode(br.id) });
  }
  return { rows: all.slice(0, limit), total: all.length };
}

/** Queues up to `count` welcome SMS. Dry run returns the candidates and sample texts without queuing. */
export async function queueWelcomeSms(count: number, actorId: string, dryRun: boolean) {
  const { rows, total } = await welcomeCandidates(count);
  const site = siteUrl().replace(/\/+$/, '');
  const build = (c: WelcomeCandidate) => ({
    category: c.category, city: c.city,
    link: `${site}/c/${c.code}`,
    unsub_sms: `${site.replace(/^https?:\/\//, '')}/u/${c.code}`,
    unsub_full: unsubscribeUrl({ contact: c.mobile, scope: 'all', channel: 'sms' }),
  });
  if (dryRun) return { ok: true as const, dryRun: true, eligible: total, wouldQueue: rows.length, sample: rows.slice(0, 3).map(c => ({ name: c.name, vars: build(c) })) };
  let queued = 0;
  for (const c of rows) {
    const ok = await enqueue({
      key: `CLAIM:${c.businessId}`, automation: 'claim_invite', template: 'M_claim_welcome', channel: 'sms', to: c.mobile, fallbackPhone: null,
      kind: 'marketing', scope: 'all', vars: { business: c.name, ...build(c) },
      businessId: c.businessId, refId: c.branchId, dueAt: new Date(), staleAt: new Date(Date.now() + 14 * 86_400_000), createdById: actorId,
    });
    if (ok) queued++;
  }
  if (queued) await db.auditLog.create({ data: { actorId, action: 'claim_invites_queued', subjectType: 'automation', subjectId: actorId, meta: { count: queued, ref: 'welcome_sms' } } });
  return { ok: true as const, dryRun: false, eligible: total, queued };
}
