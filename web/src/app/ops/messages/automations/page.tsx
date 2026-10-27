import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Table, dateTimeIL, int, ui, type Tone } from '@/components/ops/ui';
import { claimCandidates } from '@/lib/server/automations';
import { db } from '@/lib/server/db';
import { emailReady } from '@/lib/server/email';
import { platformSettings } from '@/lib/server/platformSettings';
import { twilioReady } from '@/lib/server/twilio';
import { AutomationToggle, ClaimBatch, RowActions, RunNow } from './Controls';

export const metadata: Metadata = { title: 'אוטומציות הודעות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const AUTOMATIONS: Array<{ key: string; switch: string; title: string; sub: string }> = [
  { key: 'review_request', switch: 'reviewRequest', title: 'בקשת ביקורת (M6)', sub: '3 ימים אחרי תור שהושלם, רק אם עוד לא נכתבה ביקורת. אימייל, או SMS כשאין אימייל.' },
  { key: 'reminder_sms', switch: 'reminderSms', title: 'תזכורת יום לפני ב־SMS (M2)', sub: 'כשללקוח/ה אין אימייל או שהאימייל לא מחובר, התזכורת יוצאת ב־SMS. מסלולים בתשלום בלבד.' },
  { key: 'gift_delivery', switch: 'giftDelivery', title: 'משלוח כרטיס מתנה מתוזמן (M14)', sub: 'בתאריך שהקונה בחר. כרטיס שבוטל או הוחזר לא נשלח.' },
  { key: 'gift_expiry', switch: 'giftExpiry', title: 'כרטיס מתנה עומד לפוג (M15)', sub: '90 ו־30 יום לפני התוקף, רק כשנשארה יתרה.' },
  { key: 'payment_failed', switch: 'paymentFailed', title: 'חיוב נכשל (M23)', sub: 'לבעלים ביום 0, 3, 7 ו־14, ונעצר ברגע שהחיוב מוסדר.' },
  { key: 'sponsored', switch: 'sponsored', title: 'מקומות ממומנים (M22)', sub: 'אישור, דחייה עם הסיבה, עלייה לאוויר וסיום.' },
  { key: 'onboarding', switch: 'onboarding', title: 'קליטת עסק חדש', sub: 'ברוכים הבאים, תזכורת להשלים פרופיל ביום 3, ותזכורת לאמצעי תשלום ביום 5. כל אחת רק אם עדיין רלוונטית.' },
  { key: 'claim_invite', switch: 'claimInvites', title: 'הזמנה לבעלי עסקים לא רשומים', sub: 'הזמנה אחת לכל עסק, עם קישור הסרה. נשלחת רק לקבוצות שצוות מכניס לתור, לא בשבת ובחגים.' },
];

