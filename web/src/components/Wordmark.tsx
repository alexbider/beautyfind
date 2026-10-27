import { LOGO_BEAUTY, LOGO_FIND, LOGO_H, LOGO_W } from './logoPaths';
import styles from './Wordmark.module.css';

/**
 * The BeautyFind logo as inline SVG: navy "beauty", teal "find.". `size` is the logo height in px (it used to be the
 * font size of the text wordmark, and the logo is drawn to the same visual size). On dark backgrounds "beauty" is white.
 */
export function Wordmark({ size = 28, onDark = false, className }: { size?: number; onDark?: boolean; className?: string }) {
  const h = Math.round(size * 1.08);
  return (
    <svg
      className={`${styles.mark} ${onDark ? styles.dark : ''} ${className ?? ''}`}
      viewBox={`0 0 ${LOGO_W} ${LOGO_H}`} height={h} width={Math.round((h * LOGO_W) / LOGO_H)}
      role="img" aria-label="BeautyFind" focusable="false"
    >
      <path className={styles.beauty} d={LOGO_BEAUTY} />
      <path className={styles.find} d={LOGO_FIND} />
    </svg>
  );
}
