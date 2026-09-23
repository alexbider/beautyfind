import Link from 'next/link';
import { CallButton, WhatsAppButton } from '@/components/profile/ContactLinks';
import { profileHref } from '@/lib/server/public';
import s from './gift.module.css';

/** The business can't sell gift cards online (basic plan or no payments connection). */
export function NoSales({ branch }: { branch: { id: string; name: string; slug: string; regionSlug: string; phone: string | null; whatsapp: string | null } }) {
  return (
    <div className={`${s.empty} ${s.fade}`}>
      <h1 className={s.h1Sm}>שוברי מתנה ל{branch.name}</h1>
      <p>
        {branch.name} עדיין לא מוכרת שוברי מתנה באתר. אפשר לפנות ישירות לקליניקה ולשאול על שובר או מתנה, והם ישמחו לעזור.
      </p>
      <div className={s.actions}>
        {branch.whatsapp ? <WhatsAppButton branchId={branch.id} e164={branch.whatsapp} businessName={branch.name} /> : null}
        {branch.phone ? <CallButton branchId={branch.id} e164={branch.phone} showNumber /> : null}
        <Link href={profileHref(branch)} className={s.btnGhost}>לעמוד הקליניקה</Link>
      </div>
      <p className={s.small}>
        קיבלת שובר? <Link href="/gift/check">לבדיקת יתרה</Link>.
      </p>
    </div>
  );
}
