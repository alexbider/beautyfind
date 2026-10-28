import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Band, Card, Chip, PageHead, dateTimeIL, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { replyOnly } from '@/lib/server/emailRecipients';
import { businessNames, templateName } from '../../data';
import { ReplyStatusButton } from '../../EmailForms';

export const metadata: Metadata = { title: 'תשובה · מעקב מיילים', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Links on the dark band take its text color.
const BAND_LINK = { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 } as const;

export default async function ReplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea('emails', 'view', `/ops/emails/replies/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await db.emailReply.findUnique({ where: { id }, include: { send: { select: { id: true, template: true, createdAt: true } } } });
  if (!r) notFound();
  const [names, level, handler] = await Promise.all([
    businessNames([r.businessId]),
    areaLevel(user, 'emails'),
    r.handledById ? db.user.findUnique({ where: { id: r.handledById }, select: { fullName: true, email: true } }) : null,
  ]);
  const text = r.text ?? '';
  const fresh = replyOnly(text);
  const files = (Array.isArray(r.attachments) ? r.attachments : []) as Array<{ filename?: string; contentType?: string; size?: number }>;
  const subject = r.subject ? (/^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`) : 'Re:';

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow={<Link href="/ops/emails?tab=replies" className={ui.rowLink}>תשובות</Link>}
        title={r.subject ?? 'ללא נושא'}
        lead={<>מאת {r.fromName ? `${r.fromName} · ` : ''}<span className="ltr">{r.fromEmail}</span> · {dateTimeIL(r.receivedAt)}</>}
        actions={
          <>
            <a className={`${ui.btn} ${ui.primary}`} href={`mailto:${encodeURIComponent(r.fromEmail)}?subject=${encodeURIComponent(subject)}`}>מענה במייל</a>
            <ReplyStatusButton id={r.id} status={r.status} canEdit={atLeast(level, 'edit')} />
          </>
        }
      />
      <div className={ui.stack}>
        <Band
          items={[
            { label: 'עסק', value: r.businessId ? <Link href={`/ops/businesses/${r.businessId}`} style={BAND_LINK}>{names.get(r.businessId) ?? 'עסק'}</Link> : 'לא זוהה' },
            { label: 'בתשובה ל', value: r.send ? <Link href={`/ops/emails/${r.send.id}`} style={BAND_LINK}>{templateName(r.send.template)} · {dateTimeIL(r.send.createdAt)}</Link> : 'לא שויך למייל' },
            { label: 'הועבר לצוות', value: r.forwardedAt ? dateTimeIL(r.forwardedAt) : r.forwardError ? <Chip tone="bad">נכשל: {r.forwardError}</Chip> : 'לא' },
            { label: 'מצב', value: r.status === 'handled' ? `טופל${handler ? ` על ידי ${handler.fullName ?? handler.email}` : ''} · ${dateTimeIL(r.handledAt)}` : 'לטיפול' },
          ]}
        />
        <Card title="התשובה">
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }} dir="auto">{fresh || 'התשובה הגיעה בלי טקסט.'}</div>
        </Card>
        {files.length > 0 && (
          <Card title="קבצים מצורפים" sub="הקבצים עצמם נמצאים בהעתק שהועבר לתיבת הצוות">
            <ul className={ui.list}>
              {files.map((f, i) => <li key={i} className={ui.listItem}><span className="ltr">{f.filename}</span> <span className={ui.note}>{f.contentType} · {Math.round((f.size ?? 0) / 1024)} KB</span></li>)}
            </ul>
          </Card>
        )}
        {text.trim() !== fresh.trim() && (
          <details>
            <summary className={ui.rowLink}>ההודעה המלאה, כולל הציטוט</summary>
            <Card><div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }} dir="auto">{text}</div></Card>
          </details>
        )}
      </div>
    </AdminShell>
  );
}
