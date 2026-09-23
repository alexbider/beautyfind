import type { Metadata } from 'next';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { ProfileEditor, type Responsible } from '@/components/dashboard/profile/ProfileEditor';
import { GAL_TAGS, isGalTag, type GalleryItem, type HoursRow, type ProfileForm } from '@/components/dashboard/profile/shared';
import { fromE164 } from '@/lib/format';
import { db } from '@/lib/server/db';

// Design: project/BeautyFind Dashboard.dc.html (isProfile)

export const metadata: Metadata = { title: 'עריכת פרופיל' };

const DEFAULT_HOURS: HoursRow[] = [
  ...Array.from({ length: 4 }, () => ({ open: '09:00', close: '19:00', closed: false })),
  { open: '09:00', close: '20:00', closed: false },
  { open: '09:00', close: '13:00', closed: false },
  { open: '', close: '', closed: true },
];

export default async function ProfilePage() {
  const ctx = await tabGuard('profile');
  const banner = !ctx.canEdit && <ReadOnlyBanner roleName={ctx.roleName} />;
  if (!ctx.branch) return <>{banner}<p>לא נמצא סניף לעריכה.</p></>;

  const b = await db.branch.findUniqueOrThrow({
    where: { id: ctx.branch.id },
    include: { categories: true, medicalResponsible: { include: { license: true } } },
  });

  const initial: ProfileForm = {
    name: b.name,
    cats: b.categories.map(c => c.categorySlug),
    address: b.address,
    phone: b.phone ? fromE164(b.phone) : '',
    whatsapp: b.whatsapp ? fromE164(b.whatsapp) : '',
    email: b.email ?? '',
    instagram: b.instagram ? `@${b.instagram}` : '',
    description: b.description ?? '',
    wazeOn: !!b.wazeUrl,
    wazeUrl: b.wazeUrl ?? '',
    accessible: b.accessible,
    freeParking: b.freeParking,
    onlineBooking: b.onlineBooking,
    hours: readHours(b.hours),
    coverUrl: b.coverUrl ?? '',
    coverAlt: b.coverAlt ?? '',
    logoUrl: b.logoUrl ?? '',
    gallery: readGallery(b.gallery),
  };

  const m = b.medicalResponsible;
  const responsible: Responsible | null = m
    ? {
        name: m.displayName,
        isDoctor: m.profession === 'doctor',
        license: m.license?.number ?? null,
        verified: m.license?.status === 'verified',
      }
    : null;

  return (
    <>
      {banner}
      <ProfileEditor initial={initial} canEdit={ctx.canEdit} cityName={b.cityName} responsible={responsible} />
    </>
  );
}

function readHours(raw: unknown): HoursRow[] {
  if (!Array.isArray(raw) || raw.length !== 7) return DEFAULT_HOURS.map(h => ({ ...h }));
  return raw.map((h, i) => {
    const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
    return {
      open: typeof o.open === 'string' ? o.open : DEFAULT_HOURS[i].open,
      close: typeof o.close === 'string' ? o.close : DEFAULT_HOURS[i].close,
      closed: typeof o.closed === 'boolean' ? o.closed : DEFAULT_HOURS[i].closed,
    };
  });
}

function readGallery(raw: unknown): GalleryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(g => {
    const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
    if (typeof o.url !== 'string' || !o.url) return [];
    return [{ url: o.url, alt: typeof o.alt === 'string' ? o.alt : '', tag: isGalTag(o.tag) ? o.tag : GAL_TAGS[0] }];
  });
}
