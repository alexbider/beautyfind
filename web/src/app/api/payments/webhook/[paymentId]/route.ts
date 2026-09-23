import { handleWebhook } from '@/lib/server/money';

// Provider → BeautyFind payment confirmation. The adapter authenticates the request against the
// business's own connection; anything it can't verify is rejected.
export async function POST(req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) return new Response(null, { status: 404 });
  const raw = await req.text();
  try {
    await handleWebhook(paymentId, req, raw);
    return new Response(null, { status: 204 });
  } catch (e) {
    console.warn('[payments] webhook rejected', paymentId, (e as Error).message);
    return new Response(null, { status: 400 });
  }
}
