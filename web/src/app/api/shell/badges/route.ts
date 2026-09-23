import { NextResponse } from 'next/server';
import { clinicLevel, isAdvanced } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { currentUser } from '@/lib/server/session';

// Tab bar badge counts (spec §2.2): waitlist offers for a client, new leads for a business,
// new consult requests for the clinic. Only counts, never content. Anonymous → {}.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = new URL(req.url).searchParams.get('v');
  const user = await currentUser();
  if (!user) return NextResponse.json({});
  const headers = { 'Cache-Control': 'private, no-store' };

  if (v === 'client') {
    const waitlist = await db.waitlistOffer.count({ where: { status: 'sent', holdUntil: { gt: new Date() }, entry: { clientUserId: user.id } } });
    return NextResponse.json({ waitlist }, { headers });
  }

  if ((v === 'business' || v === 'clinic') && user.kind === 'business') {
    // Lazy import: bizContext redirects when there is no business membership; a badge call must not.
    const member = await db.staffMember.findFirst({ where: { userId: user.id, status: 'active' }, orderBy: { createdAt: 'asc' } });
    if (!member) return NextResponse.json({}, { headers });
    if (v === 'business') {
      const leads = await db.lead.count({ where: { businessId: member.businessId, stage: 'new' } });
      return NextResponse.json({ leads }, { headers });
    }
    if (!(await isAdvanced(member.businessId)) || clinicLevel({ preview: null, member }, 'consults') === 'none') return NextResponse.json({}, { headers });
    const consults = await db.consultRequest.count({ where: { status: 'new', branch: { businessId: member.businessId } } });
    return NextResponse.json({ consults }, { headers });
  }
  return NextResponse.json({}, { headers });
}
