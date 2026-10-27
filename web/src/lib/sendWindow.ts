// The sending window (05-messages.md): every message goes out between 08:00 and 21:00 Israel time; marketing
// also never on Shabbat (from Friday 14:00), holidays and their eves, or memorial days. Pure, for the tests.
import { addDays, ilDateKey, ilParts, ilToUtc } from './time';

// Holidays, their eves from 14:00, and memorial days: no marketing (Israeli dates, yyyy-mm-dd).
const NO_MARKETING_DAYS = new Set([
  // 2026
  '2026-04-02', '2026-04-08', '2026-04-14', '2026-04-21', '2026-04-22', '2026-05-22', '2026-07-23',
  '2026-09-12', '2026-09-13', '2026-09-21', '2026-09-26', '2026-10-03',
  // 2027
  '2027-04-22', '2027-04-28', '2027-05-04', '2027-05-11', '2027-05-12', '2027-06-11', '2027-08-12',
  '2027-10-02', '2027-10-03', '2027-10-11', '2027-10-16', '2027-10-23',
  // 2028
  '2028-04-11', '2028-04-17', '2028-05-31', '2028-09-21', '2028-09-22', '2028-09-30', '2028-10-05', '2028-10-12',
]);

const OPEN_H = 8;
const CLOSE_H = 21;

function blockedForMarketing(at: Date): boolean {
  const p = ilParts(at);
  const day = ilDateKey(at);
  if (p.dow === 6) return true; // Saturday
  if (p.dow === 5 && p.hh >= 14) return true; // Friday afternoon
  if (NO_MARKETING_DAYS.has(day)) return true;
  return NO_MARKETING_DAYS.has(addDays(day, 1)) && p.hh >= 14; // holiday eve
}

/** The first moment at or after `at` when this kind of message may go out. */
export function nextSendable(at: Date, kind: 'service' | 'marketing'): Date {
  let t = at;
  for (let i = 0; i < 40; i++) {
    const p = ilParts(t);
    const day = ilDateKey(t);
    if (p.hh < OPEN_H) { t = ilToUtc(day, '08:00'); continue; }
    if (p.hh >= CLOSE_H) { t = ilToUtc(addDays(day, 1), '08:00'); continue; }
    if (kind === 'marketing' && blockedForMarketing(t)) { t = ilToUtc(addDays(day, 1), '08:00'); continue; }
    return t;
  }
  return t;
}

