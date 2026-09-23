import { requireArea } from '@/lib/server/biz';
import { saveUpload } from '@/lib/server/media';

// Profile image upload (cover, logo, gallery). A route handler rather than a server action so the
// client can report real upload progress, and because server actions cap request bodies at 1MB
// by default while uploads go up to 8MB.
// The returned URL is only a candidate: the branch changes when the profile is published, and
// the publish action checks that every URL belongs to this business.

export type UploadResponse = { ok: true; url: string } | { ok: false; error: 'type' | 'size' | 'empty' | 'forbidden' | 'server' };

const json = (body: UploadResponse, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  // Same-origin only: the session cookie must not be usable from another site's form.
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return json({ ok: false, error: 'forbidden' }, 403);

  let ctx;
  try {
    ctx = await requireArea('profile', 'edit');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('forbidden')) return json({ ok: false, error: 'forbidden' }, 403);
    throw e; // redirect to login and the like
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: 'empty' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return json({ ok: false, error: 'empty' }, 400);
  const alt = String(form.get('alt') ?? '').slice(0, 200) || undefined;

  try {
    const res = await saveUpload(file, { ownerId: ctx.user.id, businessId: ctx.business.id, alt });
    if (!res.ok) return json({ ok: false, error: res.error }, 400);
    return json({ ok: true, url: res.url });
  } catch (e) {
    console.error('[biz/profile] upload failed', e);
    return json({ ok: false, error: 'server' }, 500);
  }
}
