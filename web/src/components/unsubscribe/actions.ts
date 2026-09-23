'use server';

import { db } from '@/lib/server/db';
import { contactsFor } from './data';
import { isChannel, openJson, parseUnsubscribeToken, signJson, type Channel } from './token';

// Unsubscribe writes (05-messages.md): per clinic or all, per channel, effective immediately.
// Works without login: the signed token is the proof. Service messages ignore MessageConsent.

// Row ids only (never contacts): the undo payload travels through the browser.
type Prev = { id: string; prev: { marketing: boolean; source: string } | null };
type UndoPayload = { rows: Prev[]; exp: number };

export type UnsubResult = { ok: true; undo: string } | { ok: false; error: 'invalid_link' | 'no_channel' };

export async function unsubscribeAction(token: string, scopeChoice: 'clinic' | 'all', channels: string[]): Promise<UnsubResult> {
  const t = parseUnsubscribeToken(token);
  if (!t) return { ok: false, error: 'invalid_link' };
  const avail = await contactsFor(t);
  const chosen = [...new Set(Array.isArray(channels) ? channels : [])].filter((c): c is Channel => isChannel(c) && !!avail.contacts[c]);
  if (!chosen.length) return { ok: false, error: 'no_channel' };
  const scope = scopeChoice === 'all' || t.scope === 'all' ? 'all' : t.scope;

  const prev: Prev[] = [];
  await db.$transaction(async tx => {
    for (const ch of chosen) {
      const contact = avail.contacts[ch]!;
      const existing = await tx.messageConsent.findUnique({ where: { contact_scope_channel: { contact, scope, channel: ch } } });
      const row = await tx.messageConsent.upsert({
        where: { contact_scope_channel: { contact, scope, channel: ch } },
        create: { contact, scope, channel: ch, marketing: false, source: 'unsubscribe', userId: avail.userId },
        update: { marketing: false, source: 'unsubscribe' },
      });
      prev.push({ id: row.id, prev: existing ? { marketing: existing.marketing, source: existing.source } : null });
      if (scope === 'all') {
        // "All" also withdraws every per-clinic opt-in on this channel, so no sender reads a stale yes.
        const optedIn = await tx.messageConsent.findMany({ where: { contact, channel: ch, scope: { not: 'all' }, marketing: true } });
        for (const r of optedIn) prev.push({ id: r.id, prev: { marketing: true, source: r.source } });
        await tx.messageConsent.updateMany({ where: { contact, channel: ch, scope: { not: 'all' }, marketing: true }, data: { marketing: false, source: 'unsubscribe' } });
      }
    }
  });
  return { ok: true, undo: signJson({ rows: prev, exp: Date.now() + 60 * 60_000 } satisfies UndoPayload) };
}

/** "טעות, להחזיר": restores exactly the rows the last unsubscribe changed (signed, valid for an hour). */
export async function undoUnsubscribeAction(undo: string): Promise<{ ok: boolean }> {
  const p = openJson<UndoPayload>(undo);
  if (!p || !Array.isArray(p.rows) || typeof p.exp !== 'number' || p.exp < Date.now()) return { ok: false };
  await db.$transaction(async tx => {
    for (const r of p.rows) {
      if (typeof r?.id !== 'string') continue;
      if (r.prev) await tx.messageConsent.updateMany({ where: { id: r.id }, data: { marketing: !!r.prev.marketing, source: String(r.prev.source) } });
      else await tx.messageConsent.deleteMany({ where: { id: r.id } });
    }
  });
  return { ok: true };
}
