import 'server-only';
import { Prisma, type User } from '@prisma/client';
import { fromE164, toE164 } from '@/lib/format';
import { hashPassword, sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { sendOtp, verifyOtp } from '@/lib/server/otp';
import { nextRef } from '@/lib/server/refs';
import { messaging } from '@/lib/vendors/messaging';
import { checkForm, firstName, isTokenShape, needsLicense, roleSummary, takesCert, type InviteForm, type Need, type Prof } from './shared';

// Staff invite core (01-flows B3, 03-states "Staff invite"). Pure server logic with no
// cookies, so a script can exercise it; actions.ts wraps it with the session.
// Raw tokens are never logged or stored: only sha256(token) is looked up.

export type InviteState = 'valid' | 'expired' | 'used' | 'declined' | 'revoked';

export type LoadedInvite = NonNullable<Awaited<ReturnType<typeof loadInvite>>>;

/** Looks the invite up by token hash. An overdue `sent` invite is marked `expired` on the way. */
export async function loadInvite(token: string) {
  if (!isTokenShape(token)) return null;
  const inv = await db.staffInvite.findUnique({
    where: { tokenHash: sha256(token) },
    include: { business: { include: { branches: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, cityName: true } } } } },
  });
  if (!inv) return null;

  let status = inv.status;
  if (status === 'sent' && inv.expiresAt <= new Date()) {
    await db.staffInvite.updateMany({ where: { id: inv.id, status: 'sent' }, data: { status: 'expired' } });
    status = 'expired';
  }
  const state: InviteState = status === 'sent' ? 'valid' : status === 'accepted' ? 'used' : status;

  const [inviter, staffCount] = await Promise.all([
    db.user.findUnique({ where: { id: inv.invitedById }, select: { fullName: true, email: true } }),
    db.staffMember.count({ where: { businessId: inv.businessId, status: 'active' } }),
  ]);
  const branch = inv.business.branches[0];
  return {
    id: inv.id,
    businessId: inv.businessId,
    email: inv.email.trim().toLowerCase(),
    name: inv.name,
    preset: inv.preset,
    permissions: inv.permissions,
    state,
    expiresAt: inv.expiresAt,
    sentAt: inv.createdAt,
    invitedById: inv.invitedById,
    inviterName: inviter?.fullName?.trim() || 'מנהל/ת הקליניקה',
    inviterEmail: inviter?.email ?? null,
    bizName: branch?.name ?? inv.business.legalName ?? 'העסק',
    city: branch?.cityName ?? null,
    staffCount,
  };
}

/* ---------- Who is looking at the invite ---------- */

export type Viewer =
  | { mode: 'new'; user: null; need: Need }
  | { mode: 'self'; user: User; need: Need }
  /** An account with the invite email exists and is not the signed-in one. */
  | { mode: 'signin'; signedInAs: string | null }
  /** No account has the invite email, but someone else is signed in. */
  | { mode: 'switch'; signedInAs: string };

const label = (u: User) => u.email ?? (u.phone ? fromE164(u.phone) : '');

export async function viewerFor(inv: LoadedInvite, current: User | null): Promise<Viewer> {
  const existing = await db.user.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' } } });
  if (existing) {
    if (current?.id === existing.id) return { mode: 'self', user: existing, need: needFor(existing) };
    return { mode: 'signin', signedInAs: current ? label(current) : null };
  }
  if (!current) return { mode: 'new', user: null, need: { name: true, phone: true, password: true } };
  // A signed-in account with no email yet takes the invite email on accept.
  if (!current.email) return { mode: 'self', user: current, need: needFor(current) };
  return { mode: 'switch', signedInAs: label(current) };
}

const needFor = (u: User): Need => ({
  name: !u.fullName?.trim(),
  phone: !(u.phone && u.phoneVerifiedAt),
  password: !u.passwordHash,
});

export async function isMember(businessId: string, userId: string) {
  const m = await db.staffMember.findFirst({ where: { businessId, userId, status: { not: 'removed' } }, select: { id: true } });
  return !!m;
}

/* ---------- Send code / accept ---------- */

export type InviteError =
  | 'invite_gone'
  | 'signin_required'
  | 'already_member'
  | 'invalid_input'
  | 'phone_taken'
  | 'email_taken'
  | 'cooldown'
  | 'otp_invalid'
  | 'otp_expired'
  | 'otp_too_many';

export type Fail = { ok: false; error: InviteError; retryInSeconds?: number };
const fail = (error: InviteError, retryInSeconds?: number): Fail => ({ ok: false, error, ...(retryInSeconds ? { retryInSeconds } : {}) });

