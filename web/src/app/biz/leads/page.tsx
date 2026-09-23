import type { Metadata } from 'next';
import { tabGuard } from '@/components/dashboard/guard';
import { LeadsBoard } from '@/components/dashboard/leads/LeadsBoard';
import { fmtDateOnly, fmtStamp, type LeadDTO } from '@/components/dashboard/leads/shared';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { db } from '@/lib/server/db';

// Design: project/BeautyFind Dashboard.dc.html (isLeads)

export const metadata: Metadata = { title: 'ניהול לקוחות' };

const MAX_LEADS = 1000;

export default async function LeadsPage() {
  const ctx = await tabGuard('leads');

  const rows = await db.lead.findMany({
    where: { businessId: ctx.business.id },
    include: { events: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: MAX_LEADS,
  });

  const leads: LeadDTO[] = rows.map(l => {
    const last = l.events.at(-1)?.createdAt ?? l.createdAt;
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      city: l.city,
      treatment: l.treatment,
      source: l.source,
      stage: l.stage,
      value: l.valueAgorot != null ? Math.round(l.valueAgorot / 100) : null,
      nextAction: l.nextAction,
      nextDate: l.nextDate ? fmtDateOnly(l.nextDate) : null,
      notes: l.notes ?? '',
      lastWhen: fmtStamp(last),
      events: l.events.map(e => ({ id: e.id, kind: e.kind, text: e.text, when: fmtStamp(e.createdAt) })),
    };
  });

  return (
    <>
      {!ctx.canEdit && <ReadOnlyBanner roleName={ctx.roleName} />}
      <LeadsBoard leads={leads} canEdit={ctx.canEdit} />
    </>
  );
}
