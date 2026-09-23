import 'server-only';
import type { BookingStatus, ReviewStatus, User } from '@prisma/client';
import { BOOKING_LIVE } from '@/lib/features';
import { fromE164, nisFromAgorot } from '@/lib/format';
import { bookingToken, hoursUntil, refundWindowHours } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { profileHref } from '@/lib/server/public';
import { hhmm, ilDate, ilParts } from '@/lib/time';
import { DAY_NAMES, waHref } from '@/components/profile/format';
import { savedCardsOf } from '@/components/saved/data';
import type { SavedCard } from '@/components/saved/types';
import type { Channel } from '@/components/unsubscribe/token';

/** "אחוזה 128, רעננה"; skips the city when the address already names it. */
const joinAddress = (address: string, city: string) => (city && !address.includes(city) ? [address, city].filter(Boolean).join(', ') : address);

// Everything /account shows, as plain serializable view models. Only the signed-in client's own rows.

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface ApptView {
  id: string;
  ref: string;
  svc: string;
  staff: string | null;
  clinic: string;
  address: string;
  dom: string;
  mon: string;
  weekday: string;
  date: string; // DD/MM/YYYY
  time: string; // HH:MM
  price: string | null; // ₪380, before VAT
  notes: Array<{ pre: string; ltr?: string; post?: string }>; // "מקדמה ₪150 שולמה", "חשבונית 40211"
  state: string;
  tone: Tone;
  upcoming: boolean;
  canChange: boolean; // only a confirmed booking can still be moved or cancelled by the client
  notice: string | null;
  manageHref: string;
  receiptHref: string | null;
  reviewHref: string | null;
  rebookHref: string;
  rebookLabel: string;
  wazeHref: string | null;
  waHref: string | null;
}

export interface ReviewView {
  id: string;
  clinic: string;
  rating: number;
  svc: string | null;
  date: string;
  title: string;
  body: string;
  state: string;
  tone: Tone;
  reply: string | null;
}

export interface ConsentBiz {
  id: string;
  name: string;
  on: Record<Channel, boolean>;
}

export interface ConsentsView {
  contacts: Record<Channel, string | null>; // display form (phone / email), null = no such contact
  allStopped: Record<Channel, boolean>; // "all senders" stop per channel
  businesses: ConsentBiz[];
}

export interface AccountData {
  profile: { name: string; phone: string | null; email: string | null; initials: string };
  upcoming: ApptView[];
  past: ApptView[];
  saved: SavedCard[];
  reviews: ReviewView[];
  consents: ConsentsView;
  deletion: { requested: string; dueBy: string } | null;
}

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const ACTIVE: BookingStatus[] = ['pending_payment', 'confirmed', 'checked_in', 'in_treatment'];
export const DELETE_DAYS = 30;

const STATUS: Record<BookingStatus, [string, Tone]> = {
  pending_payment: ['ממתין לתשלום', 'warn'],
  abandoned: ['לא הושלם', 'neutral'],
  confirmed: ['מאושר', 'ok'],
  checked_in: ['הגעת לקליניקה', 'ok'],
  in_treatment: ['בטיפול', 'ok'],
  completed: ['הושלם', 'neutral'],
  cancelled_client: ['בוטל', 'neutral'],
  cancelled_clinic: ['בוטל על ידי הקליניקה', 'bad'],
  no_show: ['לא הגעת', 'warn'],
};

const REVIEW_STATUS: Record<ReviewStatus, [string, Tone]> = {
  submitted: ['בבדיקה', 'warn'],
  published: ['פורסם', 'ok'],
  rejected: ['לא פורסם', 'bad'],
  removed: ['הוסר', 'neutral'],
};

export const hoursLabel = (h: number) => {
  const n = Math.floor(h);
  if (n < 1) return 'פחות משעה';
  return n === 1 ? 'שעה' : n === 2 ? 'שעתיים' : `${n} שעות`;
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map(p => p[0]).join('') : 'אני';
}

