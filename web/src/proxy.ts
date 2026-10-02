import { NextResponse, userAgent, type NextRequest } from 'next/server';

// The home page has two layouts (desktop and phone) and only one may be in a response, so the HTML has
// one H1 and each section once. Phones get the phone route rewritten under /; everyone else gets the
// desktop route. A direct visit to /home/* goes back to /, so the phone route never has its own address.

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/home/') || pathname === '/home') return NextResponse.redirect(new URL('/', request.url), 308);
  if (pathname === '/' && userAgent(request).device.type === 'mobile') {
    const url = request.nextUrl.clone();
    url.pathname = '/home/phone';
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/home/:path*'] };
