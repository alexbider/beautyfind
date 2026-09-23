import styles from './Wordmark.module.css';

/** The latin `beautyfind.` wordmark: Jost 300, navy + teal split, teal period. Always LTR. */
export function Wordmark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span dir="ltr" className={`${styles.mark} ${onDark ? styles.dark : ''}`} style={{ fontSize: size }}>
      beauty<span className={styles.accent}>find</span><span className={`${styles.accent} ${styles.dot}`}>.</span>
    </span>
  );
}
