import Link from 'next/link';
import { BOOKING_LIVE } from '@/lib/features';
import { ArrowForward, Check } from '@/components/icons';
import { SaveHeart } from '@/components/save-heart/SaveHeart';
import { fmtNum } from './copy';
import type { DirectoryCard } from './data';
import styles from './Directory.module.css';

const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

function StarRow({ fill }: { fill: string }) {
  return (
    <svg width="85" height="16" viewBox="0 0 85 16" fill={fill} aria-hidden="true">
      {[0, 17, 34, 51, 68].map(x => (
        <path key={x} transform={x ? `translate(${x},0)` : undefined} d={STAR} />
      ))}
    </svg>
  );
}

const waHref = (e164: string) => `https://wa.me/${e164.replace(/\D/g, '')}`;
const telHref = (e164: string) => `tel:${e164.replace(/\s/g, '')}`;

/**
 * Listing card (Directory design). Google and BeautyFind ratings sit side by side and are never
 * merged (decision A4). `delayIndex` staggers the entry animation within one "show more" batch.
 */
export function ListingCard({ c, delayIndex }: { c: DirectoryCard; delayIndex: number }) {
  const thumbs = c.gallery.filter(g => g.url !== c.coverUrl);
  const mosaic = c.coverUrl != null && thumbs.length >= 2;
  const extra = thumbs.length - 2;

  const chips: string[] = [];
  for (const cat of c.categories.slice(0, 2)) chips.push(cat.name);
  if (BOOKING_LIVE && c.onlineBooking) chips.push('קביעת תור אונליין');
  if (c.freeParking) chips.push('חניה חינם');
  if (c.accessible) chips.push('נגיש');

  return (
    <li className={styles.card} style={{ animationDelay: `${delayIndex * 50}ms` }}>
      <SaveHeart id={c.id} name={c.name} className={styles.heart} />

      <Link href={c.href} tabIndex={-1} aria-hidden="true" className={styles.media} data-single={!mosaic || undefined}>
        <span className={`${styles.tile} ${styles.tileMain}`}>
          {c.coverUrl ? (
            <img src={c.coverUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className={styles.placeholder}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.6 5.4h16.8v13.2H3.6z" />
                <path d="M3.6 15.2 8.4 10.6l4 3.8 3.2-2.6 3.8 3.4" />
              </svg>
            </span>
          )}
        </span>
        {mosaic && (
          <>
            <span className={styles.tile}>
              <img src={thumbs[0].url} alt="" loading="lazy" decoding="async" />
            </span>
            <span className={styles.tile}>
              <img src={thumbs[1].url} alt="" loading="lazy" decoding="async" />
              {extra > 0 && <span className={`${styles.more} ltr`}>+{extra}</span>}
            </span>
          </>
        )}
      </Link>

      <div className={styles.body}>
        <div className={styles.nameRow}>
          <h3 className={styles.name}>
            <Link href={c.href}>{c.name}</Link>
          </h3>
          {c.verified && (
            <span className={styles.verified}>
              <Check size={12} strokeWidth={1.8} />
              מאומת
            </span>
          )}
        </div>
        <address className={styles.address}>{c.address}</address>

        <div className={styles.ratings}>
          {c.google && (
            <span className={styles.rating}>
              <span className={styles.source}>Google</span>
              <span dir="ltr" role="img" aria-label={`דירוג Google ${c.google.rating.toFixed(1)} מתוך 5, ${fmtNum(c.google.count)} ביקורות`} className={styles.stars}>
                <StarRow fill="#DADCE0" />
                <span className={styles.starsFill} style={{ width: `${Math.round((c.google.rating / 5) * 100)}%` }}>
                  <StarRow fill="#FBBC04" />
                </span>
              </span>
              <span aria-hidden="true" className={`${styles.rateNum} ltr`}>{c.google.rating.toFixed(1)}</span>
              <span aria-hidden="true" className={`${styles.rateCount} ltr`}>({fmtNum(c.google.count)})</span>
            </span>
          )}
          {c.beautyfind && (
            <span className={styles.rating} role="img" aria-label={`ביקורות BeautyFind מאומתות: ${c.beautyfind.rating.toFixed(1)} מתוך 5, ${fmtNum(c.beautyfind.count)} ביקורות`}>
              <span aria-hidden="true" className={styles.source}>BeautyFind</span>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={styles.bfStar}>
                <path d={STAR} />
              </svg>
              <span aria-hidden="true" className={`${styles.rateNum} ltr`}>{c.beautyfind.rating.toFixed(1)}</span>
              <span aria-hidden="true" className={`${styles.rateCount} ltr`}>({fmtNum(c.beautyfind.count)})</span>
            </span>
          )}
          {!c.google && !c.beautyfind && <span className={styles.noReviews}>עדיין אין ביקורות</span>}
        </div>

        {c.responsible && <div className={styles.responsible}>אחריות רפואית: {c.responsible}</div>}

        <div className={styles.chips}>
          {chips.map(ch => (
            <span key={ch} className={styles.chip}>
              {ch}
            </span>
          ))}
          {c.priceFromShekels != null && (
            <span className={styles.chip}>
              החל מ־<span className="ltr">₪{fmtNum(c.priceFromShekels)}</span>
            </span>
          )}
        </div>

        <div className={styles.actions}>
          {c.whatsapp && (
            <a href={waHref(c.whatsapp)} target="_blank" rel="noopener noreferrer" aria-label={`וואטסאפ אל ${c.name}`} className={`${styles.iconBtn} ${styles.wa}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z"
                />
              </svg>
            </a>
          )}
          {c.phone && (
            <a href={telHref(c.phone)} aria-label={`שיחה אל ${c.name}`} className={`${styles.iconBtn} ${styles.tel}`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z" />
              </svg>
            </a>
          )}
          <Link href={c.href} aria-label={`לצפייה בעסק ${c.name}`} className={styles.toBiz}>
            <span>לעסק</span>
            <ArrowForward size={14} />
          </Link>
        </div>
      </div>
    </li>
  );
}