type Checked = { inv: LoadedInvite; viewer: Extract<Viewer, { mode: 'new' | 'self' }>; phone: string | null };

/** Everything both steps re-validate: invite still open, right account, form rules, phone ownership. */
async function precheck(token: string, form: InviteForm, current: User | null): Promise<Checked | Fail> {
  const inv = await loadInvite(token);
  if (!inv || inv.state !== 'valid') return fail('invite_gone');
  const viewer = await viewerFor(inv, current);
  if (viewer.mode === 'signin' || viewer.mode === 'switch') return fail('signin_required');
  if (checkForm(form, viewer.need)) return fail('invalid_input');
  if (viewer.user && (await isMember(inv.businessId, viewer.user.id))) return fail('already_member');

  const phone = viewer.need.phone ? toE164(form.phone) : null;
  if (viewer.need.phone && !phone) return fail('invalid_input');
  if (phone) {
    const owner = await db.user.findUnique({ where: { phone }, select: { id: true } });
    if (owner && owner.id !== viewer.user?.id) return fail('phone_taken');
  }
  return { inv, viewer, phone };
}

export type CodeSent = { ok: true; cooldownSeconds: number };

export async function sendInviteCodeCore(token: string, form: InviteForm, current: User | null): Promise<CodeSent | Fail> {
  const c = await precheck(token, form, current);
  if ('ok' in c) return c;
  if (!c.phone) return fail('invalid_input');
  const sent = await sendOtp({ target: c.phone, channel: 'sms', purpose: 'staff_invite', context: { inviteId: c.inv.id } });
  if (!sent.ok) return fail('cooldown', sent.retryInSeconds);
  return { ok: true, cooldownSeconds: sent.cooldownSeconds };
}

export type Accepted = {
  ok: true;
  userId: string;
  businessId: string;
  firstName: string;
  roleName: string;
  bizName: string;
  inviterName: string;
  verification: 'license' | 'cert' | null;
  profession: Prof;
};

class TxFail extends Error {
  constructor(readonly code: InviteError) {
    super(code);
  }
}

const SLA_MS = 86_400_000;

