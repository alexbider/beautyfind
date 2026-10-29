import { NextResponse } from 'next/server';
import { unsubscribeToken } from '@/components/unsubscribe/token';
import { branchByCode, branchMobile } from '@/lib/server/welcomeSms';

// Short opt-out link from the welcome SMS (beautyfind.co.il/u/<code>): opens the regular unsubscribe page
// for the mobile that message went to, scope all, channel sms. The page itself confirms before saving.

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const b = await branchByCode(code.toLowerCase()).catch(() => null);
  const mobile = b ? branchMobile(b) : null;
  if (!mobile) return NextResponse.redirect(new URL('/', req.url), 302);
  return NextResponse.redirect(new URL(`/unsubscribe/${unsubscribeToken({ contact: mobile, scope: 'all', channel: 'sms' })}`, req.url), 302);
}
