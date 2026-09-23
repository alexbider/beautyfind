'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CATEGORIES } from '@/lib/catalog';
import { toE164 } from '@/lib/format';
import { requireArea } from '@/lib/server/biz';
import { db } from '@/lib/server/db';
import { GAL_TAGS, MAX_GALLERY, normalizeInstagram, validateProfile, type FieldKey, type ProfileForm } from '@/components/dashboard/profile/shared';

export type SaveProfileResult =
  | { ok: true }
  | { ok: false; error: string; errors?: Partial<Record<FieldKey, string>> };

const str = (max: number) => z.string().max(max);

const Payload = z.object({
  name: str(200), cats: z.array(z.enum(CATEGORIES.map(c => c.slug) as [string, ...string[]])).max(CATEGORIES.length),
  address: str(300), phone: str(30), whatsapp: str(30), email: str(200), instagram: str(60), description: str(2000),
  wazeOn: z.boolean(), wazeUrl: str(600),
  accessible: z.boolean(), freeParking: z.boolean(), onlineBooking: z.boolean(),
  hours: z.array(z.object({ open: str(5), close: str(5), closed: z.boolean() })).length(7),
  coverUrl: str(80), coverAlt: str(300), logoUrl: str(80),
  gallery: z.array(z.object({ url: str(80), alt: str(300), tag: z.enum(GAL_TAGS) })).max(MAX_GALLERY),
});

export async function saveProfile(input: ProfileForm): Promise<SaveProfileResult> {
  const ctx = await requireArea('profile', 'edit');
  const branch = ctx.branch;
  if (!branch) return { ok: false, error: 'לא נמצא סניף לעריכה.' };

  const parsed = Payload.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'חלק מהפרטים אינם תקינים. רעננו את הדף ונסו שוב.' };
  const f = parsed.data as ProfileForm;

  const v = validateProfile(f);
  if (!v.ok) return { ok: false, error: 'יש שדות שדורשים תיקון.', errors: v.errors };

  // Images: anything new must be a public upload of this business. URLs already on the branch stay valid.
  const current = new Set<string>([branch.coverUrl, branch.logoUrl, ...galleryUrls(branch.gallery)].filter((u): u is string => !!u));
  const fresh = [...new Set([f.coverUrl, f.logoUrl, ...f.gallery.map(g => g.url)].filter(u => u && !current.has(u)))];
  if (fresh.length) {
    const ids = fresh.map(u => u.slice('/media/'.length));
    const owned = await db.mediaFile.count({ where: { id: { in: ids }, businessId: ctx.business.id, isPrivate: false } });
    if (owned !== ids.length) return { ok: false, error: 'אחת התמונות אינה שייכת לעסק. העלו אותה מחדש.', errors: { media: 'תמונה לא מוכרת' } };
  }

  const name = f.name.trim();
  const hours = f.hours.map(h => (h.closed ? { open: '', close: '', closed: true } : { open: h.open, close: h.close, closed: false }));

  try {
    await db.$transaction(async tx => {
      await tx.branch.update({
        where: { id: branch.id },
        data: {
          name,
          address: f.address.trim(),
          phone: toE164(f.phone),
          whatsapp: f.whatsapp.trim() ? toE164(f.whatsapp) : null,
          email: f.email.trim().toLowerCase() || null,
          instagram: normalizeInstagram(f.instagram) || null,
          description: f.description.trim() || null,
          wazeUrl: f.wazeOn ? f.wazeUrl.trim() : null,
          accessible: f.accessible,
          freeParking: f.freeParking,
          onlineBooking: f.onlineBooking,
          hours,
          coverUrl: f.coverUrl || null,
          coverAlt: f.coverUrl ? f.coverAlt.trim() : null,
          logoUrl: f.logoUrl || null,
          gallery: f.gallery.map(g => ({ url: g.url, alt: g.alt.trim(), tag: g.tag })),
        },
      });
      // Categories: replace the set. Treatments keep their own category; the menu tab flags mismatches.
      await tx.branchCategory.deleteMany({ where: { branchId: branch.id, categorySlug: { notIn: f.cats } } });
      await tx.branchCategory.createMany({ data: f.cats.map(slug => ({ branchId: branch.id, categorySlug: slug })), skipDuplicates: true });
    });
  } catch (e) {
    console.error('[biz/profile] save failed', e);
    return { ok: false, error: 'השמירה נכשלה. השינויים עדיין כאן, נסו שוב בעוד רגע.' };
  }

  revalidatePath('/biz', 'layout');
  return { ok: true };
}

function galleryUrls(g: unknown): string[] {
  if (!Array.isArray(g)) return [];
  return g.map(x => (x && typeof x === 'object' && typeof (x as { url?: unknown }).url === 'string' ? (x as { url: string }).url : '')).filter(Boolean);
}
