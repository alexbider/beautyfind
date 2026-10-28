import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireArea } from '@/components/ops/guard';
import { Band, Card, Chip, Empty, PageHead, Table, dateTimeIL, int, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { AUDIENCE_LABEL, replyOnly, type Audience } from '@/lib/server/emailRecipients';
import { EVENT_LABEL, emailState } from '@/lib/server/emailTracking';
import { businessNames, templateName } from '../data';

export const metadata: Metadata = { title: 'מייל · מעקב מיילים', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Links on the dark band take its text color.
const DELIVERY_LABEL: Record<string, string> = { sent: 'נשלח, מחכה לדיווח', delayed: 'מתעכב', bounced: 'חזר', complained: 'סומן כספאם', failed: 'נכשל', suppressed: 'נחסם ב־Resend' };
const BAND_LINK = { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 } as const;

export default async function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea('emails', 'view', `/ops/emails/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const m = await db.messageSend.findUnique({
    where: { id },
    include: { events: { orderBy: { at: 'asc' } }, replies: { orderBy: { receivedAt: 'asc' } } },
  });
  if (!m || m.channel !== 'email') notFound();
  const names = await businessNames([m.businessId]);
  const st = emailState(m);
  const person = m.userId ? await db.user.findUnique({ where: { id: m.userId }, select: { fullName: true } }) : null;

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow={<Link href="/ops/emails?tab=sent" className={ui.rowLink}>מעקב מיילים</Link>}
        title={templateName(m.template)}
        lead={<>נשלח {dateTimeIL(m.createdAt)} אל <span className="ltr">{m.toMasked}</span>{person?.fullName ? ` (${person.fullName})` : ''}</>}
        actions={<>{m.test ? <Chip tone="info">מייל בדיקה</Chip> : null}<Chip tone={st.tone}>{st.label}</Chip></>}
      />
      <div className={ui.stack}>
        <Band
          items={[
            { label: 'נמען', value: m.businessId ? <Link href={`/ops/businesses/${m.businessId}`} style={BAND_LINK}>{names.get(m.businessId) ?? 'עסק'}</Link> : AUDIENCE_LABEL[(m.audience ?? 'other') as Audience] },
            { label: 'מסירה', value: m.deliveryStatus === 'delivered' ? `נמסר ${dateTimeIL(m.deliveredAt)}` : m.deliveryStatus ? DELIVERY_LABEL[m.deliveryStatus] ?? m.deliveryStatus : m.status === 'failed' ? 'נכשל' : 'אין דיווח עדיין' },
            { label: 'פתיחות', value: m.openCount ? `${int(m.openCount)} · ראשונה ${dateTimeIL(m.openedAt)}` : 'לא נפתח' },
            { label: 'הקלקות', value: m.clickCount ? `${int(m.clickCount)} · ראשונה ${dateTimeIL(m.clickedAt)}` : 'אין' },
            { label: 'תשובות', value: m.replyCount ? int(m.replyCount) : m.replyToken ? 'אין' : 'לא נמדד (נשלח לפני מעקב התשובות)' },
          ]}
        />
        {(m.error || m.deliveryError) && (
          <Card title="שגיאה"><p className="ltr">{m.deliveryError ?? m.error}</p></Card>
        )}
        <div className={ui.grid}>
          <Card title="ציר זמן" sub="כל אירוע ש־Resend דיווח" flush>
            {m.events.length ? (
              <Table head={['מתי', 'אירוע', 'פרטים']}>
                {m.events.map(e => (
                  <tr key={e.id}>
                    <td className="ltr">{dateTimeIL(e.at)}</td>
                    <td>{EVENT_LABEL[e.type] ?? e.type}</td>
                    <td className="ltr" style={{ wordBreak: 'break-all' }}>{e.link ?? e.detail ?? ''}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title="עוד אין אירועים" text="אירועים מגיעים מה־Webhook של Resend אחרי השליחה." />
            )}
          </Card>
          <Card title="תשובות" flush={m.replies.length > 0}>
            {m.replies.length ? (
              <ul className={ui.list}>
                {m.replies.map(r => (
                  <li key={r.id} className={ui.listItem}>
                    <div className={ui.listText}>
                      <Link href={`/ops/emails/replies/${r.id}`} className={ui.listTitle}>{r.fromName ?? r.fromEmail} · {dateTimeIL(r.receivedAt)}</Link>
                      <span className={ui.listSub} style={{ whiteSpace: 'pre-wrap' }}>{replyOnly(r.text ?? '').slice(0, 400)}</span>
                    </div>
                    <Chip tone={r.status === 'new' ? 'warn' : 'ok'}>{r.status === 'new' ? 'לטיפול' : 'טופל'}</Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="אין תשובות למייל הזה" />
            )}
          </Card>
        </div>
        <p className={ui.note}>
          מזהה ב־Resend: <span className="ltr">{m.providerId ?? '—'}</span>. תוכן המייל לא נשמר במערכת; אפשר לראות אותו ב־Resend, Emails.
        </p>
      </div>
    </AdminShell>
  );
}
