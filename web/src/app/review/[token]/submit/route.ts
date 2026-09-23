import { PHOTO_SLOTS, type PhotoKind } from '@/components/review/shared';
import { submitReviewCore, type SubmitResult } from '../review';

// POST /review/[token]/submit: multipart (a `data` JSON field + photo_before / photo_after / photo_place).
// A route handler rather than a server action because up to three 8MB photos exceed the action body limit.

const json = (body: SubmitResult, status = 200) => Response.json(body, { status });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  // Same-origin only.
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return json({ ok: false, error: 'not_found' }, 403);

  const { token } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: 'invalid' }, 400);
  }
  let data: unknown;
  try {
    data = JSON.parse(String(form.get('data') ?? ''));
  } catch {
    return json({ ok: false, error: 'invalid' }, 400);
  }
  const files: Partial<Record<PhotoKind, File>> = {};
  for (const s of PHOTO_SLOTS) {
    const f = form.get(`photo_${s.kind}`);
    if (f instanceof File && f.size > 0) files[s.kind] = f;
  }

  try {
    const res = await submitReviewCore(token, data, files);
    return json(res, res.ok ? 200 : res.error === 'server' ? 500 : 400);
  } catch (e) {
    console.error('[review] submit failed', e);
    return json({ ok: false, error: 'server' }, 500);
  }
}
