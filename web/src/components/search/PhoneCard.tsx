import Link from 'next/link';
import { WhatsAppButton } from './WhatsAppButton';
import s from './PhoneCard.module.css';

// Pieces of the phone clinic card (responsive spec §3.2), shared by the search, directory, region,
// treatment and homepage cards. They render inside `.bf-shell-only` wrappers (or are hidden by the
// card's own shell CSS on desktop), so the desktop cards stay exactly as they are.

const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

type Rating = { rating: number; count: number } | null | undefined;

/**
 * One-line rating next to the name: the Google rating when there is one, otherwise BeautyFind's.
 * The source is always named for screen readers and the two are never merged (decision A4).
 */
export function CompactRating({ google, beautyfind, className }: { google: Rating; beautyfind: Rating; className?: string }) {
  const g = google && google.count > 0 ? google : null;
  const bf = !g && beautyfind && beautyfind.count > 0 ? beautyfind : null;
  const r = g ?? bf;
  if (!r) return <span className={`${s.rating} ${s.none} ${className ?? ''}`}>חדש</span>;
  const src = g ? 'Google' : 'BeautyFind';
  return (
    <span className={`${s.rating} ${className ?? ''}`} role="img" aria-label={`דירוג ${src} ${r.rating.toFixed(1)} מתוך 5, ${r.count} ביקורות`}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className={s.star} data-src={g ? 'g' : 'bf'}>
        <path d={STAR} fill="currentColor" />
      </svg>
      <span className="ltr tnum" aria-hidden="true">{r.rating.toFixed(1)}</span>
      <span className={`${s.count} ltr tnum`} aria-hidden="true">({r.count.toLocaleString('en-US')})</span>
    </span>
  );
}

const telHref = (e164: string) => `tel:${e164.replace(/\s/g, '')}`;

/** WhatsApp and call icon buttons, then the primary CTA that takes the rest of the row. */
export function CardActions({
  branchId,
  name,
  href,
  whatsapp,
  phone,
  query,
  className,
}: {
  branchId: string;
  name: string;
  href: string;
  whatsapp?: string | null;
  phone?: string | null;
  query?: string;
  className?: string;
}) {
  return (
    <div className={`${s.actions} ${className ?? ''}`}>
      {whatsapp && <WhatsAppButton branchId={branchId} e164={whatsapp} name={name} query={query} className={s.icon} />}
      {phone && (
        <a href={telHref(phone)} aria-label={`שיחה אל ${name}`} className={`${s.icon} ${s.tel}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z" />
          </svg>
        </a>
      )}
      <Link href={href} className={s.primary} aria-label={`לפרופיל של ${name}`}>
        לפרופיל העסק
      </Link>
    </div>
  );
}
