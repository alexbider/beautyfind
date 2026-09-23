'use server';

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { toE164 } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { db } from '@/lib/server/db';
import { nextRef } from '@/lib/server/refs';
import { currentUser } from '@/lib/server/session';
import { DAY_NAMES, STEPS, matchCity, parseMinutes, parseShekels, validate, type JoinPayload, type StepKey } from './shared';

export type SubmitResult =
  | { ok: true; ref: string }
  | { ok: false; reason: 'auth' }
  | { ok: false; reason: 'invalid'; step: number; error: string }
  | { ok: false; reason: 'server'; error: string };

const str = (max: number) => z.string().max(max);

const Payload = z.object({
  plan: z.enum(['basic', 'advanced']),
  f: z.object({
    name: str(120), legal: str(160), hp: str(20), phone: str(20), wa: str(20), email: str(160),
    address: str(200), city: str(80),
    region: z.union([z.enum(REGIONS.map(r => r.slug) as [string, ...string[]]), z.literal('')]),
    bizType: z.enum(['clinic', 'medspa', 'cosmetics', '']),
    docName: str(120), docLic: str(40), docSpec: str(120), docPresence: str(160),
    proName: str(120), proCert: str(160), proYears: str(4),
  }),
  cats: z.array(z.enum(CATEGORIES.map(c => c.slug) as [string, ...string[]])).max(CATEGORIES.length),
  svcs: z.array(z.object({ id: z.number(), name: str(120), price: str(12), dur: str(6) })).max(60),
  hours: z.array(z.object({ open: str(5), close: str(5), closed: z.boolean() })).length(7),
  decl: z.array(z.enum(['accurate', 'authorized', 'standards', 'medical'])).max(4),
});

const OWNER_PERMISSIONS = {
  overview: 'edit', analytics: 'edit', profile: 'edit', menu: 'edit', reviews: 'edit', leads: 'edit', billing: 'edit', bookings: 'manage',
};

const SLA_MS = 2 * 86_400_000;

