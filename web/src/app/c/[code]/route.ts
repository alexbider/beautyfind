import { NextResponse } from 'next/server';
import { profileHref } from '@/lib/category';
import { branchByCode } from '@/lib/server/welcomeSms';

// Short profile link from the welcome SMS (beautyfind.co.il/c/<8 hex of the branch id>). Unknown or
// unpublished codes land on the home page.

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const b = await branchByCode(code.toLowerCase()).catch(() => null);
  const target = b && b.status === 'live' ? profileHref(b) : '/';
  return NextResponse.redirect(new URL(target, req.url), 302);
}
