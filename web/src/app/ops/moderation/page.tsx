import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Tabs, dateIL, int, relIL, ui } from '@/components/ops/ui';
import { profileHref } from '@/lib/server/public';
import { decisionsFor, listReports, listReviews, REPORT_REASON, REVIEW_FILTERS, REVIEW_STATUS_NAME, REVIEW_STATUS_TONE, reviewCounts, type ReviewFilter } from './data';
import { ReportButtons, ReviewButtons } from './ModerationActions';

export const metadata: Metadata = { title: 'ביקורות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));

export default async function ModerationPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('moderation', 'view', '/ops/moderation');
  const sp = await searchParams;
  const tab = one(sp.tab) === 'reports' ? 'reports' : 'reviews';
  const filter = (REVIEW_FILTERS.some(f => f.key === one(sp.filter)) ? one(sp.filter) : 'submitted') as ReviewFilter;
  const showClosed = one(sp.closed) === '1';
  const [level, counts, reviews, reports] = await Promise.all([areaLevel(user, 'moderation'), reviewCounts(), listReviews(filter), listReports(showClosed)]);
  const decisions = await decisionsFor(reviews.map(r => r.id));
  const canEdit = atLeast(level, 'edit');
  const openReports = reports.filter(r => r.status !== 'closed').length;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="תפעול" title="ביקורות" lead="ביקורות מתפרסמות רק אחרי שאדם קרא אותן. דירוג Google ודירוג BeautyFind מוצגים זה לצד זה, לעולם לא מאוחדים." />
      <Kpis
        items={[
          { label: 'ממתינות לפרסום', value: int(counts.submitted), note: 'לפי סדר הגעה', tone: counts.submitted ? 'warn' : undefined },
          { label: 'פורסמו', value: int(counts.published) },
          { label: 'נדחו או הוסרו', value: int(counts.rejected + counts.removed) },
          { label: 'דיווחים פתוחים', value: int(openReports), note: 'תלונות ותיקונים מטופס הקשר', tone: openReports ? 'warn' : undefined },
        ]}
      />
      <Tabs label="ביקורות" current={tab} items={[{ key: 'reviews', name: 'ביקורות', href: '/ops/moderation' }, { key: 'reports', name: `דיווחים${openReports ? ` · ${int(openReports)}` : ''}`, href: '/ops/moderation?tab=reports' }]} />

      {tab === 'reviews' ? (
        <>
          <div className={ui.toolbar}><Pills current={filter} items={REVIEW_FILTERS.map(f => ({ key: f.key, name: f.name, count: counts[f.key], href: `/ops/moderation?filter=${f.key}` }))} /></div>
          <div className={ui.stack}>
            {reviews.length ? reviews.map(r => {
              const photos = (Array.isArray(r.photos) ? r.photos : []) as Array<{ url: string; kind: string }>;
              const ds = decisions.filter(d => d.subjectId === r.id);
              return (
                <Card
                  key={r.id}
                  title={<><span dir="ltr" style={{ color: '#D49A2A' }}>{stars(r.rating)}</span> {r.title}</>}
                  sub={<>{r.authorName} · <Link href={`/ops/businesses/${r.branch.businessId}`} className={ui.rowLink}>{r.branch.name}</Link> · {r.branch.cityName}{r.treatmentName ? ` · ${r.treatmentName}` : ''} · {relIL(r.createdAt)}{r.bookingId ? ' · ביקור מאומת' : ' · ללא תור מאומת'}</>}
                  aside={<Chip tone={REVIEW_STATUS_TONE[r.status]}>{REVIEW_STATUS_NAME[r.status]}</Chip>}
                >
                  <p className={ui.note} style={{ margin: 0, color: '#0C243E' }}>{r.body}</p>
                  {photos.length ? <p className={ui.hint} style={{ marginTop: 6 }}>{int(photos.length)} תמונות · {r.photoConsent ? 'עם הסכמה לפרסום' : 'ללא הסכמה לפרסום, לא יוצגו'}</p> : null}
                  {r.businessReply ? <p className={ui.note} style={{ marginTop: 8, paddingInlineStart: 12, borderInlineStart: '3px solid #CDEFF3' }}><b>תגובת העסק ({dateIL(r.repliedAt)}):</b> {r.businessReply}</p> : null}
                  {ds.length ? <p className={ui.hint} style={{ marginTop: 6 }}>{ds.map(d => `${d.who}: ${d.action}${d.reason ? ` (${d.reason})` : ''} · ${dateIL(d.createdAt)}`).join(' · ')}</p> : null}
                  <div className={ui.actions} style={{ marginTop: 10 }}>
                    {r.status === 'published' ? <a href={profileHref(r.branch)} className={`${ui.btn} ${ui.small}`} target="_blank" rel="noreferrer">לפרופיל</a> : null}
                    {canEdit ? <ReviewButtons id={r.id} status={r.status} /> : null}
                  </div>
                </Card>
              );
            }) : <Card><Empty title="אין ביקורות בסינון הזה" text="ביקורות חדשות מגיעות אחרי תור שהושלם (M6) וממתינות כאן לפרסום." /></Card>}
          </div>
        </>
      ) : (
        <>
          <div className={ui.toolbar}><Pills current={showClosed ? 'all' : 'open'} items={[{ key: 'open', name: 'פתוחים', href: '/ops/moderation?tab=reports' }, { key: 'all', name: 'כולל סגורים', href: '/ops/moderation?tab=reports&closed=1' }]} /></div>
          <Card flush>
            {reports.length ? (
              <ul className={ui.list}>
                {reports.map(m => (
                  <li key={m.id} className={ui.listItem}>
                    <span className={ui.dot} data-tone={m.status === 'closed' ? 'ok' : m.reason === 'complaint' ? 'bad' : undefined} aria-hidden="true" />
                    <div className={ui.listText}>
                      <div className={ui.listTitle}>{REPORT_REASON[m.reason] ?? m.reason} · {m.name}{m.businessName ? ` · ${m.businessName}` : ''}</div>
                      <div className={ui.listSub}>{m.ref} · {relIL(m.createdAt)}{m.pageUrl ? <> · <a href={m.pageUrl} className={ui.rowLink} target="_blank" rel="noreferrer">העמוד</a></> : ''} · <span dir="ltr">{m.email}</span></div>
                      <div className={ui.note} style={{ marginTop: 4 }}>{m.message}</div>
                    </div>
                    <Chip tone={m.status === 'closed' ? 'ok' : m.status === 'in_progress' ? 'info' : 'warn'}>{m.status === 'closed' ? 'סגור' : m.status === 'in_progress' ? 'בטיפול' : 'חדש'}</Chip>
                    {canEdit ? <ReportButtons id={m.id} status={m.status} /> : null}
                  </li>
                ))}
              </ul>
            ) : <Empty title="אין דיווחים פתוחים" text="תלונות ובקשות תיקון מטופס יצירת הקשר מגיעות לכאן." />}
          </Card>
        </>
      )}
    </AdminShell>
  );
}
