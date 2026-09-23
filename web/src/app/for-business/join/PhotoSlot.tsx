'use client';

import styles from './JoinWizard.module.css';

// A dashed drop area that previews a picked image locally. The wizard uploads the file on pick.
export function PhotoSlot({
  label,
  placeholder,
  size,
  url,
  fit = 'cover',
  className,
  onPick,
  onClear,
}: {
  label: string;
  placeholder: string;
  /** Recommended pixel size, shown after the placeholder, e.g. 1600×900. */
  size?: string;
  url?: string;
  fit?: 'cover' | 'contain';
  className: string;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className={`${styles.slot} ${className}`}>
      {url ? (
        <>
          {/* Local blob preview, so next/image does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className={styles.slotImg} style={{ objectFit: fit }} />
          <button type="button" onClick={onClear} aria-label={`הסרת ${label}`} className={styles.slotRemove}>
            ×
          </button>
        </>
      ) : (
        <label className={styles.slotEmpty}>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={`${label}: ${placeholder}${size ? ` ${size}` : ''}`}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onPick(file);
              e.target.value = '';
            }}
          />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className={styles.slotCap}>
            {placeholder}
            {size && (
              <>
                {' · '}
                <span className="ltr">{size}</span>
              </>
            )}
          </span>
        </label>
      )}
    </div>
  );
}
