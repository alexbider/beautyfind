import styles from './Lists.module.css';

// Skeletons instead of spinners for anything over 300ms (spec §4). Reserve the real layout size.
export function Skeleton({ width = '100%', height = 14, radius = 8, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span aria-hidden="true" className={`${styles.skel} ${className ?? ''}`} style={{ width, height, borderRadius: radius }} />;
}

/** A list row placeholder: 64–72px, avatar + two lines. */
export function SkeletonRow() {
  return (
    <div className={styles.skelRow} aria-hidden="true">
      <Skeleton width={44} height={44} radius={22} />
      <span className={styles.skelLines}>
        <Skeleton width="62%" height={14} />
        <Skeleton width="40%" height={12} />
      </span>
    </div>
  );
}
