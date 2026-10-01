import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, PageHead, dateTimeIL, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { platformSettings } from '@/lib/server/platformSettings';
import { FlagToggle, MaintenanceMessage, NumbersForm, type NumberGroup } from './SettingsForms';

export const metadata: Metadata = { title: 'הגדרות פלטפורמה · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const GROUPS: NumberGroup[] = [
  { title: 'תמחור', fields: [
    { key: 'basicMonthlyNis', label: 'רישום בסיסי · לסניף לחודש', unit: '₪' },
    { key: 'advancedMonthlyNis', label: 'רישום מתקדם + CRM · לסניף לחודש', unit: '₪' },
    { key: 'sponsoredWeeklyNis', label: 'מקום ממומן · לשבוע', unit: '₪' },
    { key: 'sponsoredMaxPerList', label: 'ממומנים מקסימום ברשימה', unit: '' },
  ] },
  { title: 'מע״מ ומסמכים', fields: [
    { key: 'vatRatePct', label: 'שיעור מע״מ · במסמכי הקליניקות', unit: '%', step: 0.5 },
  ] },
  { title: 'חיובים', fields: [
    { key: 'retryFirstDays', label: 'ניסיון חוזר ראשון · אחרי', unit: 'ימים' },
    { key: 'retrySecondDays', label: 'ניסיון חוזר שני · אחרי', unit: 'ימים' },
    { key: 'hideInDebtDays', label: 'הסתרת פרופיל בחוב · אחרי', unit: 'ימים' },
  ] },
  { title: 'כרטיסי מתנה', fields: [
    { key: 'giftCardMinYears', label: 'תוקף מינימלי', unit: 'שנים' },
  ] },
];

export default async function SettingsPage() {
  const user = await requireArea('settings', 'view', '/ops/settings');
  const [level, s, row] = await Promise.all([areaLevel(user, 'settings'), platformSettings(), db.platformSettings.findUnique({ where: { id: 1 }, select: { updatedAt: true, updatedById: true } })]);
  const canEdit = atLeast(level, 'edit');
  const editor = row?.updatedById ? await db.user.findUnique({ where: { id: row.updatedById }, select: { fullName: true, email: true } }) : null;
  const values = { basicMonthlyNis: s.basicMonthlyNis, advancedMonthlyNis: s.advancedMonthlyNis, sponsoredWeeklyNis: s.sponsoredWeeklyNis, sponsoredMaxPerList: s.sponsoredMaxPerList, vatRatePct: s.vatRatePct, retryFirstDays: s.retryFirstDays, retrySecondDays: s.retrySecondDays, hideInDebtDays: s.hideInDebtDays, giftCardMinYears: s.giftCardMinYears };

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="מערכת" title="הגדרות פלטפורמה" lead={<>תמחור, מע״מ ומסמכים, מדיניות חיוב ותכונות. {row ? <>עודכן לאחרונה {dateTimeIL(row.updatedAt)}{editor ? ` על ידי ${editor.fullName ?? editor.email}` : ''}.</> : 'עדיין לא נשמר שינוי; הערכים הם ברירות המחדל מהקוד.'}</>} />
      {s.maintenanceMode ? <p style={{ marginBottom: 14 }}><Chip tone="bad">מצב תחזוקה פעיל: האתר הציבורי מציג את הודעת התחזוקה</Chip></p> : null}
      <NumbersForm groups={GROUPS} values={values} canEdit={canEdit} />
      <p className={ui.hint} style={{ margin: '10px 0 18px' }}>חיובי הפלטפורמה (מנויים ומקומות ממומנים) מופקים ללא מע״מ ישראלי; שיעור המע״מ כאן משמש רק להצגת מחירים ומסמכים של הקליניקות. מחיר מנוי חדש נקבע מההגדרה בזמן ההרשמה; מנויים קיימים שומרים את המחיר שלהם עד שמעדכנים אותם בהנהלת חשבונות.</p>
      <Card title="תכונות" flush>
        <FlagToggle name="onlineBooking" checked={s.onlineBooking} title="הזמנה מקוונת" sub="לקוחות קובעות תור ישירות מהפרופיל; כבוי מציג פנייה בטלפון או בוואטסאפ" />
        <FlagToggle name="giftCards" checked={s.giftCards} title="כרטיסי מתנה" sub="רכישה ומימוש בקליניקות שהצטרפו" />
        <FlagToggle name="waitlist" checked={s.waitlist} title="רשימת המתנה" sub="הצעת תור שהתפנה, לזמן מוגבל" />
        <FlagToggle name="clientAssistant" checked={s.clientAssistant} title="עוזר AI ללקוחות · ניסיוני" sub="טרם מומש באתר; ההגדרה נשמרת לקראת ההפעלה ולא משנה דבר עכשיו" />
        <FlagToggle name="maintenanceMode" checked={s.maintenanceMode} title="מצב תחזוקה" sub="דף הבית ומסכי ההזמנה, רשימת ההמתנה והשוברים מציגים הודעת תחזוקה; הזמנות קיימות לא נפגעות" />
        <MaintenanceMessage message={s.maintenanceMessage} canEdit={canEdit} />
      </Card>
    </AdminShell>
  );
}
