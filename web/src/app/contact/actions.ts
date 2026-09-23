'use server';

import { z } from 'zod';
import { CONTACT_REASONS, reasonInfo } from '@/components/contact/reasons';
import { toE164 } from '@/lib/format';
import { db } from '@/lib/server/db';
import { nextRef } from '@/lib/server/refs';
import { currentUser } from '@/lib/server/session';
import { messaging } from '@/lib/vendors/messaging';
import { LIMITS, RATE_LIMIT_PER_DAY, looksLikeUrl, summaryError, validateContact, type ContactInput, type ContactResult } from './shared';

const Payload = z.object({
  reason: z.enum(CONTACT_REASONS),
  name: z.string().max(LIMITS.name + 20),
  email: z.string().max(LIMITS.email + 20),
  phone: z.string().max(LIMITS.phone + 10),
  extra: z.string().max(LIMITS.extra + 20),
  msg: z.string().max(LIMITS.msgMax + 200),
  consent: z.boolean(),
  website: z.string().max(500),
});

const DAY_MS = 86_400_000;

export async function submitContact(input: ContactInput): Promise<ContactResult> {
  const parsed = Payload.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid', message: 'חלק מהפרטים אינם תקינים. בדקו את הטופס ונסו שוב.' };
  const p = parsed.data;

  // Honeypot filled: answer like a success so the bot learns nothing, store nothing.
  if (p.website.trim() !== '') return { ok: true, ref: null, reason: p.reason, email: p.email.trim() };

  const v = validateContact(p);
  const summary = summaryError(v);
  if (summary) return { ok: false, error: 'invalid', message: summary };

  const email = p.email.trim().toLowerCase();
  const since = new Date(Date.now() - DAY_MS);

  try {
    const recent = await db.contactMessage.count({ where: { email, createdAt: { gte: since } } });
    if (recent >= RATE_LIMIT_PER_DAY) {
      return {
        ok: false,
        error: 'rate',
        message: `נשלחו כבר ${RATE_LIMIT_PER_DAY} פניות מהכתובת הזו ב־24 השעות האחרונות. נענה עליהן לפי הסדר; אפשר לשלוח פנייה נוספת מחר.`,
      };
    }

    const r = reasonInfo(p.reason);
    const extra = p.extra.trim().slice(0, LIMITS.extra);
    let businessName: string | null = null;
    let pageUrl: string | null = null;
    let prefix = '';
    if (extra) {
      switch (r.extraTarget) {
        case 'businessName':
          businessName = extra;
          break;
        case 'pageOrBusiness':
          if (looksLikeUrl(extra)) pageUrl = extra;
          else businessName = extra;
          break;
        default:
          // Subject, assistive technology or organisation: no column of its own, kept at the top of the message.
          prefix = `${r.extraLabel}: ${extra}\n\n`;
      }
    }

    const user = await currentUser();
    const ref = await nextRef('PN');
    await db.contactMessage.create({
      data: {
        ref,
        reason: p.reason,
        name: p.name.trim(),
        email,
        phone: p.phone.trim() ? toE164(p.phone) : null,
        businessName,
        pageUrl,
        message: prefix + p.msg.trim(),
        userId: user?.id ?? null,
      },
    });

    // The receipt is a service message. A failed send must not fail the submission: the message is stored.
    try {
      await messaging().send({ channel: 'email', to: email, template: 'M_contact_receipt', vars: { ref, reason: p.reason }, kind: 'service' });
    } catch (e) {
      console.error('[contact] receipt failed', ref, e);
    }

    return { ok: true, ref, reason: p.reason, email };
  } catch (e) {
    console.error('[contact] submit failed', e);
    return { ok: false, error: 'server', message: 'השליחה נכשלה בצד שלנו. הפרטים נשמרו בטופס, נסו שוב בעוד רגע.' };
  }
}
