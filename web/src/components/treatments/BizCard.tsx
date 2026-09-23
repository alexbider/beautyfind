import Link from 'next/link';
import { ArrowForward, Check } from '@/components/icons';
import { nis } from '@/lib/format';
import type { ListingCard } from '@/lib/server/public';
import { SaveHeart } from '@/components/save-heart/SaveHeart';
import { CardActions, CompactRating } from '@/components/search/PhoneCard';
import { CATEGORY_CONTENT } from './content';
import { fmtInt } from './format';
import styles from './BizCard.module.css';

const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

function StarRow({ fill }: { fill: string }) {
  return (
    <svg width="72" height="14" viewBox="0 0 85 16" fill={fill} aria-hidden="true" style={{ display: 'block' }}>
      {[0, 17, 34, 51, 68].map(x => <path key={x} transform={x ? `translate(${x},0)` : undefined} d={STAR} />)}
    </svg>
  );
}

/** Five stars filled to `rating / 5`. Always LTR. */
export function PartialStars({ rating, label }: { rating: number; label: string }) {
  return (
    <span dir="ltr" role="img" aria-label={label} className={styles.stars}>
      <StarRow fill="#DADCE0" />
      <span className={styles.starsFill} style={{ width: `${Math.round((rating / 5) * 100)}%` }}>
        <StarRow fill="#FBBC04" />
      </span>
    </span>
  );
}

export function fallbackImage(card: ListingCard) {
  const first = card.categories[0]?.slug;
  return (first && CATEGORY_CONTENT[first]?.img) || '/assets/biz-facial.jpg';
}

/** WhatsApp and phone for the phone card's icon buttons (ListingCard does not carry them). */
export interface BizContact {
  whatsapp: string | null;
  phone: string | null;
}

/**
 * Compact business card (Region and Treatment Category "top rated" lists).
 * Google and BeautyFind ratings are shown on separate lines and never combined.
 * `meta` is the line under the name: "category · city" on Region, the city on a category page.
 * App shell: the phone clinic card (spec §3.2), with a 16:9 image, save heart and contact buttons.
 */
export function BizCard({ card, meta, contact, size = 92, index = 0 }: { card: ListingCard; meta: string; contact?: BizContact; size?: 92 | 96; index?: number }) {
  const img = card.coverUrl || fallbackImage(card);
  return (
    <li className={styles.card} style={{ animationDelay: `${index * 50}ms`, '--thumb': `${size}px` } as React.CSSProperties}>
      <SaveHeart id={card.id} name={card.name} className={`${styles.heart} bf-shell-only`} />
      <Link href={card.href} tabIndex={-1} aria-hidden="true" className={styles.thumb}>
        {/* eslint-disable-next-line @next/next/no-img-element -- covers are user uploads or external URLs */}
        <img src={img} alt="" loading="lazy" decoding="async" />
      </Link>
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h3 className={styles.name}>
            <Link href={card.href}>{card.name}</Link>
          </h3>
          <CompactRating google={card.google} beautyfind={card.beautyfind} className="bf-shell-only" />
          {card.verified && (
            <span className={styles.verified}>
              <Check />
              מאומת
            </span>
          )}
        </div>
        <span className={styles.meta}>{meta}</span>

        {card.google ? (
          <div className={styles.ratingRow}>
            <PartialStars rating={card.google.rating} label={`דירוג Google ${card.google.rating.toFixed(1)} מתוך 5, ${fmtInt(card.google.count)} ביקורות`} />
            <span className={`${styles.score} ltr tnum`}>{card.google.rating.toFixed(1)}</span>
            <span className={styles.reviews}>
              (<span className="ltr tnum">{fmtInt(card.google.count)}</span>) · Google
            </span>
          </div>
        ) : null}
        {card.beautyfind ? (
          <div className={styles.bfRow}>
            <span className={styles.bfLabel}>ביקורות BeautyFind</span>
            <span className={`${styles.score} ltr tnum`}>{card.beautyfind.rating.toFixed(1)}</span>
            <span className={styles.reviews}>
              (<span className="ltr tnum">{fmtInt(card.beautyfind.count)}</span>)
            </span>
          </div>
        ) : null}
        {!card.google && !card.beautyfind && <span className={styles.noRating}>אין עדיין דירוג</span>}

        <div className={styles.footer}>
          {card.priceFromShekels != null && (
            <span className={styles.from}>
              מ־<span className="ltr tnum">{nis(card.priceFromShekels)}</span>
              <span className="sr-only"> לא כולל מע״מ</span>
            </span>
          )}
          <Link href={card.href} className={`${styles.cta} bf-desk-only`} aria-label={`לעסק: ${card.name}`}>
            <span>לעסק</span>
            <ArrowForward size={13} />
          </Link>
        </div>
        <CardActions branchId={card.id} name={card.name} href={card.href} whatsapp={contact?.whatsapp} phone={contact?.phone} className={`${styles.phoneActions} bf-shell-only`} />
      </div>
    </li>
  );
}
