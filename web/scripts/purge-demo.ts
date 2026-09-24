// Removes the fictional demo clinics (prisma/seed.ts LISTINGS and prisma/seed-demo.ts) and
// everything hanging off them. Runs in the Vercel build only when PURGE_DEMO=1.
//
// Demo = a business with no owner account, no Google place id on any branch, and no staff linked to a
// real user. Real sign-ups always have an owner; imported listings always have a Google place id;
// the catalog (regions, cities, categories), user accounts and the audit log are never touched.
import { PrismaClient } from '@prisma/client';

async function main() {
  if (process.env.PURGE_DEMO !== '1') return;
  const db = new PrismaClient();
  try {
    const counts = await db.$transaction(
      async tx => {
        const q = (sql: string) => tx.$executeRawUnsafe(sql);
        await q(`CREATE TEMP TABLE demo_biz ON COMMIT DROP AS
          SELECT b.id FROM businesses b
          WHERE b.owner_user_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM branches br WHERE br.business_id = b.id AND br.google_place_id IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM staff_members s WHERE s.business_id = b.id AND s.user_id IS NOT NULL)`);
        await q(`CREATE TEMP TABLE demo_branch ON COMMIT DROP AS SELECT id FROM branches WHERE business_id IN (SELECT id FROM demo_biz)`);
        await q(`CREATE TEMP TABLE demo_booking ON COMMIT DROP AS SELECT id FROM bookings WHERE branch_id IN (SELECT id FROM demo_branch)`);
        await q(`CREATE TEMP TABLE demo_card ON COMMIT DROP AS SELECT id FROM gift_cards WHERE business_id IN (SELECT id FROM demo_biz)`);
        await q(`CREATE TEMP TABLE demo_payment ON COMMIT DROP AS SELECT id FROM payments
          WHERE business_id IN (SELECT id FROM demo_biz) OR booking_id IN (SELECT id FROM demo_booking) OR gift_card_id IN (SELECT id FROM demo_card)`);
        await q(`CREATE TEMP TABLE demo_license ON COMMIT DROP AS SELECT license_id AS id FROM staff_members
          WHERE business_id IN (SELECT id FROM demo_biz) AND license_id IS NOT NULL`);

        const n: Record<string, number> = {};
        const del = async (name: string, sql: string) => (n[name] = await q(sql));
        await del('refunds', `DELETE FROM refunds WHERE payment_id IN (SELECT id FROM demo_payment)`);
        await del('documents', `DELETE FROM documents WHERE business_id IN (SELECT id FROM demo_biz) OR payment_id IN (SELECT id FROM demo_payment)`);
        await del('gift_redemptions', `DELETE FROM gift_redemptions WHERE branch_id IN (SELECT id FROM demo_branch) OR gift_card_id IN (SELECT id FROM demo_card)`);
        await del('payments', `DELETE FROM payments WHERE id IN (SELECT id FROM demo_payment)`);
        await del('gift_cards', `DELETE FROM gift_cards WHERE id IN (SELECT id FROM demo_card)`);
        await del('waitlist', `DELETE FROM waitlist_entries WHERE branch_id IN (SELECT id FROM demo_branch)`);
        await del('bookings', `DELETE FROM bookings WHERE id IN (SELECT id FROM demo_booking)`);
        await del('consults', `DELETE FROM consult_requests WHERE branch_id IN (SELECT id FROM demo_branch)`);
        await del('leads', `DELETE FROM leads WHERE business_id IN (SELECT id FROM demo_biz) OR branch_id IN (SELECT id FROM demo_branch)`);
        await del('verification_requests', `DELETE FROM verification_requests WHERE business_id IN (SELECT id FROM demo_biz) OR branch_id IN (SELECT id FROM demo_branch)`);
        await del('media_files', `DELETE FROM media_files WHERE business_id IN (SELECT id FROM demo_biz)`);
        await q(`UPDATE import_places SET branch_id = NULL WHERE branch_id IN (SELECT id FROM demo_branch)`);
        await q(`UPDATE import_places SET match_branch_id = NULL, match_score = NULL, match_reasons = '{}' WHERE match_branch_id IN (SELECT id FROM demo_branch)`);
        n.branches = Number((await tx.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*) AS c FROM demo_branch`))[0].c);
        // Cascades: branches, categories, treatments, reviews, profile events, saved, busy blocks, staff,
        // subscriptions, deposit policies, provider connections, invites.
        await del('businesses', `DELETE FROM businesses WHERE id IN (SELECT id FROM demo_biz)`);
        await del('licenses', `DELETE FROM licenses WHERE id IN (SELECT id FROM demo_license)`);
        return n;
      },
      { timeout: 120_000 },
    );
    console.log('[purge-demo] removed', JSON.stringify(counts));
  } finally {
    await db.$disconnect();
  }
}

main().catch(e => {
  // A failed purge rolls back completely; the deploy continues with the data as it was.
  console.error('[purge-demo] failed, nothing was deleted:', e instanceof Error ? e.message : e);
});
