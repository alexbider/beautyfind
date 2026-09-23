import Link from 'next/link';
import type { ReactNode } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { Wordmark } from '@/components/Wordmark';
import { ROUTES } from '@/lib/routes';
import { plMinutes } from './shared';
import styles from './Waitlist.module.css';

// Server-safe building blocks for the public waitlist pages (join, offer, leave).

export const Ltr = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span dir="ltr" className={`ltr ${className ?? ''}`}>
    {children}
  </span>
);

export const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 7.5 5.5 10.5 11.5 4" />
  </svg>
);

export const ArrowIcon = () => (
  <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 7H2M6 3 2 7l4 4" />
  </svg>
);

export const WaIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z" />
  </svg>
);

export const PhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);

/**
 * Page frame for the client-facing waitlist pages: wordmark header, optional account link.
 * In the app shell the header gives way to a flow top bar (tab bar hidden, × closes to `closeHref`).
 */
export function PublicShell({
  children,
  accountLink = false,
  title,
  closeHref = ROUTES.home,
}: {
  children: ReactNode;
  accountLink?: boolean;
  title: string;
  closeHref?: string;
}) {
  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <TopBar mode="flow" noBack title={title} closeHref={closeHref} />
      <header className={`${styles.header} bf-desk-only`}>
        <div className={styles.headerInner}>
          <Link href={ROUTES.home} className={styles.logo} aria-label="BeautyFind, לדף הבית">
            <Wordmark size={21} />
          </Link>
          <span className={styles.spacer} />
          {accountLink && (
            <Link href={ROUTES.account} className={styles.headLink}>
              <ArrowIcon />
              <span>לחשבון שלי</span>
            </Link>
          )}
        </div>
      </header>
      <main className={styles.wrap}>{children}</main>
    </div>
  );
}

/** A simple state card (not found, closed, basic plan). */
export function StateCard({ title, children, actions, plain = true }: { title: string; children?: ReactNode; actions?: ReactNode; plain?: boolean }) {
  return (
    <div className={`${styles.done} ${plain ? styles.plain : ''}`}>
      <h1 className={styles.doneH}>{title}</h1>
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export const waHref = (e164: string, text?: string) => `https://wa.me/${e164.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const telHref = (e164: string) => 'tel:' + e164.replace(/\s/g, '');

/** "30 דקות" with the number isolated. */
export function HoldText({ minutes }: { minutes: number }) {
  const t = plMinutes(minutes);
  const m = /^(\d+) (.*)$/.exec(t);
  return m ? (
    <>
      <Ltr>{m[1]}</Ltr> {m[2]}
    </>
  ) : (
    <>{t}</>
  );
}