export async function acceptInviteCore(token: string, form: InviteForm, code: string | null, current: User | null): Promise<Accepted | Fail> {
  const c = await precheck(token, form, current);
  if ('ok' in c) return c;
  const { inv, viewer, phone } = c;
  const profession = form.profession as Prof;

  // A new phone is proven by the SMS code, bound to this invite.
  if (phone) {
    if (!code || !/^\d{6}$/.test(code)) return fail('otp_invalid');
    const res = await verifyOtp({ target: phone, purpose: 'staff_invite', code });
    if (!res.ok) return fail(res.error === 'expired' ? 'otp_expired' : res.error === 'too_many_attempts' ? 'otp_too_many' : 'otp_invalid');
    const ctx = res.context && typeof res.context === 'object' && !Array.isArray(res.context) ? res.context : {};
    if ((ctx as Record<string, unknown>).inviteId !== inv.id) return fail('otp_invalid');
  }

  const name = viewer.need.name ? form.name.trim().replace(/\s+/g, ' ') : viewer.user!.fullName!.trim();
  const passwordHash = viewer.need.password ? await hashPassword(form.password) : null;
  const verification: 'license' | 'cert' | null = needsLicense(profession) ? 'license' : takesCert(profession) && form.cert.trim() ? 'cert' : null;
  const number = verification === 'license' ? form.license.trim() : verification === 'cert' ? form.cert.trim() : '';
  const specialty = verification === 'license' ? form.specialty.trim() || null : null;
  // Refs come from the shared counter; a rolled-back accept only leaves a gap.
  const ref = verification ? await nextRef(verification === 'license' ? 'LIC' : 'CRT') : null;
  const role = roleSummary(inv.preset, inv.permissions);

  let userId: string;
  try {
    userId = await db.$transaction(async tx => {
      const now = new Date();
      // Claim the invite first: a second tab or a replay finds it no longer `sent`.
      const claimed = await tx.staffInvite.updateMany({
        where: { id: inv.id, status: 'sent', expiresAt: { gt: now } },
        data: { status: 'accepted', acceptedAt: now },
      });
      if (claimed.count !== 1) throw new TxFail('invite_gone');

      let uid: string;
      if (viewer.user) {
        const u = viewer.user;
        await tx.user.update({
          where: { id: u.id },
          data: {
            kind: 'business',
            ...(viewer.need.name ? { fullName: name } : {}),
            ...(passwordHash ? { passwordHash } : {}),
            ...(phone ? { phone, phoneVerifiedAt: now } : {}),
            ...(!u.email ? { email: inv.email, emailVerifiedAt: now } : {}),
            ...(!u.termsAcceptedAt ? { termsAcceptedAt: now } : {}),
          },
        });
        uid = u.id;
        const dup = await tx.staffMember.findFirst({ where: { businessId: inv.businessId, userId: uid, status: { not: 'removed' } }, select: { id: true } });
        if (dup) throw new TxFail('already_member');
      } else {
        const u = await tx.user.create({
          data: {
            email: inv.email,
            // The emailed link proves the address.
            emailVerifiedAt: now,
            phone,
            phoneVerifiedAt: now,
            fullName: name,
            kind: 'business',
            passwordHash,
            termsAcceptedAt: now,
          },
        });
        uid = u.id;
      }

      const branches = await tx.branch.findMany({ where: { businessId: inv.businessId }, select: { id: true } });

      const license = verification
        ? await tx.license.create({
            data: {
              kind: verification === 'cert' ? 'cosmetician_cert' : profession === 'doctor' ? 'doctor' : 'nurse',
              number,
              nameOnRecord: name,
              specialty,
              status: 'pending',
              source: verification === 'cert' ? 'manual' : profession === 'doctor' ? 'moh_doctors' : 'moh_nurses',
            },
          })
        : null;

      const staff = await tx.staffMember.create({
        data: {
          businessId: inv.businessId,
          userId: uid,
          displayName: name,
          profession,
          isOwner: false,
          preset: role.preset,
          permissions: (inv.permissions ?? {}) as Prisma.InputJsonValue,
          branchIds: branches.map(b => b.id),
          licenseId: license?.id ?? null,
          status: 'active',
        },
      });

      if (license && ref) {
        await tx.verificationRequest.create({
          data: {
            ref,
            kind: verification!,
            businessId: inv.businessId,
            submittedById: uid,
            submitted: { licenseId: license.id, staffId: staff.id, name, number, specialty, profession, invitedBy: inv.inviterName },
            checks:
              verification === 'license'
                ? [{ result: 'todo', text: 'מספר רישיון מול פנקס משרד הבריאות' }]
                : [{ result: 'todo', text: 'מספר תעודה מקצועית מול מסמך התעודה' }],
            slaDueAt: new Date(now.getTime() + SLA_MS),
          },
        });
      }
      return uid;
    });
  } catch (e) {
    if (e instanceof TxFail) return fail(e.code);
    // Lost a race for the same email or phone.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
      return fail(target.includes('email') ? 'email_taken' : 'phone_taken');
    }
    throw e;
  }

  await notifyInviter(inv, 'staff_invite_accepted', { name, role: role.name });
  return {
    ok: true,
    userId,
    businessId: inv.businessId,
    firstName: firstName(name),
    roleName: role.name,
    bizName: inv.bizName,
    inviterName: inv.inviterName,
    verification,
    profession,
  };
}

/* ---------- Decline / ask for a new invite ---------- */

export async function declineInviteCore(token: string): Promise<{ ok: true } | Fail> {
  const inv = await loadInvite(token);
  if (!inv || inv.state !== 'valid') return fail('invite_gone');
  const r = await db.staffInvite.updateMany({ where: { id: inv.id, status: 'sent' }, data: { status: 'declined' } });
  if (r.count !== 1) return fail('invite_gone');
  await notifyInviter(inv, 'staff_invite_declined', { email: inv.email });
  return { ok: true };
}

export async function requestNewInviteCore(token: string): Promise<{ ok: true } | Fail> {
  const inv = await loadInvite(token);
  if (!inv || (inv.state !== 'expired' && inv.state !== 'declined')) return fail('invite_gone');
  // At most one request per day: the conditional update checks and stamps atomically.
  // A repeat inside the window succeeds silently so the page can't be used to spam the inviter.
  const cutoff = new Date(Date.now() - 86_400_000);
  const gate = await db.staffInvite.updateMany({
    where: { id: inv.id, OR: [{ renewalRequestedAt: null }, { renewalRequestedAt: { lt: cutoff } }] },
    data: { renewalRequestedAt: new Date() },
  });
  if (gate.count === 1) await notifyInviter(inv, 'staff_invite_renewal_request', { email: inv.email });
  return { ok: true };
}

/** Service email to whoever sent the invite. Never fails the caller. */
async function notifyInviter(inv: LoadedInvite, template: string, vars: Record<string, string>) {
  if (!inv.inviterEmail) return;
  try {
    await messaging().send({ channel: 'email', to: inv.inviterEmail, template, vars: { business: inv.bizName, ...vars }, kind: 'service' });
  } catch (e) {
    console.error('[invite] inviter notification failed', { inviteId: inv.id, template, error: e instanceof Error ? e.message : String(e) });
  }
}
