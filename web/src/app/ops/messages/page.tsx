import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Table, dateTimeIL, int, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { platformSettings } from '@/lib/server/platformSettings';
import { RULES, TEMPLATES } from './catalog';
import { DraftEditor } from './DraftEditor';
import { MessaggioKeyForm, MessaggioSettingsForm, MessaggioTestForm, MessaggioToggle } from './MessaggioControls';
import { messaggioStatus } from '@/lib/server/messaggio';
import { twilioStatus } from '@/lib/server/twilio';
import { TwilioCredsForm, TwilioSenderForm, TwilioTestForm, TwilioToggle } from './TwilioControls';

export const metadata: Metadata = { title: 'הודעות ותבניות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const user = await requireArea('messages', 'view', '/ops/messages');
  const [level, s, consents, optedOut, otp30, mg, sends, tw] = await Promise.all([
    areaLevel(user, 'messages'),
    platformSettings(),
    db.messageConsent.groupBy({ by: ['channel'], where: { marketing: true }, _count: true }),
    db.messageConsent.count({ where: { marketing: false } }),
    db.otpCode.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    messaggioStatus(),
    db.messageSend.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    twilioStatus(),
  ]);
  const mgLive = mg.configured && mg.settings.enabled;
  const canEdit = atLeast(level, 'edit');
  const adapter = process.env.MESSAGING_ADAPTER ?? 'console';
  const live = TEMPLATES.filter(t => t.codeIds.length).length;
  const c = (ch: string) => consents.find(x => x.channel === ch)?._count ?? 0;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="צמיחה" title="הודעות ותבניות" lead="כל הודעה שהפלטפורמה שולחת: מה מפעיל אותה, למי, באיזה ערוץ, ומה כבר פעיל בקוד. הודעות שירות תמיד נשלחות; שיווק רק בהסכמה." />
      <Kpis items={[
        { label: 'קודי אימות', value: tw.ready || mgLive ? [tw.ready ? 'Twilio' : null, mgLive && mg.settings.whatsapp && mg.settings.whatsappSender ? 'Messaggio' : null].filter(Boolean).join(' + ') || 'Messaggio' : 'לא מחובר', note: tw.ready || mgLive ? `SMS: ${tw.ready ? 'Twilio' : mgLive && mg.settings.sms ? 'Messaggio' : '—'} · WhatsApp: ${mgLive && mg.settings.whatsapp && mg.settings.whatsappSender ? 'Messaggio' : 'עובר ל־SMS'} · ${int(tw.sent24h + mg.sent24h)} נשלחו ב־24 שעות` : 'הקודים נרשמים ללוג בלבד עד שמחברים ספק', tone: tw.ready || mgLive ? (tw.failed24h + mg.failed24h ? 'warn' : 'ok') : 'bad' },
        { label: 'שאר ההודעות', value: adapter === 'console' ? 'לא מחובר' : adapter, note: adapter === 'console' ? 'MESSAGING_ADAPTER=console: הודעות נרשמות ללוג בלבד' : 'WhatsApp, SMS ואימייל דרך הספק', tone: adapter === 'console' ? 'warn' : 'ok' },
        { label: 'תבניות פעילות בקוד', value: `${int(live)} / ${int(TEMPLATES.length)}`, note: 'נשלחות לפי מזהה תבנית' },
        { label: 'הסכמות שיווק', value: int(consents.reduce((a, x) => a + x._count, 0)), note: `WhatsApp ${int(c('wa'))} · אימייל ${int(c('email'))} · SMS ${int(c('sms'))} · ${int(optedOut)} הסרות · ${int(otp30)} קודים ב־30 יום` },
      ]} />
      <Card title="Twilio · קודי אימות ב־SMS">
        <p className={ui.note} style={{ marginBottom: 14 }}>{tw.ready ? <Chip tone="ok">פעיל</Chip> : <Chip tone="warn">כבוי</Chip>} {tw.ready ? `כל קוד אימות ב־SMS נשלח דרך Twilio. ב־24 שעות: ${int(tw.sent24h)} נשלחו, ${int(tw.delivered24h)} נמסרו${tw.undelivered24h ? `, ${int(tw.undelivered24h)} לא נמסרו` : ''}${tw.failed24h ? `, ${int(tw.failed24h)} נדחו` : ''}.` : 'הזינו את פרטי החשבון והשולח, שלחו SMS בדיקה והפעילו.'}</p>
        <div className={ui.grid2}>
          <div className={ui.stack} style={{ gap: 14 }}>
            <TwilioCredsForm accountSid={tw.accountSid} source={tw.keySource} canEdit={canEdit} />
            <TwilioToggle checked={tw.settings.enabled} canEdit={canEdit} />
          </div>
          <div className={ui.stack} style={{ gap: 14 }}>
            <TwilioSenderForm from={tw.settings.from} messagingServiceSid={tw.settings.messagingServiceSid} canEdit={canEdit} />
            <TwilioTestForm ready={tw.configured && !!(tw.settings.from || tw.settings.messagingServiceSid)} canEdit={canEdit} />
            <p className={ui.hint}>{tw.callback ? <>דוחות מסירה: Twilio מדווח ל־<span dir="ltr" className={ui.mono}>{tw.callback}</span> (חתום ונבדק).</> : 'דוחות מסירה פעילים רק באתר החי (כתובת https ציבורית).'}</p>
          </div>
        </div>
      </Card>
      <Card title="Messaggio · קודי אימות ב־WhatsApp">
        <p className={ui.note} style={{ marginBottom: 14 }}>{mgLive ? <Chip tone="ok">פעיל</Chip> : <Chip tone="warn">כבוי</Chip>} {mgLive ? 'קודים ב־WhatsApp נשלחים דרך Messaggio. קודים ב־SMS עוברים דרך Twilio כשהוא פעיל, ורק אחרת דרך Messaggio.' : 'כבוי: קודים ב־WhatsApp נשלחים ב־SMS (דרך Twilio כשהוא פעיל). הזינו מפתח, שלחו בדיקה והפעילו.'}</p>
        <div className={ui.grid2}>
          <div className={ui.stack} style={{ gap: 14 }}>
            <MessaggioKeyForm hint={mg.keyHint} source={mg.keySource} canEdit={canEdit} />
            <div>
              <MessaggioToggle name="enabled" checked={mg.settings.enabled} title="שליחת קודי אימות דרך Messaggio" sub="כבוי: הקודים לא נשלחים ללקוחות אלא נרשמים ללוג" canEdit={canEdit} />
              <MessaggioToggle name="sms" checked={mg.settings.sms} title="ערוץ SMS" canEdit={canEdit} />
              <MessaggioToggle name="whatsapp" checked={mg.settings.whatsapp} title="ערוץ WhatsApp" sub="דורש שולח WhatsApp מאושר ב־Messaggio" canEdit={canEdit} />
              <MessaggioToggle name="fallbackToSms" checked={mg.settings.fallbackToSms} title="גיבוי ב־SMS" sub="אם Messaggio דוחה שליחה ב־WhatsApp, הקוד נשלח שוב ב־SMS" canEdit={canEdit} />
            </div>
          </div>
          <div className={ui.stack} style={{ gap: 14 }}>
            <MessaggioSettingsForm values={{ smsSender: mg.settings.smsSender, whatsappSender: mg.settings.whatsappSender, whatsappTemplate: mg.settings.whatsappTemplate, baseUrl: mg.settings.baseUrl }} canEdit={canEdit} />
            <MessaggioTestForm configured={mg.configured} canEdit={canEdit} />
          </div>
        </div>
      </Card>
      <Card title="שליחות אחרונות דרך הספקים" sub="הנמען מוצג חלקית; הקודים ותוכן ההודעה לא נשמרים" flush>
        {sends.length ? (
          <Table head={['זמן', 'ספק', 'ערוץ', 'הודעה', 'נמען', 'מצב', 'מזהה / שגיאה']}>
            {sends.map(m => (
              <tr key={m.id}>
                <td className={ui.num}>{dateTimeIL(m.createdAt)}</td>
                <td>{m.provider === 'twilio' ? 'Twilio' : 'Messaggio'}</td>
                <td>{m.channel === 'sms' ? 'SMS' : 'WhatsApp'}{m.fallbackFrom ? <span className={ui.sub}>גיבוי ל־{m.fallbackFrom === 'whatsapp' ? 'WhatsApp' : m.fallbackFrom}</span> : null}</td>
                <td>{m.test ? 'בדיקה' : m.template === 'M16_otp' ? 'קוד אימות' : m.template}</td>
                <td className={ui.num} dir="ltr">{m.toMasked}</td>
                <td>{m.status === 'failed' ? <Chip tone="bad">נדחה</Chip> : m.deliveryStatus === 'delivered' ? <Chip tone="ok">נמסר</Chip> : m.deliveryStatus === 'undelivered' || m.deliveryStatus === 'failed' ? <Chip tone="bad">לא נמסר</Chip> : <Chip tone="info">נשלח</Chip>}{m.deliveryStatus && !['delivered', 'undelivered', 'failed'].includes(m.deliveryStatus) ? <span className={ui.sub} dir="ltr">{m.deliveryStatus}</span> : null}</td>
                <td>{m.error || m.deliveryError ? <span className={ui.error} dir="ltr">{m.error ?? m.deliveryError}</span> : <span className={ui.mono} dir="ltr">{m.providerId}</span>}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="עוד לא נשלחו הודעות דרך הספק" text="שלחו הודעת בדיקה כדי לוודא שהחיבור עובד." />}
      </Card>
      <Card title="קטלוג ההודעות" sub="05-messages.md" flush>
        <Table head={['#', 'הודעה', 'מפעיל', 'למי', 'ערוץ', 'סוג', 'בקוד', 'טיוטת נוסח']}>
          {TEMPLATES.map(t => (
            <tr key={t.id}>
              <td className={ui.mono}>{t.id}</td>
              <td className={ui.strong}>{t.name}<span className={ui.sub}>יעד: {t.target}</span></td>
              <td>{t.trigger}</td>
              <td>{t.to}</td>
              <td>{t.channels}</td>
              <td><Chip tone={t.type === 'S' ? 'info' : 'warn'}>{t.type === 'S' ? 'שירות' : 'שיווק'}</Chip></td>
              <td>{t.codeIds.length ? <Chip tone="ok">פעיל</Chip> : <Chip tone="neutral">טרם</Chip>}{t.codeIds.length ? <span className={ui.sub} dir="ltr">{t.codeIds.join(', ')}</span> : null}</td>
              <td><DraftEditor id={t.id} draft={s.templateDrafts[t.id] ?? ''} canEdit={canEdit} /></td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="כללים" className={ui.stack} >
        <ul className={ui.list}>{RULES.map((r, i) => <li key={i} className={ui.note}>· {r}</li>)}</ul>
        <p className={ui.hint} style={{ marginTop: 8 }}>הטיוטות כאן הן הנוסח להגשה ל־Meta ולספק; הקוד שולח לפי מזהה התבנית, ולכן שינוי נוסח אינו משנה מה שנשלח עד שהתבנית מאושרת אצל הספק.</p>
      </Card>
    </AdminShell>
  );
}
