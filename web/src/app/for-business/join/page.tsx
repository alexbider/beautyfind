import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isPlanKey } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { currentUser } from '@/lib/server/session';
import { JoinWizard } from './JoinWizard';

// Design: project/BeautyFind Onboarding.dc.html

export const metadata: Metadata = {
  title: 'רישום עסק באינדקס',
  description: 'הצטרפות עסק ל־BeautyFind בשבעה שלבים: פרטי העסק, קטגוריות, אחריות מקצועית, טיפולים ומחירים, שעות פעילות, תמונות ואימות.',
  alternates: { canonical: ROUTES.join },
  robots: { index: false },
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawPlan = typeof sp.plan === 'string' ? sp.plan : undefined;
  const planParam = isPlanKey(rawPlan) ? rawPlan : undefined;

  const user = await currentUser();
  if (!user || user.kind !== 'business') {
    const next = ROUTES.join + (planParam ? `?plan=${planParam}` : '');
    redirect(`${ROUTES.login}?role=biz&view=signup&next=${encodeURIComponent(next)}`);
  }

  const bizName = typeof sp.bizName === 'string' ? sp.bizName.trim().slice(0, 80) : '';
  return <JoinWizard initialPlan={planParam ?? 'basic'} draftKey={`bf-join-draft:${user.id}`} initialName={bizName} />;
}
