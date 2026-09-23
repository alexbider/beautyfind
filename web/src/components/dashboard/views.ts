import 'server-only';
import type { BizContext } from '@/lib/server/biz';
import { DASH_VIEWS } from './nav';

/** Dashboard sections this viewer may open (side rail on desktop, "עוד" on phones). */
export function visibleViews(ctx: Pick<BizContext, 'member' | 'preview' | 'perms'>) {
  const isOwnerView = ctx.member.isOwner && !ctx.preview;
  // payments has no area of its own: it follows billing, and only for roles that can edit billing.
  return DASH_VIEWS.filter(v => (v.key === 'team' ? isOwnerView : v.href === '/biz/payments' ? ctx.perms.billing === 'edit' : ctx.perms[v.key] !== 'none'));
}
