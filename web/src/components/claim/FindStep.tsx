import Image from 'next/image';
import Link from 'next/link';
import type { RefObject } from 'react';
import type { ListingHit } from '@/app/for-business/claim/shared';
import { ROUTES } from '@/lib/routes';
import { InfoIcon } from './InfoIcon';
import styles from './Claim.module.css';

interface Props {
  headingRef: RefObject<HTMLHeadingElement | null>;
  q: string;
  onQuery: (q: string) => void;
  hits: ListingHit[];
  searching: boolean;
  searchFailed: boolean;
  pickedId: string | null;
  onPick: (hit: ListingHit) => void;
}

function resultLine(q: string, n: number, failed: boolean) {
  if (failed) return 'החיפוש נכשל. נסו שוב בעוד רגע.';
  const query = q.trim();
  if (!query) return n === 1 ? 'עסק אחד נמצא לפי החיפוש שלכם' : <><span className="ltr">{n}</span> עסקים נמצאו לפי החיפוש שלכם</>;
  if (n === 0) return `לא נמצאו עסקים תואמים "${query}"`;
  if (n === 1) return `עסק אחד תואם "${query}"`;
  return <><span className="ltr">{n}</span> עסקים תואמים &quot;{query}&quot;</>;
}

export function FindStep({ headingRef, q, onQuery, hits, searching, searchFailed, pickedId, onPick }: Props) {
  return (
    <section aria-labelledby="h-find" className={styles.section}>
      <h2 id="h-find" ref={headingRef} tabIndex={-1} className={styles.h2}>
        איתור העסק<span className={styles.dot}>.</span>
      </h2>
      <p className={styles.lede}>חפשו את העסק לפי שם או עיר. אם הוא כבר באינדקס, בחרו אותו. אם לא מצאתם אותו, אפשר לפתוח פרופיל חדש בסוף הרשימה.</p>

      <label className={styles.search}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="5.4" />
          <path d="m12.2 12.2 3 3" />
        </svg>
        <span className="sr-only">חיפוש עסק</span>
        <input
          type="search"
          value={q}
          onChange={e => onQuery(e.target.value)}
          maxLength={80}
          autoComplete="off"
          aria-controls="claim-results"
          placeholder="שם העסק או העיר, למשל: שרון קליניק, רעננה"
        />
      </label>
      <p className={styles.resultLine} aria-live="polite">{resultLine(q, hits.length, searchFailed)}</p>

      <ul id="claim-results" className={styles.results} aria-busy={searching}>
        {hits.map(b => {
          const on = b.id === pickedId;
          return (
            <li key={b.id}>
              <button type="button" className={styles.hit} aria-pressed={on} onClick={() => onPick(b)}>
                <span aria-hidden="true" className={styles.thumb}>
                  {b.img && <Image src={b.img} alt="" fill sizes="54px" unoptimized={!b.img.startsWith('/')} style={{ objectFit: 'cover' }} />}
                </span>
                <span className={styles.hitText}>
                  <span className={styles.hitName}>{b.name}</span>
                  <span className={styles.hitMeta}>{[b.category, b.city].filter(Boolean).join(' · ')}</span>
                  {b.phone && <span dir="ltr" className={`${styles.hitPhone} ltr`}>{b.phone}</span>}
                </span>
                <span className={styles.tag} data-claimed={b.claimed || undefined}>{b.claimed ? 'כבר אושר' : 'זמין לאישור'}</span>
              </button>
              {on && b.claimed && (
                <div className={`${styles.note} ${styles.noteInline}`} role="status">
                  <InfoIcon />
                  <p>
                    <strong>לעסק הזה כבר יש בעלים מאומתים.</strong> אם אתם עובדים בעסק, בקשו מהבעלים הזמנה לצוות: שולחים אותה מלוח הבקרה, תחת צוות והרשאות. חושבים שנפלה טעות?{' '}
                    <Link href={ROUTES.contact}>פנו אלינו</Link>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Link href={ROUTES.join} className={styles.newCard}>
        <span aria-hidden="true" className={styles.plus}>+</span>
        <span className={styles.newText}>
          <span className={styles.newTitle}>העסק שלי לא מופיע</span>
          <span className={styles.newSub}>נפתח פרופיל חדש, ונאמת אותו מול הרישום העסקי</span>
        </span>
      </Link>
    </section>
  );
}
