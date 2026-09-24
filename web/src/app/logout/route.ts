import { NextResponse } from 'next/server';
import { ROUTES } from '@/lib/routes';
import { destroySession } from '@/lib/server/session';

// POST only, so a prefetch or a crawled link can never sign anyone out.
export async function POST(req: Request) {
  await destroySession();
  // Staff sign out back to the staff login; everyone else goes home. Only this one target is allowed.
  const form = await req.formData().catch(() => null);
  const to = form?.get('to') === '/ops/login' ? '/ops/login' : ROUTES.home;
  // 303 turns the POST into a GET.
  return NextResponse.redirect(new URL(to, req.url), 303);
}
