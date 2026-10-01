import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { csvEscape, expenses, ledger, LEDGER_FILTERS, type LedgerFilter } from '../data';

export const dynamic = 'force-dynamic';

// CSV for the accountant: platform documents or expenses, optionally in a date range. Staff only.
export async function GET(req: Request) {
  const user = await areaUserOrNull('accounting', 'view');
  if (!user) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'expenses' ? 'expenses' : 'documents';
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined;
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined;
  const f = url.searchParams.get('filter') ?? 'all';
  const filter = (LEDGER_FILTERS.some(x => x.key === f) ? f : 'all') as LedgerFilter;
  let csv: string;
  if (kind === 'documents') {
    const rows = await ledger({ filter, q: '', from: from && !Number.isNaN(from.getTime()) ? from : undefined, to: to && !Number.isNaN(to.getTime()) ? to : undefined, take: 10_000 });
    csv = [['number', 'issued_at', 'customer', 'description', 'kind', 'net_nis', 'vat_nis', 'gross_nis', 'status', 'sent_to'].join(','), ...rows.map(r => [r.number, r.issuedAt.toISOString(), r.customer, r.description, r.kind, r.netAgorot / 100, r.vatAgorot / 100, r.grossAgorot / 100, r.status, r.sentTo].map(csvEscape).join(','))].join('\n');
  } else {
    const rows = (await expenses(from && !Number.isNaN(from.getTime()) ? from : undefined)).filter(e => !to || Number.isNaN(to.getTime()) || e.date < to);
    csv = [['date', 'vendor', 'description', 'category', 'net_nis', 'vat_nis', 'gross_nis', 'receipt'].join(','), ...rows.map(e => [e.date.toISOString().slice(0, 10), e.vendor, e.description, e.category, e.netAgorot / 100, e.vatAgorot / 100, (e.netAgorot + e.vatAgorot) / 100, e.receiptUrl].map(csvEscape).join(','))].join('\n');
  }
  await db.auditLog.create({ data: { actorId: user.id, action: 'accounting_export', subjectType: 'document', subjectId: user.id, meta: { kind, filter, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null } } });
  return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="beautyfind-${kind}.csv"`, 'Cache-Control': 'private, no-store' } });
}
