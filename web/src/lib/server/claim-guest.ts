import 'server-only';
import { db } from './db';

/**
 * Clients book, join waitlists and ask for consults as guests, keyed by phone. Once the same phone
 * is verified by OTP (sign-up or sign-in), those records belong to the account. Only records with no
 * owner yet are touched, and only for client accounts.
 */
export async function claimGuestRecords(user: { id: string; kind: string; phone: string | null }) {
  if (user.kind !== 'client' || !user.phone) return;
  const phone = user.phone;
  await db.$transaction(async tx => {
    await tx.booking.updateMany({ where: { clientPhone: phone, clientUserId: null }, data: { clientUserId: user.id } });
    await tx.waitlistEntry.updateMany({ where: { clientPhone: phone, clientUserId: null }, data: { clientUserId: user.id } });
    await tx.consultRequest.updateMany({ where: { clientPhone: phone, clientUserId: null }, data: { clientUserId: user.id } });
    await tx.healthDeclaration.updateMany({
      where: { clientUserId: null, bookings: { some: { clientUserId: user.id } } },
      data: { clientUserId: user.id },
    });
    await tx.messageConsent.updateMany({ where: { contact: phone, userId: null }, data: { userId: user.id } });
  });
}
