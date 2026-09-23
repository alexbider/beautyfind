import type { AccountKind } from '@prisma/client';
import { ROUTES } from '@/lib/routes';

// Where people land after auth. No 'server-only' marker: pure string logic.

/** Client home. Not in ROUTES yet. */
export const ACCOUNT_PATH = ROUTES.account;

/** Accepts only same-origin relative paths ("/x", never "//x" or "/\x"). Anything else is ignored. */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\u0000-\u001F\u007F\\]/.test(raw)) return null;
  // Never bounce back into the auth screen itself.
  if (raw === ROUTES.login || raw.startsWith(ROUTES.login + '?') || raw.startsWith(ROUTES.login + '/')) return null;
  return raw;
}

export const defaultDestination = (kind: AccountKind) => (kind === 'business' ? ROUTES.dashboard : ACCOUNT_PATH);

/**
 * Final destination after sign-in or sign-up. A business name collected at sign-up is
 * handed to onboarding only when the next step is the join flow.
 */
export function destinationFor(kind: AccountKind, next: string | null, bizName?: string): string {
  const target = safeNext(next) ?? defaultDestination(kind);
  if (!bizName) return target;
  const url = new URL(target, 'http://local');
  if (url.pathname !== ROUTES.join) return target;
  url.searchParams.set('bizName', bizName);
  return url.pathname + url.search + url.hash;
}