const NAMES: Record<string, string> = Object.fromEntries(AUTOMATIONS.map(a => [a.key, a.title.replace(/ \(.*\)$/, '')]));
const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'בתור', tone: 'info' },
  sending: { label: 'נשלחת', tone: 'info' },
  sent: { label: 'נשלחה', tone: 'ok' },
  skipped: { label: 'דולגה', tone: 'neutral' },
  expired: { label: 'פגה', tone: 'neutral' },
  cancelled: { label: 'בוטלה', tone: 'neutral' },
  failed: { label: 'נכשלה', tone: 'bad' },
};
const CHANNEL: Record<string, string> = { email: 'אימייל', sms: 'SMS', whatsapp: 'SMS (במקום WhatsApp)' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AutomationsPage({ searchParams }: Props) {
  const user = await requireArea('messages', 'view', '/ops/messages/automations');
  const sp = await searchParams;
  const filter = typeof sp.status === 'string' && STATUS[sp.status] ? sp.status : null;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const now = new Date();
  const [level, s, em, tw, byStatus, byAutomation, rows, claim, waiting] = await Promise.all([
    areaLevel(user, 'messages'),
    platformSettings(),
    emailReady(),
    twilioReady(),
    db.scheduledMessage.groupBy({ by: ['status'], where: { OR: [{ status: 'pending' }, { updatedAt: { gte: since } }] }, _count: true }),
    db.scheduledMessage.groupBy({ by: ['automation', 'status'], where: { OR: [{ status: 'pending' }, { updatedAt: { gte: since } }] }, _count: true }),
    db.scheduledMessage.findMany({ where: filter ? { status: filter } : {}, orderBy: { updatedAt: 'desc' }, take: 60 }),
    claimCandidates(0),
    db.scheduledMessage.count({ where: { status: 'pending', note: { startsWith: 'ממתין לחיבור' } } }),
  ]);
  const canEdit = atLeast(level, 'edit');
  const st = (k: string) => byStatus.find(x => x.status === k)?._count ?? 0;
  const aut = (a: string, k: string) => byAutomation.find(x => x.automation === a && x.status === k)?._count ?? 0;
  const dueNow = await db.scheduledMessage.count({ where: { status: 'pending', dueAt: { lte: now } } });
  const names = await db.branch.findMany({ where: { businessId: { in: [...new Set(rows.map(r => r.businessId).filter((x): x is string => !!x))] } }, select: { businessId: true, name: true }, distinct: ['businessId'] });
  const bizName = new Map(names.map(n => [n.businessId, n.name]));

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow={<Link href="/ops/messages">הודעות ותבניות</Link>}
        title="אוטומציות"
        lead="הודעות שיוצאות לבד לפי אירועים ותאריכים. כל הודעה נכנסת לתור פעם אחת, נבדקת שוב רגע לפני השליחה, ויוצאת רק בין 08:00 ל־21:00."
        actions={<RunNow canEdit={canEdit} />}
      />
      <Kpis items={[
        { label: 'בתור', value: int(st('pending')), note: `${int(dueNow)} כבר בזמן שליחה` },
        { label: 'נשלחו ב־30 יום', value: int(st('sent')), tone: 'ok' },
        { label: 'ממתינות לספק', value: int(waiting), note: em ? 'אימייל מחובר' : 'אימייל (Resend) לא מחובר: מה שיש לו טלפון יוצא ב־SMS', tone: waiting ? 'warn' : 'ok' },
        { label: 'נכשלו ב־30 יום', value: int(st('failed')), tone: st('failed') ? 'bad' : 'ok' },
        { label: 'ערוצים', value: [em ? 'אימייל' : null, tw ? 'SMS' : null].filter(Boolean).join(' + ') || 'אין', note: tw ? 'SMS דרך Twilio' : 'Twilio לא מחובר', tone: em && tw ? 'ok' : tw ? 'warn' : 'bad' },
      ]} />

      <Card title="מתגים" sub="כיבוי עוצר הודעות חדשות ומשאיר את מה שכבר בתור עד שמדליקים שוב.">
        <div className={ui.stack} style={{ gap: 4 }}>
          {AUTOMATIONS.map(a => (
            <div key={a.key}>
              <AutomationToggle name={a.switch} checked={(s.automations as Record<string, boolean>)[a.switch]} title={a.title} sub={a.sub} canEdit={canEdit} />
              {a.key !== 'reminder_sms' ? <p className={ui.note} style={{ margin: '0 0 10px' }}>{int(aut(a.key, 'pending'))} בתור · {int(aut(a.key, 'sent'))} נשלחו · {int(aut(a.key, 'skipped'))} דולגו ב־30 יום</p> : null}
            </div>
          ))}
        </div>
      </Card>

      <Card title="הזמנת עסקים לא רשומים" sub="כל עסק מקבל הזמנה אחת בלבד, לאימייל של העסק או ב־SMS לנייד שלו, עם קישור הסרה. לא נשלח לטלפון קווי.">
        <p className={ui.note} style={{ marginBottom: 12 }}>
          {s.automations.claimInvites ? <Chip tone="ok">פעיל</Chip> : <Chip tone="warn">כבוי</Chip>} {int(claim.total)} עסקים עם פרופיל באוויר, בלי בעלים ועם דרך ליצור קשר, שעוד לא הוזמנו. {int(aut('claim_invite', 'sent'))} הזמנות נשלחו ב־30 יום.
          {!em ? ' האימייל לא מחובר, אז הזמנות לאימייל יוצאות ב־SMS כשיש נייד, ואחרות ממתינות.' : ''}
        </p>
        <ClaimBatch available={claim.total} canEdit={canEdit} />
      </Card>

      <Card title="תור ההודעות" sub={filter ? `מסונן: ${STATUS[filter].label}` : 'האחרונות שהתעדכנו'} aside={
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/ops/messages/automations">הכל</Link>
          {Object.entries(STATUS).filter(([k]) => k !== 'sending').map(([k, v]) => <Link key={k} href={`/ops/messages/automations?status=${k}`}>{v.label}</Link>)}
        </span>
      }>
        {rows.length ? (
          <Table head={['אוטומציה', 'עסק', 'נמען', 'ערוץ', 'מועד', 'מצב', '']}>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{NAMES[r.automation] ?? r.automation}<div className={ui.note}>{r.template}</div></td>
                <td>{r.businessId ? bizName.get(r.businessId) ?? '—' : '—'}</td>
                <td dir="ltr">{r.toMasked}</td>
                <td>{CHANNEL[r.sentChannel ?? r.channel] ?? r.channel}</td>
                <td>{dateTimeIL(r.sentAt ?? r.dueAt)}</td>
                <td><Chip tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Chip>{r.note ? <div className={ui.note}>{r.note}</div> : null}</td>
                <td><RowActions id={r.id} status={r.status} canEdit={canEdit} /></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="אין הודעות" text="ההודעות יופיעו כאן כשהאוטומציות יכניסו אותן לתור." />}
      </Card>
    </AdminShell>
  );
}
