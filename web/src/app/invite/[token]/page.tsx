import type { Metadata } from 'next';
import { fromE164 } from '@/lib/format';
import { currentUser } from '@/lib/server/session';
import { isMember, loadInvite, viewerFor } from './invite';
import { InviteScreen, type ScreenInvite, type ScreenState, type ScreenViewer } from './InviteScreen';
import { ilDate, roleSummary } from './shared';

// Design: project/BeautyFind Staff Invite.dc.html

export const metadata: Metadata = {
  title: 'הצטרפות לצוות',
  description: 'הצטרפות לצוות קליניקה ב־BeautyFind: קבלת הזמנה, אימות טלפון והרשאות לפי תפקיד.',
  robots: { index: false, follow: false },
  // The token is in the path: never hand it to another site in a Referer header.
  referrer: 'no-referrer',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await loadInvite(token);
  if (!inv) return <InviteScreen token={null} state="notfound" invite={null} viewer={null} />;

  const invite: ScreenInvite = {
    email: inv.email,
    name: inv.name,
    bizName: inv.bizName,
    city: inv.city,
    staffCount: inv.staffCount,
    inviterName: inv.inviterName,
    sent: ilDate(inv.sentAt),
    expires: ilDate(inv.expiresAt),
    role: roleSummary(inv.preset, inv.permissions),
  };

  let state: ScreenState = inv.state;
  let viewer: ScreenViewer | null = null;
  if (inv.state === 'valid') {
    const v = await viewerFor(inv, await currentUser());
    if (v.mode === 'new') viewer = { mode: 'new', need: v.need, knownName: null, knownPhone: null };
    else if (v.mode === 'self') {
      if (await isMember(inv.businessId, v.user.id)) state = 'member';
      viewer = {
        mode: 'self',
        need: v.need,
        knownName: v.need.name ? null : v.user.fullName,
        knownPhone: !v.need.phone && v.user.phone ? fromE164(v.user.phone) : null,
      };
    } else viewer = v;
  }

  return <InviteScreen token={state === 'valid' || state === 'expired' || state === 'declined' ? token : null} state={state} invite={invite} viewer={viewer} />;
}
