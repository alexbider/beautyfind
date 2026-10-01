import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, PageHead, Table, dateIL, dateTimeIL, int, nisAgorot, nisWhole, ui } from '@/components/ops/ui';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { fromE164 } from '@/lib/format';
import { chainTotal } from '@/lib/pricing';
import { profileHref } from '@/lib/server/public';
import { platformSettings } from '@/lib/server/platformSettings';
import { loadBusiness, PLAN_NAME, STATUS_NAME, STATUS_TONE } from '../data';
import { StatusActions } from '../StatusActions';

export const metadata: Metadata = { title: 'כרטיס עסק · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PROFESSION: Record<string, string> = { doctor: 'רופא/ה', nurse: 'אח/ות', cosmetician: 'קוסמטיקאי/ת', technician: 'טכנאי/ת', front: 'קבלה', management: 'ניהול' };
const KIND: Record<string, string> = { business: 'הרשמה', license: 'רישיון', cert: 'תעודה', claim: 'תביעת בעלות' };
const VSTATUS: Record<string, { name: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = { open: { name: 'פתוח', tone: 'warn' }, awaiting_document: { name: 'ממתין למסמך', tone: 'warn' }, approved: { name: 'אושר', tone: 'ok' }, rejected: { name: 'נדחה', tone: 'bad' } };
const CONN: Record<string, string> = { payments: 'סליקה', invoicing: 'חשבוניות', calendar: 'יומן' };

export default async function BusinessCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea('businesses', 'view', `/ops/businesses/${id}`);
  const [b, s, level] = await Promise.all([loadBusiness(id), platformSettings(), areaLevel(user, 'businesses')]);
  if (!b) notFound();
  const live = b.branches.filter(x => x.status === 'live').length;
  const unit = b.subscription ? (b.subscription.plan === 'advanced' ? s.advancedMonthlyNis : s.basicMonthlyNis) : null;
  const total = unit != null && live ? chainTotal(live, unit) : null;
  const name = b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם';

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow={<Link href="/ops/businesses" className={ui.rowLink}>תפעול · עסקים</Link>}
        title={name}
        lead={<>{b.legalName ? `${b.legalName} · ` : ''}{b.companyNo ? <>ע.מ. <span dir="ltr">{b.companyNo}</span> · </> : ''}נוצר {dateIL(b.createdAt)}{b.chainKey ? <> · רשת: <span dir="ltr">{b.chainKey}</span></> : ''}</>}
        actions={<Chip tone={STATUS_TONE[b.status]}>{STATUS_NAME[b.status]}</Chip>}
      />

      <div className={ui.split}>
        <div className={ui.stack}>
          <Card title="סניפים" sub={`${int(b.branches.length)} · ${int(live)} חיים`} flush>
            {b.branches.length ? (
              <Table head={['סניף', 'עיר ואזור', 'תחומים', 'אחריות', 'מצב', '']}>
                {b.branches.map(br => (
                  <tr key={br.id}>
                    <td className={ui.strong}>{br.name}{br.isClaimed ? <span className={ui.sub}>בבעלות מאומתת</span> : null}</td>
                    <td>{br.cityName}<span className={ui.sub}>{regionBySlug(br.regionSlug)?.name ?? br.regionSlug}</span></td>
                    <td>{br.categories.map(c => categoryBySlug(c.categorySlug)?.name ?? c.categorySlug).join(', ') || '—'}</td>
                    <td>{br.medicalResponsible ? `${br.medicalResponsible.displayName} · ${PROFESSION[br.medicalResponsible.profession] ?? br.medicalResponsible.profession}` : '—'}</td>
                    <td><Chip tone={br.status === 'live' ? 'ok' : br.status === 'draft' ? 'neutral' : 'warn'}>{br.status === 'live' ? 'חי' : br.status === 'draft' ? 'טיוטה' : 'לא מפורסם'}</Chip></td>
                    <td>{br.status === 'live' && b.status === 'live' ? <a href={profileHref({ regionSlug: br.regionSlug, slug: br.slug, categories: br.categories })} className={ui.rowLink} target="_blank" rel="noreferrer">לפרופיל</a> : null}</td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="אין סניפים" />}
          </Card>

          <Card title="צוות" sub={`${int(b.staff.length)}`} flush>
            {b.staff.length ? (
              <Table head={['שם', 'מקצוע', 'תפקיד', 'רישיון']}>
                {b.staff.map(st => (
                  <tr key={st.id}>
                    <td className={ui.strong}>{st.displayName}</td>
                    <td>{PROFESSION[st.profession] ?? st.profession}</td>
                    <td>{st.isOwner ? 'בעלים' : st.status === 'invited' ? 'הוזמן/ה' : 'פעיל/ה'}</td>
                    <td>{st.license ? <Chip tone={st.license.status === 'verified' ? 'ok' : 'warn'}>{st.license.status}</Chip> : '—'}</td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="עוד לא הוגדר צוות" text="הבעלים מוסיף/ה צוות מלוח הניהול אחרי תביעת הבעלות." />}
          </Card>

          <Card title="אימותים והחלטות" flush>
            {b.verificationRequests.length || b.decisions.length ? (
              <Table head={['מתי', 'מה', 'מצב']}>
                {b.verificationRequests.map(v => (
                  <tr key={v.id}>
                    <td className={ui.num}>{dateTimeIL(v.createdAt)}</td>
                    <td><Link href="/ops/verification" className={ui.rowLink}>{v.ref}</Link> · {KIND[v.kind] ?? v.kind}</td>
                    <td><Chip tone={VSTATUS[v.status]?.tone ?? 'neutral'}>{VSTATUS[v.status]?.name ?? v.status}</Chip></td>
                  </tr>
                ))}
                {b.decisions.map(d => (
                  <tr key={d.id}>
                    <td className={ui.num}>{dateTimeIL(d.createdAt)}</td>
                    <td>{d.action.replace(/^status_/, 'מצב: ')}{d.reason ? <span className={ui.sub}>{d.reason}</span> : null}</td>
                    <td><Chip>{d.actorRole}</Chip></td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="אין אימותים או החלטות" />}
          </Card>
        </div>

        <div className={ui.stack}>
          <Card title="מנוי וחיוב">
            {b.subscription ? (
              <dl className={ui.stack} style={{ gap: 8, margin: 0 }}>
                <div><dt className={ui.kpiLabel}>מסלול</dt><dd style={{ margin: 0 }} className={ui.strong}>{PLAN_NAME[b.subscription.plan]} · {b.subscription.cycle === 'yearly' ? 'שנתי' : 'חודשי'}</dd></div>
                <div><dt className={ui.kpiLabel}>מצב</dt><dd style={{ margin: 0 }}><Chip tone={b.subscription.status === 'active' ? 'ok' : b.subscription.status === 'past_due' ? 'bad' : 'neutral'}>{b.subscription.status}</Chip></dd></div>
                <div><dt className={ui.kpiLabel}>חיוב חודשי</dt><dd style={{ margin: 0 }} className={ui.strong}>{total ? `${nisWhole(total.total)} · ${int(live)} סניפים` : 'אין סניפים חיים לחיוב'}{total?.discounted ? <span className={ui.sub}>הנחת רשת 25% על {int(total.discounted)} סניפים</span> : null}</dd></div>
                <div><dt className={ui.kpiLabel}>סוף תקופה</dt><dd style={{ margin: 0 }}>{dateIL(b.subscription.currentPeriodEnd)}</dd></div>
                {b.subscription.pendingPlan ? <div><dt className={ui.kpiLabel}>שינוי ממתין</dt><dd style={{ margin: 0 }}>{PLAN_NAME[b.subscription.pendingPlan]} מהמחזור הבא</dd></div> : null}
              </dl>
            ) : <p className={ui.note}>אין מנוי. העסק רשום ללא חיוב (למשל רשומה מהייבוא שעוד לא נתבעה).</p>}
            <p className={ui.hint} style={{ marginTop: 10 }}>{b.invoiceEmail ? <>חשבוניות ל־<span dir="ltr">{b.invoiceEmail}</span></> : 'לא הוגדר דוא״ל לחשבוניות'}{b.accountantEmail ? <> · רו״ח: <span dir="ltr">{b.accountantEmail}</span></> : ''}</p>
          </Card>

          <Card title="בעלים וחיבורים">
            <p className={ui.note} style={{ margin: 0 }}>
              {b.owner ? <>{b.owner.fullName ?? 'ללא שם'} · <span dir="ltr">{b.owner.email ?? ''}</span>{b.owner.phone ? <> · <span dir="ltr">{fromE164(b.owner.phone)}</span></> : ''}</> : 'עוד אין בעלים מאומת'}
            </p>
            <ul className={ui.list} style={{ marginTop: 10 }}>
              {b.providerConnections.length ? b.providerConnections.map((c, i) => (
                <li key={i} className={ui.listItem} style={{ paddingInline: 0 }}>
                  <div className={ui.listText}><div className={ui.listTitle}>{CONN[c.kind] ?? c.kind} · {c.provider}</div><div className={ui.listSub}>{c.lastError ?? (c.lastCheckedAt ? `נבדק ${dateTimeIL(c.lastCheckedAt)}` : 'טרם נבדק')}</div></div>
                  <Chip tone={c.status === 'connected' ? 'ok' : c.status === 'error' ? 'bad' : 'neutral'}>{c.status}</Chip>
                </li>
              )) : <li className={ui.hint}>אין ספקים מחוברים (סליקה, חשבוניות, יומן). העסק יכול להציע תורים חינמיים בלבד.</li>}
            </ul>
          </Card>

          <Card title="תשלומים לפלטפורמה" flush>
            {b.payments.length ? (
              <Table head={['תאריך', 'מטרה', 'סכום', 'מצב']}>
                {b.payments.map(p => (
                  <tr key={p.id}>
                    <td className={ui.num}>{dateIL(p.paidAt ?? p.createdAt)}</td>
                    <td>{p.purpose}</td>
                    <td className={ui.num}>{nisAgorot(p.grossAgorot)}</td>
                    <td><Chip tone={p.status === 'succeeded' ? 'ok' : p.status === 'failed' ? 'bad' : 'neutral'}>{p.status}</Chip></td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="עוד לא נגבו תשלומים" />}
          </Card>

          {b.campaigns.length || b.disputes.length ? (
            <Card title="ממומנים ומחלוקות" flush>
              <ul className={ui.list}>
                {b.campaigns.map(c => <li key={c.id} className={ui.listItem}><div className={ui.listText}><div className={ui.listTitle}><Link href="/ops/sponsored" className={ui.rowLink}>{c.ref}</Link> · {c.line}</div><div className={ui.listSub}>{dateIL(c.weekStart)} · {c.weeks} שבועות</div></div><Chip>{c.status}</Chip></li>)}
                {b.disputes.map(d => <li key={d.id} className={ui.listItem}><div className={ui.listText}><div className={ui.listTitle}><Link href="/ops/disputes" className={ui.rowLink}>{d.ref}</Link> · {d.clientName}</div><div className={ui.listSub}>{nisAgorot(d.amountAgorot)}</div></div><Chip>{d.status}</Chip></li>)}
              </ul>
            </Card>
          ) : null}

          <Card title="מצב העסק">
            <StatusActions id={b.id} current={b.status} canEdit={atLeast(level, 'edit')} />
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
