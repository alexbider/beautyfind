// Spend control for paid provider calls.
//
//   reserve  before dispatch: atomically holds the gross maximum against the run budget and every
//            provider cap (day, month). Refused if any would be exceeded. Idempotent per requestKey.
//   commit   after a definite response: records the provider's reported cost (or the estimate).
//   release  when the call definitely did not reach the provider (validation error before sending).
//   uncertain when the outcome is unknown (timeout after sending): the estimate counts as spent and the
//            entry waits for manual reconciliation; it is never resubmitted automatically.
//
// All updates are single conditional SQL statements inside one transaction, so concurrent workers
// cannot overspend.

import type { PrismaClient } from '@prisma/client';

export class BudgetExceeded extends Error {
  constructor(public scope: string) {
    super(`budget_exceeded:${scope}`);
  }
}
export class ProviderDisabled extends Error {}

export interface Cap {
  key: string; // e.g. google:day:2026-09-25
  limitMicros: bigint;
}

export interface Reservation {
  runId: string | null;
  provider: string;
  endpoint: string;
  sku?: string | null;
  requestKey: string;
  estimateMicros: bigint;
  caps?: Cap[];
  meta?: Record<string, unknown>;
}

export const dayKey = (provider: string, d = new Date()) => `${provider}:day:${d.toISOString().slice(0, 10)}`;
export const monthKey = (provider: string, d = new Date()) => `${provider}:month:${d.toISOString().slice(0, 7)}`;

type Db = Pick<PrismaClient, '$transaction' | 'spendEntry'>;

/** Holds the estimate. Returns 'reserved', or 'exists' when this unit of work was already reserved/billed. */
export async function reserve(db: Db, r: Reservation): Promise<'reserved' | 'exists'> {
  return db.$transaction(async tx => {
    const prior = await tx.spendEntry.findUnique({ where: { requestKey: r.requestKey } });
    if (prior && prior.status !== 'released') return 'exists';
    if (r.runId) {
      const n = await tx.$executeRaw`
        UPDATE import_runs SET reserved_micros = reserved_micros + ${r.estimateMicros}
        WHERE id = ${r.runId}::uuid
          AND (budget_micros IS NULL OR spent_micros + reserved_micros + ${r.estimateMicros} <= budget_micros)`;
      if (!n) throw new BudgetExceeded('run');
    }
    for (const cap of r.caps ?? []) {
      await tx.$executeRaw`
        INSERT INTO provider_budgets (key, limit_micros, used_micros, reserved_micros, updated_at)
        VALUES (${cap.key}, ${cap.limitMicros}, 0, 0, now())
        ON CONFLICT (key) DO UPDATE SET limit_micros = EXCLUDED.limit_micros`;
      const n = await tx.$executeRaw`
        UPDATE provider_budgets SET reserved_micros = reserved_micros + ${r.estimateMicros}, updated_at = now()
        WHERE key = ${cap.key} AND used_micros + reserved_micros + ${r.estimateMicros} <= limit_micros`;
      if (!n) throw new BudgetExceeded(cap.key);
    }
    const data = {
      runId: r.runId, provider: r.provider, endpoint: r.endpoint, sku: r.sku ?? null, requestKey: r.requestKey,
      estimatedMicros: r.estimateMicros, status: 'reserved', meta: (r.meta ?? {}) as object,
    };
    if (prior) await tx.spendEntry.update({ where: { requestKey: r.requestKey }, data: { ...data, actualMicros: null, error: null } });
    else await tx.spendEntry.create({ data });
    return 'reserved';
  });
}

async function settle(db: Db, requestKey: string, status: 'committed' | 'released' | 'needs_reconciliation', spentMicros: bigint, error?: string) {
  await db.$transaction(async tx => {
    const e = await tx.spendEntry.findUnique({ where: { requestKey } });
    if (!e || e.status !== 'reserved') return; // already settled: settling twice must not double count
    const caps = ((e.meta as { caps?: string[] } | null)?.caps ?? []) as string[];
    if (e.runId) {
      await tx.$executeRaw`
        UPDATE import_runs SET reserved_micros = GREATEST(reserved_micros - ${e.estimatedMicros}, 0), spent_micros = spent_micros + ${spentMicros}
        WHERE id = ${e.runId}::uuid`;
    }
    for (const key of caps) {
      await tx.$executeRaw`
        UPDATE provider_budgets SET reserved_micros = GREATEST(reserved_micros - ${e.estimatedMicros}, 0), used_micros = used_micros + ${spentMicros}, updated_at = now()
        WHERE key = ${key}`;
    }
    await tx.spendEntry.update({
      where: { requestKey },
      data: { status, actualMicros: status === 'released' ? 0n : spentMicros, error: error?.slice(0, 500) ?? null },
    });
  });
}

/** The provider answered: record its reported cost (falls back to the estimate when it gives none). */
export const commit = (db: Db, requestKey: string, actualMicros: bigint | null, estimateMicros: bigint) =>
  settle(db, requestKey, 'committed', actualMicros ?? estimateMicros);

/** The request never left (or was rejected before billing): give the reservation back. */
export const release = (db: Db, requestKey: string, error?: string) => settle(db, requestKey, 'released', 0n, error);

/** Unknown outcome: count the estimate as spent and flag it. Never retried automatically. */
export async function uncertain(db: Db, requestKey: string, estimateMicros: bigint, error: string) {
  await settle(db, requestKey, 'needs_reconciliation', estimateMicros, error);
}

/** Reservation helper that stores the cap keys on the entry so settle() can release them. */
export function withCaps(r: Omit<Reservation, 'meta'> & { meta?: Record<string, unknown> }): Reservation {
  return { ...r, meta: { ...(r.meta ?? {}), caps: (r.caps ?? []).map(c => c.key) } };
}
