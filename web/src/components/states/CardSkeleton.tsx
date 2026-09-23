import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "טעינה".
// Rule: a skeleton in the shape of the final result (no layout jump); the spinner is only a caption.

const WIDTHS = [
  ['72%', '54%', '38%'],
  ['61%', '48%', '44%'],
  ['80%', '58%', '33%'],
  ['66%', '42%', '50%'],
];

export function CardSkeleton({ count = 4, caption = 'טוען…' }: { count?: number; caption?: string }) {
  return (
    <div>
      <div className={styles.skeletons} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => {
          const w = WIDTHS[i % WIDTHS.length];
          return (
            <div key={i} className={styles.skel}>
              <div className={styles.skelMedia} />
              <div className={styles.skelBody}>
                {w.map((width, j) => (
                  <span key={j} className={styles.skelLine} style={{ width }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p role="status" className={styles.loadingCaption}>
        <span aria-hidden="true" className={styles.spinner} />
        <span>{caption}</span>
      </p>
    </div>
  );
}
