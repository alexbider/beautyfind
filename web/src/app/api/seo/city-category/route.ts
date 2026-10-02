import { cityCategoryReport } from '@/lib/server/cityCategoryReport';

// The city + category page counts (src/lib/server/cityCategoryReport.ts) as JSON, for checking a preview
// deployment against the data it runs on. Aggregate numbers only, and only off production: the
// production deployment answers 404. ?rows=1 adds the per-page counts.

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === 'production') return new Response(null, { status: 404 });
  const report = await cityCategoryReport();
  const withRows = new URL(req.url).searchParams.get('rows') === '1';
  return Response.json(withRows ? report : { ...report, rows: undefined }, { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
