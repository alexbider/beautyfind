import type { Metadata } from 'next';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { CountedText } from '@/components/dashboard/reviews/Counted';
import { ReviewList, type ReviewItem } from '@/components/dashboard/reviews/ReviewList';
import { ago, computeStats, fmtDate, openLine, totalLine } from '@/components/dashboard/reviews/stats';
import { db } from '@/lib/server/db';
import s from '@/components/dashboard/reviews/Reviews.module.css';

// Design: project/BeautyFind Dashboard.dc.html (isReviews)
// BeautyFind reviews and the Google rating are shown side by side and never averaged (decision A4).

export const metadata: Metadata = { title: 'ביקורות' };

const fill = (n: number) => (n >= 4 ? '#14B3C6' : n === 3 ? '#7ED7E1' : '#D98A74');

export default async function ReviewsPage() {
  const ctx = await tabGuard('reviews');
  const banner = !ctx.canEdit && <ReadOnlyBanner roleName={ctx.roleName} />;
  const branch = ctx.branch;
  if (!branch) return <>{banner}<p>לא נמצא סניף.</p></>;

  const reviews = await db.review.findMany({
    where: { branchId: branch.id, status: 'published' },
    orderBy: { createdAt: 'desc' },
  });
  const reports = reviews.length
    ? await db.decision.findMany({
        where: { subjectType: 'review', action: 'report', actorRole: 'business', subjectId: { in: reviews.map(r => r.id) } },
        select: { subjectId: true },
      })
    : [];
  const reported = new Set(reports.map(r => r.subjectId));

  const now = new Date();
  const st = computeStats(reviews, now);
  const items: ReviewItem[] = reviews.map(r => ({
    id: r.id,
    who: r.authorName,
    rating: Math.min(5, Math.max(1, Math.round(r.rating))),
    when: ago(r.createdAt, now),
    treatment: r.treatmentName,
    title: r.title,
    body: r.body,
    reply: r.businessReply,
    reported: reported.has(r.id),
  }));

  const g = { rating: branch.googleRating, count: branch.googleReviewCount, url: branch.googlePlaceUrl?.startsWith('https://') ? branch.googlePlaceUrl : null, synced: branch.googleSyncedAt };

  return (
    <>
      {banner}
      <section aria-labelledby="h-rev" className={s.section}>
        <div className={s.head}>
          <div className={s.headText}>
            <h1 id="h-rev" className={s.h1}>ביקורות<span>.</span></h1>
            <p className={s.sub}>
              {st.total ? <><CountedText c={openLine(st.open)} /> · <CountedText c={totalLine(st.total)} /></> : 'ביקורות מאומתות מלקוחות שביקרו בעסק'}
            </p>
          </div>
          {st.total > 0 && (
            <span className={s.bigAvg} aria-label={`דירוג ממוצע ב־BeautyFind: ${st.avg} מתוך 5`}>
              <span className="ltr">{st.avg}<small> / 5</small></span>
            </span>
          )}
        </div>

        {st.total > 0 && (
          <div className={s.twoCols}>
            <div className={s.card}>
              <h2 className={s.h2}>פילוח הדירוגים</h2>
              <ul className={s.dist}>
                {st.dist.map(d => (
                  <li key={d.n}>
                    <span className={`ltr ${s.distN}`}>{d.n} ★</span>
                    <span aria-hidden="true" className={s.distTrack}>
                      <span style={{ width: `${d.pct}%`, background: fill(d.n) }} />
                    </span>
                    <span className={`ltr ${s.distCount}`}>{d.count.toLocaleString('en-US')}</span>
                    <span className={`ltr ${s.distPct}`}>{d.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${s.card} ${s.trendCard}`}>
              <h2 className={s.h2Tight}>הדירוג הממוצע בחצי השנה האחרונה</h2>
              <p className={s.scale}>בסולם <span className="ltr">{st.trend.scale}</span></p>
              {st.trend.hasLine ? (
                <svg viewBox="0 0 300 46" preserveAspectRatio="none" width="100%" height="46" role="img" aria-label={st.trend.label} className={s.trendSvg}>
                  <line x1="0" y1="45.5" x2="300" y2="45.5" stroke="#EDEFF2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <polyline points={st.trend.points} fill="none" stroke="#0B7A87" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </svg>
              ) : (
                <p className={s.trendEmpty}>המגמה תוצג כשיצטברו ביקורות בשני חודשים לפחות.</p>
              )}
              <div className={s.months}>
                {st.trend.months.map((m, i) => <span key={i}>{m}</span>)}
              </div>
              <div className={s.kpis}>
                <span className={s.kpi}>
                  <span className={`ltr ${s.kpiVal}`}>{st.replyRate}</span>
                  <span className={s.kpiLabel}>שיעור המענה שלכם</span>
                </span>
                <span className={s.kpi}>
                  <span className={s.kpiVal}>{st.replyTime ? <CountedText c={st.replyTime} /> : 'אין עדיין'}</span>
                  <span className={s.kpiLabel}>זמן תגובה חציוני</span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div className={`${s.card} ${s.google}`}>
          <div className={s.googleMain}>
            <h2 className={s.h2Tight}>דירוג Google</h2>
            <p className={s.scale}>מוצג בפרופיל לצד ביקורות BeautyFind ואינו משוקלל איתן. מענה לביקורות Google נעשה ב־Google עצמו.</p>
          </div>
          {g.rating !== null ? (
            <div className={s.googleNums}>
              <span className={s.googleVal} aria-label={`דירוג Google: ${g.rating.toFixed(1)} מתוך 5`}>
                <span className="ltr">{g.rating.toFixed(1)}<small> / 5</small></span>
              </span>
              <span className={s.googleMeta}>
                {g.count !== null && <><span className="ltr tnum">{g.count.toLocaleString('en-US')}</span> ביקורות ב־Google</>}
                {g.synced && <>{g.count !== null && ' · '}סונכרן <span className="ltr">{fmtDate(g.synced)}</span></>}
              </span>
              {g.url && (
                <a href={g.url} target="_blank" rel="noopener noreferrer" className={s.outlineLink}>
                  לביקורות ב־Google
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 3H3v8h8V9M8 2h4v4M12 2 6.5 7.5" />
                  </svg>
                  <span className="sr-only">(נפתח בחלון חדש)</span>
                </a>
              )}
            </div>
          ) : (
            <p className={s.googleEmpty}>הדירוג מ־Google עוד לא סונכרן לסניף. הוא יופיע כאן אחרי הסנכרון השבועי.</p>
          )}
        </div>

        {st.total === 0 ? (
          <div className={`${s.card} ${s.empty}`}>
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
              <path d="m10 2.8 2.2 4.5 5 .7-3.6 3.5.9 4.9L10 14.1l-4.5 2.3.9-4.9L2.8 8l5-.7L10 2.8Z" />
            </svg>
            <div>
              <h2 className={s.h2Tight}>עדיין אין ביקורות</h2>
              <p className={s.emptyText}>ביקורות ב־BeautyFind נכתבות רק אחרי ביקור מאומת ועוברות בדיקה לפני פרסום. אחרי הביקור, הלקוחות מקבלים הזמנה לכתוב ביקורת, והיא תופיע כאן עם אפשרות להגיב.</p>
            </div>
          </div>
        ) : (
          <ReviewList items={items} canEdit={ctx.canEdit} />
        )}
      </section>
    </>
  );
}
