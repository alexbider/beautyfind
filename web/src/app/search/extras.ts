import 'server-only';
import type { CardExtra } from '@/components/search/ResultCard';
import { db } from '@/lib/server/db';

// Card fields the Search design shows that ListingCard does not carry yet: street address,
// WhatsApp and phone numbers, "open now" and the name behind אחריות רפואית. One extra read for the ids on
// screen. TODO: move these into ListingCard (lib/server/public.ts) and delete this file.

const TZ = 'Asia/Jerusalem';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Day = { open?: string; close?: string; closed?: boolean };

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

/** Branch.hours: 7 entries, index 0 = Sunday, times HH:MM in Israel time. */
export function isOpenNow(hours: unknown, now = new Date()): boolean {
  if (!Array.isArray(hours) || hours.length !== 7) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const day = hours[WEEKDAYS.indexOf(get('weekday'))] as Day | undefined;
  if (!day || day.closed || !day.open || !day.close) return false;
  const nowMin = Number(get('hour')) * 60 + Number(get('minute'));
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  return nowMin >= open && nowMin < close;
}

export async function cardExtras(ids: string[]): Promise<Record<string, CardExtra>> {
  if (ids.length === 0) return {};
  const rows = await db.branch.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      address: true,
      whatsapp: true,
      phone: true,
      hours: true,
      medicalResponsible: { select: { displayName: true, license: { select: { status: true } } } },
    },
  });
  const now = new Date();
  return Object.fromEntries(
    rows.map(r => [
      r.id,
      {
        address: r.address,
        whatsapp: r.whatsapp,
        phone: r.phone,
        openNow: isOpenNow(r.hours, now),
        // Only a verified license is shown as אחריות רפואית (verification flow B3).
        medicalName: r.medicalResponsible?.license?.status === 'verified' ? r.medicalResponsible.displayName : null,
      } satisfies CardExtra,
    ]),
  );
}
