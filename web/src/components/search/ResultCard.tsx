import Link from 'next/link';
import { SaveHeart } from '@/components/save-heart/SaveHeart';
import { nis } from '@/lib/format';
import type { ListingCard } from '@/lib/server/public';
import { priceTier } from './params';
import { CardActions, CompactRating } from './PhoneCard';
import { WhatsAppButton } from './WhatsAppButton';
import s from './search.module.css';

/** Card fields ListingCard does not carry yet (see app/search/extras.ts). */
export interface CardExtra {
  address: string;
  whatsapp: string | null;
  phone: string | null;
  openNow: boolean;
  medicalName: string | null;
}

const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

function StarRow({ fill }: { fill: string }) {
  return (
    <svg width="85" height="16" viewBox="0 0 85 16" fill={fill} aria-hidden="true" style={{ display: 'block' }}>
      {[0, 17, 34, 51, 68].map(x => (
        <path key={x} transform={x ? `translate(${x},0)` : undefined} d={STAR} />
      ))}
    </svg>
  );
}

/** Google-yellow stars filled to the rating, over grey. Always LTR. */
function PartialStars({ rating, label }: { rating: number; label: string }) {
  return (
    <span dir="ltr" role="img" aria-label={label} className={s.stars}>
      <StarRow fill="#DADCE0" />
      <span className={s.starsFill} style={{ width: `${Math.round((rating / 5) * 100)}%` }}>
        <StarRow fill="#FBBC04" />
      </span>
    </span>
  );
}

const FEATURE_TAGS: Array<{ key: 'onlineBooking' | 'freeParking' | 'accessible'; name: string }> = [
  { key: 'freeParking', name: 'חניה חינם' },
  { key: 'accessible', name: 'נגיש לכיסא גלגלים' },
];

export function ResultCard({ card: c, extra, index, delay, query }: { card: ListingCard; extra?: CardExtra; index: number; delay: number; query: string }) {
  const tier = priceTier(c.priceFromShekels);
  const tags = [
    ...c.categories.slice(0, 2).map(t => ({ name: t.name, cat: true })),
    ...FEATURE_TAGS.filter(f => c[f.key]).slice(0, 2).map(f => ({ name: f.name, cat: false })),
  ];
  return (
    <li className={s.card} data-card-index={index} style={{ animationDelay: `${delay}ms` }}>
      <Link href={c.href} tabIndex={-1} aria-hidden="true" className={s.photo}>
        {c.coverUrl ? (
          // Covers come from our media route or storage; plain img keeps them independent of next/image remote config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.coverUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={s.photoEmpty}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.6 5.4h16.8v13.2H3.6z" />
              <path d="M3.6 15.2 8.4 10.6l4 3.8 3.2-2.6 3.8 3.4" />
              <path d="M15.4 9.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4" />
            </svg>
          </span>
        )}
      </Link>
      <SaveHeart id={c.id} name={c.name} className={s.heartPos} />
      <div className={s.body}>
        <div className={s.titleRow}>
          <h3 className={s.cardTitle}>
            <Link href={c.href}>{c.name}</Link>
          </h3>
          <CompactRating google={c.google} beautyfind={c.beautyfind} className={`${s.phoneRating} bf-shell-only`} />
          {/* TODO(sponsored): no campaigns table yet. When it lands: at most 2 sponsored cards per list,
              always tagged "ממומן" (neutral bordered tag here, data-ad border), never changing the order below. */}
          {c.verified && (
            <span className={s.verified}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 7.4 5.4 10.3 11.5 4" />
              </svg>
              מאומת
            </span>
          )}
          {extra?.openNow && (
            <span className={s.openNow}>
              <span aria-hidden="true" className={s.openDot} />
              פתוח כרגע
            </span>
          )}
        </div>
        <p className={`${s.phoneMeta} bf-shell-only`}>
          {[c.categories[0]?.name, c.cityName].filter(Boolean).join(' · ')}
          {c.verified && <span className={s.phoneVerified}> · מאומת</span>}
        </p>
        <address className={s.address}>{extra?.address ? `${extra.address} · ${c.cityName}` : c.cityName}</address>
        <div className={s.metaRow}>
          {c.google ? (
            <>
              <span className={s.src}>Google</span>
              <PartialStars rating={c.google.rating} label={`דירוג Google ${c.google.rating.toFixed(1)} מתוך 5, ${c.google.count} ביקורות`} />
              <span className={`${s.rating} ltr`}>{c.google.rating.toFixed(1)}</span>
              <span className={`${s.reviews} ltr`}>({c.google.count.toLocaleString('en-US')})</span>
            </>
          ) : null}
          {c.beautyfind ? (
            <>
              {c.google && <span aria-hidden="true" className={s.dot} />}
              <span className={s.src}>BeautyFind</span>
              <span className={`${s.rating} ltr`} aria-label={`דירוג BeautyFind ${c.beautyfind.rating.toFixed(1)} מתוך 5`}>
                {c.beautyfind.rating.toFixed(1)}
              </span>
              <span className={`${s.reviews} ltr`}>({c.beautyfind.count.toLocaleString('en-US')})</span>
            </>
          ) : null}
          {!c.google && !c.beautyfind && <span className={s.reviews}>עדיין אין ביקורות</span>}
          {tier && (
            <>
              <span aria-hidden="true" className={s.dot} />
              <span className={s.tier}>
                <span className="ltr">{tier.sym}</span> · {tier.name}
              </span>
            </>
          )}
        </div>
        {extra?.medicalName && <div className={s.director}>אחריות רפואית: {extra.medicalName}</div>}
        {tags.length > 0 && (
          <div className={s.tags}>
            {tags.map(t => (
              <span key={t.name} className={s.tag} data-cat={t.cat || undefined}>
                {t.name}
              </span>
            ))}
          </div>
        )}
        <div className={s.cardFoot}>
          {c.priceFromShekels != null && (
            <span className={s.from}>
              מ־<span className="ltr">{nis(c.priceFromShekels)}</span>, לא כולל מע״מ
            </span>
          )}
          <span className={s.footActions}>
            {extra?.whatsapp && <WhatsAppButton branchId={c.id} e164={extra.whatsapp} name={c.name} query={query} />}
            <Link href={c.href} aria-label={`לצפייה בעסק ${c.name}`} className={s.toBiz}>
              <span>לעסק</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 7H2M6 3 2 7l4 4" />
              </svg>
            </Link>
          </span>
        </div>
        <CardActions
          branchId={c.id}
          name={c.name}
          href={c.href}
          whatsapp={extra?.whatsapp}
          phone={extra?.phone}
          query={query}
          className={`${s.phoneActions} bf-shell-only`}
        />
      </div>
    </li>
  );
}
