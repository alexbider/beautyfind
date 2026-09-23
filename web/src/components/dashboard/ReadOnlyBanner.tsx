import styles from './ReadOnlyBanner.module.css';

/** Shown on a tab when the viewer's level for that area is `view`. */
export function ReadOnlyBanner({ roleName }: { roleName: string }) {
  return (
    <div role="status" className={styles.banner}>
      <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#9A6B20" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <rect x="4" y="8.6" width="12" height="8" rx="2.2" />
        <path d="M7 8.6V6.4a3 3 0 0 1 6 0v2.2" />
      </svg>
      <p>
        <strong>מצב צפייה.</strong> ההרשאה של {roleName} במסך הזה היא צפייה בלבד. שינויים אפשריים רק דרך המנהל הראשי.
      </p>
    </div>
  );
}
