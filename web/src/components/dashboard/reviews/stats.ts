// Reviews tab: numbers derived from the branch's published BeautyFind reviews.
// Google's rating is never mixed in here (decision A4).

export const REPLY_MIN = 10;
export const REPLY_MAX = 1000;

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const DAY = 86_400_000;
const TZ = 'Asia/Jerusalem';

export interface StatInput { rating: number; createdAt: Date; repliedAt: Date | null; businessReply: string | null }

/** Text with an optional number: render `text` split on '#', the number goes in an .ltr span. */
export interface Counted { text: string; n: number | null }

export function ago(d: Date, now: Date): Counted {
  const days = Math.max(0, Math.floor((startOfDay(now) - startOfDay(d)) / DAY));
  if (days === 0) return { text: 'היום', n: null };
  if (days === 1) return { text: 'אתמול', n: null };
  if (days === 2) return { text: 'לפני יומיים', n: null };
  if (days < 7) return { text: 'לפני # ימים', n: days };
  if (days < 14) return { text: 'לפני שבוע', n: null };
  if (days < 21) return { text: 'לפני שבועיים', n: null };
  if (days < 30) return { text: 'לפני # שבועות', n: Math.floor(days / 7) };
  const m = Math.floor(days / 30);
  if (m === 1) return { text: 'לפני חודש', n: null };
  if (m === 2) return { text: 'לפני חודשיים', n: null };
  if (m < 12) return { text: 'לפני # חודשים', n: m };
  const y = Math.floor(days / 365);
  if (y <= 1) return { text: 'לפני שנה', n: null };
  if (y === 2) return { text: 'לפני שנתיים', n: null };
  return { text: 'לפני # שנים', n: y };
}

/** Midnight in Israel as a UTC timestamp, so "yesterday" follows the clinic's calendar. */
function startOfDay(d: Date) {
  const { y, m, day } = ymd(d);
  return Date.UTC(y, m - 1, day);
}

function ymd(d: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (t: string) => Number(p.find(x => x.type === t)?.value);
  return { y: get('year'), m: get('month'), day: get('day') };
}

export function fmtDate(d: Date) {
  const { y, m, day } = ymd(d);
  return `${day}.${m}.${y}`;
}

export function computeStats(list: StatInput[], now: Date) {
  const total = list.length;
  const avg = total ? list.reduce((a, r) => a + r.rating, 0) / total : 0;
  const open = list.filter(r => !r.businessReply).length;

  const dist = [5, 4, 3, 2, 1].map(n => {
    const count = list.filter(r => r.rating === n).length;
    return { n, count, pct: total ? Math.round((count / total) * 100) : 0 };
  });

  // Running average at the end of each of the last six months (Israel calendar).
  const { y, m } = ymd(now);
  const months = Array.from({ length: 6 }, (_, i) => {
    const idx = y * 12 + (m - 1) - (5 - i);
    const yy = Math.floor(idx / 12);
    const mm = idx % 12;
    const end = Date.UTC(yy, mm + 1, 1) - 3 * 3_600_000; // month end in Israel, near enough for a monthly trend
    const upto = list.filter(r => r.createdAt.getTime() < end);
    return { label: MONTHS[mm], value: upto.length ? upto.reduce((a, r) => a + r.rating, 0) / upto.length : null };
  });
  const values = months.map(x => x.value).filter((v): v is number => v !== null);
  const lo = values.length ? Math.min(4.5, Math.max(1, Math.floor((Math.min(...values) - 0.05) * 10) / 10)) : 4.5;
  const W = 300, H = 46, TOP = 6;
  const points = months
    .map((x, i) => (x.value === null ? null : `${(W - (i / 5) * W).toFixed(1)},${(H - ((x.value - lo) / (5 - lo)) * (H - TOP)).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  const first = values[0];
  const last = values[values.length - 1];
  const trendLabel = values.length < 2
    ? ''
    : first.toFixed(2) === last.toFixed(2)
      ? `הדירוג הממוצע נשאר ${last.toFixed(2)} בחצי השנה האחרונה`
      : `הדירוג הממוצע ${last > first ? 'עלה' : 'ירד'} מ־${first.toFixed(2)} ל־${last.toFixed(2)} בחצי שנה`;

  const replied = list.filter(r => r.businessReply && r.repliedAt);
  const replyRate = total ? `${Math.round((replied.length / total) * 100)}%` : '';
  const waits = replied.map(r => (r.repliedAt!.getTime() - r.createdAt.getTime()) / DAY).sort((a, b) => a - b);
  const median = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2] : (waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2) : null;

  return {
    total,
    open,
    avg: total ? avg.toFixed(1) : '',
    dist,
    trend: { points, hasLine: values.length >= 2, months: months.map(x => x.label), scale: `${lo.toFixed(1)}–5.0`, label: trendLabel },
    replyRate,
    replyTime: median === null ? null : waitText(median),
  };
}

function waitText(days: number): Counted {
  if (days < 1) {
    const h = Math.max(1, Math.round(days * 24));
    if (h === 1) return { text: 'שעה', n: null };
    if (h === 2) return { text: 'שעתיים', n: null };
    if (h < 24) return { text: '# שעות', n: h };
  }
  const d = Math.round(days * 10) / 10;
  if (d === 1) return { text: 'יום', n: null };
  if (d === 2) return { text: 'יומיים', n: null };
  return { text: '# ימים', n: d };
}

export function openLine(open: number) {
  if (open === 0) return { text: 'אין ביקורות שממתינות לתגובה', n: null };
  if (open === 1) return { text: 'ביקורת אחת ממתינה לתגובה', n: null };
  if (open === 2) return { text: 'שתי ביקורות ממתינות לתגובה', n: null };
  return { text: '# ביקורות ממתינות לתגובה', n: open };
}

export function totalLine(total: number): Counted {
  if (total === 1) return { text: 'ביקורת אחת בסך הכול', n: null };
  if (total === 2) return { text: 'שתי ביקורות בסך הכול', n: null };
  return { text: '# ביקורות בסך הכול', n: total };
}
