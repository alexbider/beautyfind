import Link from 'next/link';
import { redirect } from 'next/navigation';
import { contactsByHour, contactsOf, countsByType, funnel, parseRange, rangeWindow, series } from '@/components/dashboard/analytics/data';
import { countKpi, RANGE_TITLE, SERIES_NOTE, SERIES_POINTS, seriesTicks } from '@/components/dashboard/analytics/range';
import { BarList, ColumnChart, EmptyChart, Funnel, KpiGrid, RangeSwitch, shade, TrafficChart, TrafficLegend } from '@/components/dashboard/charts/Charts';
import { BUSINESSES, Count, nf, pctOf } from '@/components/dashboard/charts/format';
import ui from '@/components/dashboard/charts/ui.module.css';
import { DASH_VIEWS } from '@/components/dashboard/nav';
import s from '@/components/dashboard/overview/overview.module.css';
import { TaskList } from '@/components/dashboard/overview/TaskList';
import { completionPct, profileTasks } from '@/components/dashboard/overview/tasks';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { ROUTES } from '@/lib/routes';
import { bizContext } from '@/lib/server/biz';
import { db } from '@/lib/server/db';

// Design: project/BeautyFind Dashboard.dc.html (isOverview; KPI, SERIES, TASKS, HOURS, FUNNEL_AUTO)

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const pad = (h: number) => String(h).padStart(2, '0');

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const ctx0 = await bizContext();
  // Roles without the overview (e.g. accounting) land on their first permitted tab.
  if (ctx0.perms.overview === 'none') {
    const first = DASH_VIEWS.find(v => v.key !== 'team' && v.key !== 'overview' && ctx0.perms[v.key] !== 'none');
    redirect(first?.href ?? '/');
  }
  const ctx = await tabGuard('overview');
  const { business, branch, perms } = ctx;

  const range = parseRange((await searchParams).range);
  const { start, end, prevStart } = rangeWindow(range);
  const ids = business.branches.map(b => b.id);
  const anyLive = business.branches.some(b => b.status === 'live');
  const points = SERIES_POINTS[range];

  const [cur, prev, ser, byHour, detail, firstCat] = await Promise.all([
    countsByType(ids, start, end),
    countsByType(ids, prevStart, start),
    series(ids, start, end, points),
    contactsByHour(ids, start, end),
    branch
      ? db.branch.findUnique({
          where: { id: branch.id },
          include: {
            treatments: { select: { priceAgorot: true, isPublished: true } },
            categories: { include: { category: { select: { isMedical: true } } } },
            region: { select: { name: true } },
            _count: { select: { reviews: { where: { status: 'published', businessReply: null } } } },
          },
        })
      : null,
    branch ? db.branchCategory.findFirst({ where: { branchId: branch.id }, include: { category: true } }) : null,
  ]);
  const funnelSteps = await funnel(business.id, ids, start, end, cur);

  // Profile completion for the branch shown in the header.
  const tasks = detail
    ? profileTasks({
        treatments: detail.treatments,
        hours: detail.hours,
        gallery: detail.gallery,
        wazeUrl: detail.wazeUrl,
        medicalResponsibleId: detail.medicalResponsibleId,
        hasMedicalCategory: detail.categories.some(c => c.category.isMedical),
        openReviews: detail._count.reviews,
      })
    : [];
  const completion = completionPct(tasks);

  // "Your field in the city": how many live listings share this list. No position is claimed.
  const listSize =
    detail && firstCat
      ? await db.branch.count({ where: { status: 'live', regionSlug: detail.regionSlug, categories: { some: { categorySlug: firstCat.categorySlug } } } })
      : 0;
  const listName = detail && firstCat ? `${firstCat.category.name} ב${detail.region.name}` : null;
  const branchLive = detail?.status === 'live';

  const contacts = contactsOf(cur);
  const kpis = [
    countKpi('צפיות בפרופיל', cur.view, prev.view),
    countKpi('הקלקות לטלפון', cur.call_click, prev.call_click),
    countKpi('פניות ב־WhatsApp', cur.whatsapp_click, prev.whatsapp_click),
    countKpi('ניווט ב־Waze', cur.waze_click, prev.waze_click),
  ];

  const sumViews = ser.views.reduce((a, b) => a + b, 0);
  const sumContacts = ser.contacts.reduce((a, b) => a + b, 0);
  const half = Math.floor(points / 2);
  const early = ser.views.slice(0, half).reduce((a, b) => a + b, 0);
  const late = ser.views.slice(points - half).reduce((a, b) => a + b, 0);
  const trend = early > 0 && late > early * 1.1 ? ', במגמת עלייה' : early > 0 && late < early * 0.9 ? ', במגמת ירידה' : '';
  const trafficSummary = `בטווח הנבחר: ${nf(sumViews)} צפיות ו־${nf(sumContacts)} פניות בכל הערוצים${trend}.`;

  const sources = [
    { key: 'whatsapp', name: 'WhatsApp', value: cur.whatsapp_click, fill: '#14B3C6' },
    { key: 'phone', name: 'טלפון', value: cur.call_click, fill: '#0C243E' },
    { key: 'waze', name: 'Waze', value: cur.waze_click, fill: '#7ED7E1' },
    { key: 'form', name: 'טופס', value: cur.form_submit, fill: '#8A96A3' },
    { key: 'booking', name: 'קביעת תור', value: cur.booking_start, fill: '#0B7A87' },
    { key: 'other', name: 'יצירת קשר', value: cur.contact_click, fill: '#C3CBD3' },
  ].filter(x => x.value > 0 || ['whatsapp', 'phone', 'waze', 'form'].includes(x.key));

  const hourVals = HOURS.map(h => byHour.get(h) ?? 0);
  const hourTotal = hourVals.reduce((a, b) => a + b, 0);
  const allHourTotal = [...byHour.values()].reduce((a, b) => a + b, 0);
  const maxHour = Math.max(0, ...hourVals);
  const peakHour = HOURS[hourVals.indexOf(maxHour)];
  let bestAt = 0;
  let bestSum = -1;
  for (let i = 0; i + 3 <= hourVals.length; i++) {
    const sum = hourVals[i] + hourVals[i + 1] + hourVals[i + 2];
    if (sum > bestSum) { bestSum = sum; bestAt = i; }
  }
  const outside = allHourTotal - hourTotal;

  const emptyLine = anyLive
    ? 'עדיין אין צפיות בטווח הזה. הגרף יתמלא עם הצפיות הראשונות בפרופיל.'
    : 'הנתונים יופיעו כשהפרופיל יתפרסם ויתחילו צפיות.';
  const funnelEmpty = funnelSteps.every(x => x.value === 0);

  return (
    <>
      {!ctx.canEdit ? <ReadOnlyBanner roleName={ctx.roleName} /> : null}
      <section aria-labelledby="h-kpi" className={ui.section}>
        <div className={ui.headRow}>
          <h1 id="h-kpi" className={ui.h1}>{RANGE_TITLE[range]}<span>.</span></h1>
          <RangeSwitch base="/biz" current={range} />
        </div>

        <KpiGrid items={kpis} />

        <div className={ui.card}>
          <div className={ui.cardHead}>
            <div style={{ minWidth: 0 }}>
              <h2 className={ui.h2Tight}>תנועה לאורך זמן</h2>
              <p className={ui.meta}>{SERIES_NOTE[range]}</p>
            </div>
            <TrafficLegend />
          </div>
          {sumViews + sumContacts > 0 ? (
            <TrafficChart
              views={ser.views}
              contacts={ser.contacts}
              ticks={seriesTicks(range, start, end)}
              summary={trafficSummary}
            />
          ) : (
            <EmptyChart height={180}>{emptyLine}</EmptyChart>
          )}
          <p className={ui.foot}>נספרים רק מבקרים שאישרו עוגיות אנליטיקה, ולכן המספרים בפועל גבוהים מעט יותר.</p>
        </div>

        <div className={ui.twoCols}>
          <div className={ui.card}>
            <div className={s.completionHead}>
              <h2 className={ui.h2}>שלמות הפרופיל</h2>
              <span className={s.completionValue}>{completion}%</span>
            </div>
            <div aria-hidden="true" className={s.progress}>
              <span style={{ width: `${completion}%` }} />
            </div>
            {tasks.length ? (
              <TaskList tasks={tasks} perms={perms} />
            ) : (
              <p className={ui.emptyInline}>עדיין אין סניף בעסק. אחרי הוספת הסניף הראשון תופיע כאן רשימת ההשלמה של הפרופיל.</p>
            )}
          </div>

          <div className={ui.stack}>
            <div className={ui.card}>
              <h2 className={ui.h2Gap}>מאיפה הגיעו הפניות</h2>
              {contacts > 0 ? (
                <BarList
                  label={sources.map(x => `${x.name}: ${nf(x.value)}`).join(', ')}
                  items={sources.map(x => ({ key: x.key, name: x.name, value: x.value, fill: x.fill }))}
                  nameWidth={86}
                  valueWidth={52}
                  track
                  regularName
                />
              ) : (
                <p className={ui.emptyInline}>
                  {anyLive ? 'עדיין אין פניות בטווח הזה.' : 'הפניות יופיעו כשהפרופיל יתפרסם.'} כאן תראו כמה לקוחות לחצו על WhatsApp, טלפון, Waze או הטופס.
                </p>
              )}
              <p className={ui.foot}>פנייה נספרת כשלקוח לוחץ על טלפון, WhatsApp, Waze, טופס או קביעת תור, לא על כל צפייה בפרופיל.</p>
            </div>

            <div className={s.dark}>
              <h2 className={s.darkTitle}>התחום שלכם בעיר</h2>
              <p className={s.darkText}>
                {!listName ? (
                  <>אחרי בחירת קטגוריה ראשית תופיעו ברשימת התחום באזור שלכם. תשלום אינו משפיע על הדירוג האורגני.</>
                ) : branchLive ? (
                  <>
                    ברשימת {listName} מופיעים היום <Count n={listSize} {...BUSINESSES} />. הסדר נקבע לפי דירוג Google, מספר הביקורות ושלמות הפרופיל. תשלום אינו משפיע על הדירוג האורגני.
                  </>
                ) : (
                  <>
                    הפרופיל עדיין לא מופיע ברשימות. אחרי הפרסום תוצגו ברשימת {listName}, לפי דירוג Google, מספר הביקורות ושלמות הפרופיל. תשלום אינו משפיע על הדירוג האורגני.
                  </>
                )}
              </p>
              <div className={s.darkActions}>
                <Link href={ROUTES.sponsorship} className={s.darkPrimary}>מידע על פרסום</Link>
                <Link href={ROUTES.listingStandards} className={s.darkGhost}>מה משפיע על הדירוג</Link>
              </div>
            </div>
          </div>
        </div>

        <div className={ui.card}>
          <h2 className={ui.h2Tight}>מתי פונים אליכם</h2>
          <p className={ui.metaGap} style={{ marginBottom: 18 }}>פניות לפי שעה ביום, ימים ראשון–שישי בטווח הנבחר</p>
          {hourTotal > 0 ? (
            <>
              <ColumnChart
                label={`פניות לפי שעה: ${HOURS.map((h, i) => `${pad(h)}:00 ${hourVals[i]}`).join(', ')}`}
                cols={HOURS.map((h, i) => ({ label: pad(h), value: hourVals[i], fill: shade(hourVals[i], maxHour) }))}
                height={136}
                gap="clamp(4px, .8vw, 9px)"
              />
              <p className={ui.insight}>
                הכי הרבה פניות נכנסות בין <span className="ltr">{pad(HOURS[bestAt])}:00</span> ל־<span className="ltr">{pad(HOURS[bestAt] + 3)}:00</span> (
                <span className="ltr">{nf(bestSum)}</span> מתוך <span className="ltr">{nf(hourTotal)}</span>). שעת השיא היא{' '}
                <span className="ltr">{pad(peakHour)}:00</span>, כדאי שמישהו יהיה זמין למענה אז.
                {outside > 0 ? <> עוד <Count n={outside} one="פנייה אחת הגיעה" two="שתי פניות הגיעו" many="פניות הגיעו" /> מחוץ לשעות האלה.</> : null}
              </p>
            </>
          ) : (
            <EmptyChart height={136}>
              {anyLive ? 'עדיין אין פניות בימים ראשון–שישי בטווח הזה.' : 'הנתונים יופיעו כשהפרופיל יתפרסם ויתחילו פניות.'}
            </EmptyChart>
          )}
        </div>

        <div className={ui.card}>
          <h2 className={ui.h2Tight}>מצפייה ללקוח</h2>
          <p className={ui.metaGap} style={{ marginBottom: 18 }}>{RANGE_TITLE[range]}</p>
          {funnelEmpty ? <EmptyChart height={120}>{emptyLine}</EmptyChart> : <Funnel steps={funnelSteps} />}
          <p className={ui.foot}>
            צפיות והקלקות נמדדות אוטומטית. משלב &quot;פניות שנרשמו בלוח&quot; ומטה הנתון מגיע ממה שתיעדתם בלשונית לקוחות, ולכן שיחת טלפון שלא נרשמה לא תופיע כאן.
            {funnelSteps[0].value > 0 ? <> שיעור הפנייה: <span className="ltr">{pctOf(funnelSteps[1].value, funnelSteps[0].value)}%</span> מהצפיות.</> : null}
          </p>
        </div>
      </section>
    </>
  );
}
