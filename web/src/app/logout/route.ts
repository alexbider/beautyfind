import { NextResponse } from 'next/server';
import { ROUTES } from '@/lib/routes';
import { destroySession } from '@/lib/server/session';

// POST only, so a prefetch or a crawled link can never sign anyone out.
export async function POST(req: Request) {
  await destroySession();
  // 303 turns the POST into a GET on the home page.
  return NextResponse.redirect(new URL(ROUTES.home, req.url), 303);
}
