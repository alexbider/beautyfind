import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Kpis, PageHead, Table, int, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { platformSettings } from '@/lib/server/platformSettings';
import { RULES, TEMPLATES } from './catalog';
import { DraftEditor } from './DraftEditor';

export const metadata: Metadata = { title: 'הודעות ותבניות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const user = await requireArea('messages', 'view', '/ops/messages');
  const [level, s, consents, optedOut, otp30] = await Promise.all([
    areaLevel(user, 'messages'),
    platformSettings(),
    db.messageConsent.groupBy({ by: ['channel'], where: { marketing: true }, _count: true }),
    db.messageConsent.count({ where: { marketing: false } }),
    db.otpCode.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  const canEdit = atLeast(level, 'edit');
  const adapter = process.env.MESSAGING_ADAPTER ?? 'console';
  const live = TEMPLATES.filter(t => t.codeIds.length).length;
  const c = (ch: string) => consents.find(x => x.channel === ch)?._count ?? 0;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="צמיחה" title="הודעות ותבניות" lead="כל הודעה שהפלטפורמה שולחת: מה מפעיל אותה, למי, באיזה ערוץ, ומה כבר פעיל בקוד. הודעות שירות תמיד נשלחות; שיווק רק בהסכמה." />
      <Kpis items={[
        { label: 'ספק הודעות', value: adapter === 'console' ? 'לא מחובר' : adapter, note: adapter === 'console' ? 'MESSAGING_ADAPTER=console: הודעות נרשמות ללוג בלבד' : 'WhatsApp, SMS ואימייל דרך הספק', tone: adapter === 'console' ? 'bad' : 'ok' },
        { label: 'תבניות פעילות בקוד', value: `${int(live)} / ${int(TEMPLATES.length)}`, note: 'נשלחות לפי מזהה תבנית' },
        { label: 'הסכמות שיווק', value: int(consents.reduce((a, x) => a + x._count, 0)), note: `WhatsApp ${int(c('wa'))} · אימייל ${int(c('email'))} · SMS ${int(c('sms'))}` },
        { label: 'הסרות מדיוור', value: int(optedOut), note: `${int(otp30)} קודי OTP ב־30 יום` },
      ]} />
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
