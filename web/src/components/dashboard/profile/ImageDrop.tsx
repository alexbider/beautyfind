'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ProfileEditor.module.css';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

const ERRORS: Record<string, string> = {
  type: 'אפשר להעלות JPG, PNG או WebP בלבד',
  size: 'הקובץ גדול מ־8MB. נסו תמונה קטנה יותר',
  empty: 'הקובץ ריק. נסו תמונה אחרת',
  forbidden: 'אין לכם הרשאה להעלות תמונות',
  server: 'ההעלאה נכשלה בצד שלנו. נסו שוב בעוד רגע',
  network: 'ההעלאה נכשלה. בדקו את החיבור ונסו שוב',
};

function upload(file: File, alt: string, onProgress: (p: number) => void): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/biz/profile/upload');
    xhr.responseType = 'json';
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; url?: string; error?: string } | null;
      if (body?.ok && body.url) resolve({ ok: true, url: body.url });
      else resolve({ ok: false, error: body?.error ?? (xhr.status === 403 ? 'forbidden' : 'server') });
    };
    xhr.onerror = () => resolve({ ok: false, error: 'network' });
    const fd = new FormData();
    fd.append('file', file);
    if (alt) fd.append('alt', alt);
    xhr.send(fd);
  });
}

/**
 * A dashed frame that uploads a dropped or picked image and reports its URL.
 * The frame's size and look come from `frameClass`; the image is only a candidate until the profile is published.
 */
export function ImageDrop({
  label,
  placeholder,
  url,
  alt,
  fit = 'cover',
  frameClass,
  disabled,
  onUploaded,
  onRemove,
  onBusy,
}: {
  label: string;
  placeholder: string;
  url: string;
  alt: string;
  fit?: 'cover' | 'contain';
  frameClass: string;
  disabled: boolean;
  onUploaded: (url: string) => void;
  onRemove?: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const take = async (file: File | undefined) => {
    if (!file || disabled || progress !== null) return;
    if (!TYPES.includes(file.type)) return setError(ERRORS.type);
    if (file.size > MAX_BYTES) return setError(ERRORS.size);
    if (file.size === 0) return setError(ERRORS.empty);
    setError('');
    setProgress(0);
    onBusy(true);
    const res = await upload(file, alt, p => alive.current && setProgress(p));
    onBusy(false);
    if (!alive.current) return;
    setProgress(null);
    if (res.ok) onUploaded(res.url);
    else setError(ERRORS[res.error] ?? ERRORS.server);
  };

  const busy = progress !== null;
  const pct = Math.round((progress ?? 0) * 100);

  return (
    <div className={styles.dropWrap}>
      <div
        className={`${frameClass} ${styles.drop}`}
        data-over={over || undefined}
        data-bad={!!error || undefined}
        onDragOver={e => { if (disabled) return; e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      >
        {url && (
          // User uploads served from /media; next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={alt} loading="lazy" className={styles.dropImg} style={{ objectFit: fit }} />
        )}
        {!disabled && (
          <label className={url ? styles.dropReplace : styles.dropEmpty}>
            <input
              type="file"
              accept={TYPES.join(',')}
              className="sr-only"
              disabled={busy}
              aria-label={url ? `החלפת ${label}` : `העלאת ${label}`}
              onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }}
            />
            {!url && (
              <>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                <span className={styles.dropCap}>{placeholder}</span>
              </>
            )}
            {url && <span className={styles.dropReplaceText}>החלפה</span>}
          </label>
        )}
        {disabled && !url && <span className={`${styles.dropEmpty} ${styles.dropCap}`}>{placeholder}</span>}
        {url && onRemove && !disabled && !busy && (
          <button type="button" className={styles.dropRemove} onClick={onRemove} aria-label={`הסרת ${label}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        )}
        {busy && (
          <div className={styles.dropProgress} role="progressbar" aria-label={`העלאת ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span className={styles.dropProgressText}>
              מעלה… <span className="ltr">{pct}%</span>
            </span>
            <span className={styles.dropTrack}><span style={{ width: `${pct}%` }} /></span>
          </div>
        )}
      </div>
      {error && <p role="alert" className={styles.dropError}>{error}</p>}
    </div>
  );
}
