import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { saveUpload } from '@/lib/server/media';

// Image upload for the admin branch editor (cover, logo, gallery). The file is stored under the
// business so the save action's ownership check accepts it; the staff member is the uploader.

type UploadResponse = { ok: true; url: string } | { ok: false; error: 'type' | 'size' | 'empty' | 'forbidden' | 'server' };
const json = (body: UploadResponse, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return json({ ok: false, error: 'forbidden' }, 403);
  const user = await areaUserOrNull('businesses', 'edit');
  if (!user) return json({ ok: false, error: 'forbidden' }, 403);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: 'empty' }, 400);
  }
  const businessId = z.string().uuid().safeParse(form.get('businessId'));
  if (!businessId.success || !(await db.business.findUnique({ where: { id: businessId.data }, select: { id: true } }))) return json({ ok: false, error: 'forbidden' }, 403);
  const file = form.get('file');
  if (!(file instanceof File)) return json({ ok: false, error: 'empty' }, 400);
  const alt = String(form.get('alt') ?? '').slice(0, 200) || undefined;
  try {
    const res = await saveUpload(file, { ownerId: user.id, businessId: businessId.data, alt });
    if (!res.ok) return json({ ok: false, error: res.error }, 400);
    return json({ ok: true, url: res.url });
  } catch (e) {
    console.error('[ops/businesses/upload]', e);
    return json({ ok: false, error: 'server' }, 500);
  }
}
