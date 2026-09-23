import { NextResponse } from 'next/server';
import { cleanIds, clientUser, savedIdsOf } from '@/components/saved/data';
import { setSavedAction } from '@/components/saved/actions';

// GET  /saved/api → { signedIn, ids } for the save hearts (guests get signedIn: false and use localStorage).
// POST /saved/api { branchId, saved } → save / unsave for the signed-in client.

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const user = await clientUser();
  if (!user) return NextResponse.json({ signedIn: false, ids: [] }, { headers: noStore });
  const rows = await savedIdsOf(user.id);
  return NextResponse.json({ signedIn: true, ids: rows.map(r => r.branchId) }, { headers: noStore });
}

export async function POST(req: Request) {
  // Same-origin only: the session cookie is SameSite=Lax, and this refuses cross-site form posts outright.
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ ok: false }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const [id] = cleanIds([o.branchId], 1);
  if (!id || typeof o.saved !== 'boolean') return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  const res = await setSavedAction(id, o.saved);
  return NextResponse.json(res, { status: res.ok ? 200 : res.reason === 'signed_out' ? 401 : 404, headers: noStore });
}
