// Israel time helpers. Everything is stored in UTC; business hours and slots are Asia/Jerusalem.
// Week starts Sunday (index 0), matching Branch.hours.

export const TZ = 'Asia/Jerusalem';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface IlParts { y: number; m: number; d: number; hh: number; mm: number; dow: number }

/** Wall-clock parts of an instant in Israel. */
export function ilParts(at: Date): IlParts {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, dow: WD[p.weekday] };
}

/** "YYYY-MM-DD" of an instant, in Israel. */
export const ilDateKey = (at: Date) => {
  const p = ilParts(at);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};

/** The UTC instant for an Israel wall-clock date ("YYYY-MM-DD") and time ("HH:MM"). DST-safe. */
export function ilToUtc(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  // Guess with UTC, then correct by the offset Israel had at that instant (two passes cover DST edges).
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = ilParts(new Date(t));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    t += Date.UTC(y, m - 1, d, hh, mm) - shown;
  }
  return new Date(t);
}

/** Adds whole days to a date key. */
export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a date key. */
export const dowOf = (dateKey: string) => new Date(dateKey + 'T12:00:00Z').getUTCDay();

export const hhmm = (at: Date) => {
  const p = ilParts(at);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
};

/** DD/MM/YYYY in Israel. */
export const ilDate = (at: Date) => {
  const p = ilParts(at);
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
};

export const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
export const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
