import type { Metadata } from 'next';
import { setupState } from './state';
import { SetupForm } from './SetupForm';

export const metadata: Metadata = {
  title: 'הגדרת סיסמת מנהל',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SetupPage({ searchParams }: { searchParams: SP }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  const s = await setupState(token);
  return <SetupForm token={token} email={s.ok ? s.email : null} />;
}
