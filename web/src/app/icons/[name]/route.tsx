import { appIcon } from '@/lib/ui/app-icon';

// /icons/192.png, /icons/512.png, /icons/maskable-192.png, /icons/maskable-512.png
const SIZES: Record<string, { size: number; maskable?: boolean }> = {
  '192.png': { size: 192 },
  '512.png': { size: 512 },
  'maskable-192.png': { size: 192, maskable: true },
  'maskable-512.png': { size: 512, maskable: true },
};

export const dynamic = 'force-static';
export function generateStaticParams() {
  return Object.keys(SIZES).map(name => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const spec = SIZES[(await params).name];
  if (!spec) return new Response('Not found', { status: 404 });
  return appIcon(spec.size, { maskable: spec.maskable });
}
