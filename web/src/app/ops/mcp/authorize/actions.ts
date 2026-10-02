'use server';

import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { redirectAllowed, redirectWith, validRedirectUri } from '@/lib/mcp';
import { createAuthCode, getClient } from '@/lib/server/mcp';

// The staff member's decision on /ops/mcp/authorize. Approving mints a one-time code and sends the
// browser back to the app; refusing sends the OAuth access_denied error. Everything is re-validated
// here, so the page's query cannot be tampered with between render and click.

const Input = z.object({ clientId: z.string().uuid(), redirectUri: z.string().max(2000), codeChallenge: z.string().regex(/^[A-Za-z0-9\-_]{43}$/), state: z.string().max(2000).optional(), approve: z.boolean() });

export async function decideAuthorizeAction(input: z.input<typeof Input>): Promise<{ ok: true; redirect: string } | { ok: false; error: string }> {
  const user = await areaUserOrNull('ai', 'view');
  if (!user) return { ok: false, error: 'ההתחברות פגה. רעננו את העמוד והיכנסו שוב.' };
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'בקשה לא תקינה' };
  const client = await getClient(p.data.clientId);
  if (!client || !validRedirectUri(p.data.redirectUri) || !redirectAllowed(client.redirectUris, p.data.redirectUri)) return { ok: false, error: 'האפליקציה או כתובת החזרה אינן מאושרות' };
  if (!p.data.approve) return { ok: true, redirect: redirectWith(p.data.redirectUri, { error: 'access_denied', error_description: 'the staff member refused', state: p.data.state }) };
  const code = await createAuthCode(user, client, { clientId: client.id, redirectUri: p.data.redirectUri, codeChallenge: p.data.codeChallenge, state: p.data.state });
  return { ok: true, redirect: redirectWith(p.data.redirectUri, { code, state: p.data.state }) };
}