async function uniqueSlug(base: string) {
  for (let i = 0; i < 6; i++) {
    const slug = `${base}-${randomBytes(3).toString('hex')}`;
    if (!(await db.branch.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${randomBytes(6).toString('hex')}`;
}

export async function submitJoin(input: JoinPayload): Promise<SubmitResult> {
  const user = await currentUser();
  if (!user || user.kind !== 'business') return { ok: false, reason: 'auth' };

  const parsed = Payload.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid', step: 0, error: 'חלק מהפרטים אינם תקינים. בדקו את הטופס ונסו שוב.' };
  const p = parsed.data as JoinPayload;

  // Same rules as the wizard. The first failing step is where we send the user back to.
  const v = validate(p);
  const firstBad = STEPS.findIndex(s => !v.stepOk[s.key as StepKey]);
  if (firstBad >= 0) {
    const key = STEPS[firstBad].key;
    return { ok: false, reason: 'invalid', step: firstBad, error: v.errors[key] };
  }

  const f = p.f;
  const phone = toE164(f.phone)!;
  const whatsapp = f.wa.trim() ? toE164(f.wa) : null;
  const city = matchCity(f.city);
  const cityRow = city ? await db.city.findUnique({ where: { slug: city.slug }, select: { id: true } }) : null;
  const slug = await uniqueSlug(city?.slug ?? 'branch');
  const hasMedical = v.hasMedical;
  const certGiven = !hasMedical && f.proCert.trim() !== '';

  // Treatments carry a category only when it is unambiguous (a single category was picked).
  const soleCat = v.pickedCats.length === 1 ? v.pickedCats[0] : null;
  const allMedical = v.pickedCats.every(c => c.isMedical);
  const svcMedical = hasMedical && allMedical;

  const now = new Date();
  const slaDueAt = new Date(now.getTime() + SLA_MS);

  // Refs are drawn before the transaction so it stays short. A failed submit leaves a gap in the sequence.
  const bizRef = await nextRef('BIZ');
  const licRef = hasMedical ? await nextRef('LIC') : certGiven ? await nextRef('CRT') : null;

  const hours = p.hours.map(h => (h.closed ? { open: '', close: '', closed: true } : { open: h.open, close: h.close, closed: false }));

  const snapshot = {
    plan: p.plan,
    business: { name: f.name.trim(), legalName: f.legal.trim() || null, companyNo: f.hp.replace(/\D/g, ''), type: f.bizType },
    branch: {
      address: f.address.trim(), city: f.city.trim(), citySlug: city?.slug ?? null, region: f.region,
      phone, whatsapp, email: f.email.trim().toLowerCase(),
    },
    categories: v.pickedCats.map(c => c.slug),
    responsibility: hasMedical
      ? { kind: 'medical', doctorName: f.docName.trim(), licenseNumber: f.docLic.trim(), specialty: f.docSpec.trim() || null, presence: f.docPresence.trim() || null }
      : { kind: 'professional', name: f.proName.trim(), certificate: f.proCert.trim() || null, years: f.proYears.trim() || null },
    services: v.filledSvcs.map(s => ({ name: s.name.trim(), priceNis: parseShekels(s.price), durationMin: parseMinutes(s.dur) })),
    hours: hours.map((h, i) => ({ day: DAY_NAMES[i], ...h })),
    declarations: { accepted: p.decl, acceptedAt: now.toISOString() },
  };

  try {
    await db.$transaction(async tx => {
      const business = await tx.business.create({
        data: {
          type: f.bizType as 'clinic' | 'medspa' | 'cosmetics',
          legalName: f.legal.trim() || null,
          companyNo: f.hp.replace(/\D/g, ''),
          ownerUserId: user.id,
          status: 'pending',
        },
      });

      const branch = await tx.branch.create({
        data: {
          businessId: business.id,
          name: f.name.trim(),
          slug,
          regionSlug: f.region as (typeof REGIONS)[number]['slug'],
          cityId: cityRow?.id ?? null,
          cityName: city?.name ?? f.city.trim(),
          address: f.address.trim(),
          phone,
          whatsapp,
          email: f.email.trim().toLowerCase(),
          hours,
          status: 'draft',
          // TODO(storage): coverUrl, logoUrl, gallery once uploads have a home.
        },
      });

      await tx.branchCategory.createMany({ data: v.pickedCats.map(c => ({ branchId: branch.id, categorySlug: c.slug })) });

      await tx.treatment.createMany({
        data: v.filledSvcs.map((s, i) => {
          const isMedical = soleCat ? soleCat.isMedical : svcMedical;
          return {
            branchId: branch.id,
            categorySlug: soleCat?.slug ?? null,
            name: s.name.trim(),
            priceAgorot: parseShekels(s.price)! * 100,
            durationMin: parseMinutes(s.dur),
            isMedical,
            requiresDeclaration: isMedical,
            onlineBookable: !isMedical,
            sortOrder: i,
          };
        }),
      });

      await tx.staffMember.create({
        data: {
          businessId: business.id, userId: user.id, displayName: user.fullName ?? f.name.trim(),
          profession: 'management', isOwner: true, preset: 'owner', permissions: OWNER_PERMISSIONS, branchIds: [branch.id],
        },
      });

      if (hasMedical) {
        const license = await tx.license.create({
          data: { kind: 'doctor', number: f.docLic.trim(), nameOnRecord: f.docName.trim(), specialty: f.docSpec.trim() || null, status: 'pending', source: 'moh_doctors' },
        });
        const doctor = await tx.staffMember.create({
          data: {
            businessId: business.id, displayName: f.docName.trim(), profession: 'doctor', preset: 'practitioner',
            licenseId: license.id, branchIds: [branch.id],
          },
        });
        await tx.branch.update({ where: { id: branch.id }, data: { medicalResponsibleId: doctor.id } });
        await tx.verificationRequest.create({
          data: {
            ref: licRef!, kind: 'license', businessId: business.id, branchId: branch.id, submittedById: user.id,
            submitted: { ...snapshot.responsibility, licenseId: license.id, staffId: doctor.id, document: null },
            checks: [
              { result: 'todo', text: 'מספר רישיון מול מאגר משרד הבריאות' },
              { result: 'todo', text: 'התאמת השם לרישיון' },
              { result: 'todo', text: 'צילום הרישיון' },
            ],
            slaDueAt,
          },
        });
      } else {
        let licenseId: string | null = null;
        if (certGiven) {
          const license = await tx.license.create({
            data: { kind: 'cosmetician_cert', number: f.proCert.trim(), nameOnRecord: f.proName.trim(), status: 'pending', source: 'manual' },
          });
          licenseId = license.id;
        }
        const pro = await tx.staffMember.create({
          data: {
            businessId: business.id, displayName: f.proName.trim(), profession: 'cosmetician', preset: 'practitioner',
            licenseId, branchIds: [branch.id],
          },
        });
        if (licenseId) {
          await tx.verificationRequest.create({
            data: {
              ref: licRef!, kind: 'cert', businessId: business.id, branchId: branch.id, submittedById: user.id,
              submitted: { ...snapshot.responsibility, licenseId, staffId: pro.id, document: null },
              checks: [{ result: 'todo', text: 'בדיקת תעודה או הכשרה' }],
              slaDueAt,
            },
          });
        }
      }

      await tx.verificationRequest.create({
        data: {
          ref: bizRef, kind: 'business', businessId: business.id, branchId: branch.id, submittedById: user.id,
          submitted: snapshot,
          checks: [
            { result: 'todo', text: 'ח״פ מול רשם החברות' },
            { result: 'todo', text: 'כתובת הסניף' },
            { result: 'todo', text: 'קטגוריות תואמות לטיפולים' },
            ...(hasMedical ? [{ result: 'todo', text: `רישיון רופא/ה מול משרד הבריאות (${licRef})` }] : []),
          ],
          slaDueAt,
        },
      });

      await tx.subscription.create({
        data: { businessId: business.id, plan: p.plan, cycle: 'monthly', pricePerBranchAgorot: PLAN_MONTHLY_NIS[p.plan] * 100, status: 'active' },
      });
    });
  } catch (e) {
    console.error('[join] submit failed', e);
    return { ok: false, reason: 'server', error: 'השליחה נכשלה. הפרטים נשמרו בטופס, נסו שוב בעוד רגע.' };
  }

  return { ok: true, ref: bizRef };
}