/** Businesses the client has a relationship with: booked there, or holds a consent row for. */
async function businessNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.business.findMany({
    where: { id: { in: ids } },
    select: { id: true, legalName: true, branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 2 } },
  });
  // One branch: its public name. Several: the business's legal name when set.
  return new Map(rows.map(b => [b.id, (b.branches.length > 1 ? b.legalName : null) ?? b.branches[0]?.name ?? b.legalName ?? 'עסק']));
}

export async function loadConsents(user: Pick<User, 'id' | 'phone' | 'email'>, bookedBizIds: string[]): Promise<ConsentsView> {
  const contacts = [user.phone, user.email].filter((x): x is string => !!x);
  const rows = contacts.length ? await db.messageConsent.findMany({ where: { contact: { in: contacts } } }) : [];
  const contactFor = (ch: Channel) => (ch === 'email' ? user.email : user.phone);
  const row = (scope: string, ch: Channel) => {
    const c = contactFor(ch);
    return c ? rows.find(r => r.contact === c && r.scope === scope && r.channel === ch) : undefined;
  };
  const bizIds = [...new Set([...bookedBizIds, ...rows.filter(r => r.scope !== 'all').map(r => r.scope)])];
  const names = await businessNames(bizIds);
  const chans: Channel[] = ['wa', 'sms', 'email'];
  return {
    contacts: { wa: user.phone ? fromE164(user.phone) : null, sms: user.phone ? fromE164(user.phone) : null, email: user.email },
    allStopped: Object.fromEntries(chans.map(ch => [ch, row('all', ch)?.marketing === false])) as Record<Channel, boolean>,
    businesses: bizIds
      .filter(id => names.has(id))
      .map(id => ({ id, name: names.get(id)!, on: Object.fromEntries(chans.map(ch => [ch, !!row(id, ch)?.marketing])) as Record<Channel, boolean> }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he')),
  };
}

/** Latest delete request that has not been superseded by a later decision on the same user. */
export async function pendingDeletion(userId: string) {
  const last = await db.decision.findFirst({ where: { subjectType: 'user', subjectId: userId }, orderBy: { createdAt: 'desc' } });
  return last?.action === 'delete_request' ? last : null;
}

export async function loadAccount(user: User, now = new Date()): Promise<AccountData> {
  const [bookings, reviews, saved, deletion] = await Promise.all([
    db.booking.findMany({
      where: { clientUserId: user.id, status: { not: 'abandoned' } },
      orderBy: { startsAt: 'desc' },
      take: 200,
      include: {
        branch: { select: { name: true, slug: true, regionSlug: true, address: true, cityName: true, whatsapp: true, wazeUrl: true, businessId: true } },
        treatment: { select: { name: true } },
        practitioner: { select: { displayName: true } },
        review: { select: { id: true } },
        payments: {
          where: { status: { in: ['succeeded', 'refunded', 'partially_refunded', 'forfeited', 'applied'] } },
          select: { purpose: true, grossAgorot: true, status: true, documents: { where: { type: { in: ['tax_invoice_receipt', 'receipt'] } }, select: { number: true } } },
        },
      },
    }),
    db.review.findMany({
      where: { booking: { clientUserId: user.id } },
      orderBy: { createdAt: 'desc' },
      include: { branch: { select: { name: true } } },
    }),
    savedCardsOf(user.id),
    pendingDeletion(user.id),
  ]);

  const appts: ApptView[] = bookings.map(b => {
    const p = ilParts(b.startsAt);
    const upcoming = ACTIVE.includes(b.status) && b.startsAt.getTime() + b.durationMin * 60_000 > now.getTime();
    const token = bookingToken(b.id);
    const deposit = b.payments.find(x => x.purpose === 'deposit');
    const notes: ApptView['notes'] = [];
    if (deposit) {
      const amt = nisFromAgorot(deposit.grossAgorot);
      const d = {
        succeeded: ['מקדמה ', ' שולמה'],
        refunded: ['מקדמה ', ' הוחזרה'],
        partially_refunded: ['מקדמה ', ' הוחזרה בחלקה'],
        forfeited: ['מקדמה ', ' לא הוחזרה'],
        applied: ['מקדמה ', ' קוזזה מהתשלום'],
      }[deposit.status as 'succeeded'];
      if (d) notes.push({ pre: d[0], ltr: amt, post: d[1] });
    }
    for (const doc of b.payments.flatMap(x => x.documents)) notes.push({ pre: 'חשבונית ', ltr: doc.number });

    const window = refundWindowHours(b);
    const h = hoursUntil(b, now);
    let notice: string | null = null;
    if (b.status === 'pending_payment') notice = 'התור יאושר אחרי תשלום המקדמה. אם התשלום לא יושלם, המועד ישוחרר.';
    else if (upcoming && b.status === 'confirmed' && h > 0 && h < window)
      notice = `התור בעוד ${hoursLabel(h)}, בתוך חלון הביטול של ${hoursLabel(window)}. ביטול או שינוי עכשיו ייחשבו מאוחרים${deposit ? ' והמקדמה לא תוחזר' : ''}.`;

    const [state, tone] = STATUS[b.status];
    const address = joinAddress(b.branch.address, b.branch.cityName);
    return {
      id: b.id,
      ref: b.ref,
      svc: b.treatment?.name ?? (b.kind === 'consult' ? 'פגישת ייעוץ' : 'תור'),
      staff: b.practitioner?.displayName ?? null,
      clinic: b.branch.name,
      address,
      dom: String(p.d).padStart(2, '0'),
      mon: MONTHS[p.m - 1],
      weekday: DAY_NAMES[p.dow],
      date: ilDate(b.startsAt),
      time: hhmm(b.startsAt),
      price: b.priceAgorot != null ? nisFromAgorot(b.priceAgorot) : null,
      notes,
      state,
      tone,
      upcoming,
      canChange: upcoming && b.status === 'confirmed',
      notice,
      manageHref: `/b/${token}`,
      receiptHref: b.payments.length ? `/b/${token}/receipt` : null,
      reviewHref: b.status === 'completed' && !b.review ? `/review/${token}` : null,
      rebookHref: BOOKING_LIVE ? `/book/${b.branch.slug}` : profileHref(b.branch),
      rebookLabel: BOOKING_LIVE ? 'קביעת תור חוזר' : 'לפרופיל הקליניקה',
      wazeHref: b.branch.wazeUrl || (address ? `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes` : null),
      waHref: b.branch.whatsapp ? waHref(b.branch.whatsapp, b.branch.name) : null,
    };
  });

  const consents = await loadConsents(user, [...new Set(bookings.map(b => b.branch.businessId))]);
  const name = user.fullName?.trim() || 'החשבון שלי';

  return {
    profile: { name, phone: user.phone ? fromE164(user.phone) : null, email: user.email, initials: initials(user.fullName ?? '') },
    upcoming: appts.filter(a => a.upcoming).reverse(), // soonest first
    past: appts.filter(a => !a.upcoming),
    saved,
    reviews: reviews.map(r => {
      const [state, tone] = REVIEW_STATUS[r.status];
      return {
        id: r.id,
        clinic: r.branch.name,
        rating: r.rating,
        svc: r.treatmentName,
        date: ilDate(r.createdAt),
        title: r.title,
        body: r.body,
        state,
        tone,
        reply: r.status === 'published' ? r.businessReply : null,
      };
    }),
    consents,
    deletion: deletion
      ? { requested: ilDate(deletion.createdAt), dueBy: ilDate(new Date(deletion.createdAt.getTime() + DELETE_DAYS * 86_400_000)) }
      : null,
  };
}
