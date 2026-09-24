import type { Metadata } from 'next';
import {
  benchmark, contactsOf, countsByType, funnel, leadsByTreatment, leadStages, parseRange, rangeWindow,
  ratingDistribution, topQueries, viewsByCity, viewsByDevice, viewsByWeekday,
} from '@/components/dashboard/analytics/data';
import a from '@/components/dashboard/analytics/analytics.module.css';
import { countKpi, RANGE_TITLE } from '@/components/dashboard/analytics/range';
import { BarList, ColumnChart, EmptyChart, Funnel, KpiGrid, RangeSwitch, shade, type Kpi } from '@/components/dashboard/charts/Charts';
import { Count, dateIL, nf, pctOf, REVIEWS, signed } from '@/components/dashboard/charts/format';
import ui from '@/components/dashboard/charts/ui.module.css';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';

// Design: project/BeautyFind Dashboard.dc.html (isAnalytics; QUERIES, GEO, DEVICE, DAYS7, BENCH, BYTREAT, RATING)

export const metadata: Metadata = { title: 'אנליטיקת פרופיל' };

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DEVICES = [
  { key: 'mobile', name: 'נייד', fill: '#0C243E' },
  { key: 'desktop', name: 'מחשב', fill: '#14B3C6' },
  { key: 'tablet', name: 'טאבלט', fill: '#CDEFF3' },
] as const;

const INTRO: Record<number, string> = {
  30: 'מה שקרה בשלושים הימים האחרונים',
  90: 'מה שקרה בתשעים הימים האחרונים',
  365: 'מה שקרה בשנה האחרונה',
};

/** Contact rate KPI: change in percentage points. */
function rateKpi(views: number, contacts: number, pViews: number, pContacts: number): Kpi {
  const label = 'שיעור פנייה';
  if (!views) return { label, value: '0%', delta: '0 נק׳', tone: 'none', note: 'אין צפיות בטווח' };
  const rate = (contacts / views) * 100;
  const value = `${rate.toFixed(1)}%`;
  if (!pViews) return { label, value, delta: 'חדש', tone: 'up', note: 'אין נתון לתקופה הקודמת' };
  const d = Math.round((rate - (pContacts / pViews) * 100) * 10) / 10;
  return { label, value, delta: signed(d, ' נק׳'), tone: d < 0 ? 'down' : d > 0 ? 'up' : 'none', note: 'מול התקופה הקודמת' };
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const ctx = await tabGuard('analytics');
  const { business, branch } = ctx;
  const range = parseRange((await searchParams).range);
  const { start, end, prevStart } = rangeWindow(range);
  const ids = business.branches.map(b => b.id);
  const anyLive = business.branches.some(b => b.status === 'live');
  const branchLive = branch?.status === 'live';

  const [cur, prev, leadsCur, leadsPrev, queries, cities, devices, weekdays, ratings, byTreat, bench] = await Promise.all([
    countsByType(ids, start, end),
    countsByType(ids, prevStart, start),
    leadStages(business.id, start, end),
    leadStages(business.id, prevStart, start),
    topQueries(ids, start, end),
    viewsByCity(ids, start, end),
    viewsByDevice(ids, start, end),
    viewsByWeekday(ids, start, end),
    ratingDistribution(ids),
    leadsByTreatment(business.id, start, end),
    branch && branchLive ? benchmark(branch.id, range, start, end) : null,
  ]);
  const funnelSteps = await funnel(business.id, ids, start, end, cur);

  const contacts = contactsOf(cur);
  const pContacts = contactsOf(prev);
  const kpis: Kpi[] = [
    countKpi('צפיות בפרופיל', cur.view, prev.view),
    countKpi('הקלקות ליצירת קשר', contacts, pContacts),
    rateKpi(cur.view, contacts, prev.view, pContacts),
    countKpi('פניות שנרשמו בלוח', leadsCur.total, leadsPrev.total),
  ];

  const noData = anyLive ? 'עדיין אין נתונים בטווח הזה.' : 'הנתונים יופיעו אחרי שהפרופיל יתפרסם ויתחיל לקבל צפיות.';

  // Search queries
  const queryViews = queries.reduce((s, q) => s + q.views, 0);
  const topQ = queries[0];
  const bestRate = queries.filter(q => q.views >= 10).sort((x, y) => y.contacts / y.views - x.contacts / x.views)[0];

  // Cities: top five, the rest grouped
  const cityTotal = cities.reduce((s, c) => s + c.value, 0);
  const geo = cities.slice(0, 5);
  const rest = cities.slice(5).reduce((s, c) => s + c.value, 0);
  const geoRows = rest > 0 ? [...geo, { name: 'אזורים אחרים', value: rest }] : geo;

  const deviceTotal = devices.mobile + devices.desktop + devices.tablet;
  const mobileShare = pctOf(devices.mobile, deviceTotal);

  const dayMax = Math.max(0, ...weekdays);
  const weekTotal = weekdays.reduce((s, v) => s + v, 0);

  const revTotal = ratings.reduce((s, r) => s + r.count, 0);
  const revAvg = revTotal ? ratings.reduce((s, r) => s + r.n * r.count, 0) / revTotal : 0;
  const googleBranches = business.branches.filter(b => b.googleRating != null);

  const treatMax = Math.max(1, ...byTreat.map(t => t.leads));

  return (
    <>
      {!ctx.canEdit ? <ReadOnlyBanner roleName={ctx.roleName} /> : null}
      <section aria-labelledby="h-an" className={ui.section}>
        <div className={ui.headRow}>
          <div style={{ minWidth: 0 }}>
            <h1 id="h-an" className={ui.h1}>אנליטיקת פרופיל<span>.</span></h1>
            <p className={ui.h1Sub}>
              {INTRO[range]}: מה חיפשו, מי ראה את הכרטיס ומה הפך לפנייה. הנתונים נמדדים ב־BeautyFind בלבד ואינם כוללים תנועה לאתר שלכם.
            </p>
          </div>
          <RangeSwitch base="/biz/analytics" current={range} />
        </div>

        <div className={a.cookie}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7.6" />
            <path d="M10 9v4.6M10 6.3v.2" />
          </svg>
          <p>האנליטיקה סופרת רק מבקרים שאישרו עוגיות אנליטיקה. מבקרים שסירבו אינם נמדדים, ולכן המספרים בפועל גבוהים יותר. פניות שנרשמו בלוח נספרות תמיד.</p>
        </div>

        <KpiGrid items={kpis} />

        <div className={ui.cardFlush}>
          <div className={ui.cardFlushHead}>
            <h2 className={ui.h2Tight}>מה הביא אנשים לכרטיס</h2>
            <p className={ui.meta}>ביטויי חיפוש בתוך BeautyFind · צפיות ופניות</p>
          </div>
          {queries.length ? (
            <>
              <div aria-hidden="true" className={`${ui.gridHead} ${a.queryGrid}`}>
                <span>ביטוי</span>
                <span className={ui.numHead}>צפיות</span>
                <span className={ui.numHead}>פניות</span>
                <span className={ui.numHead}>שיעור פנייה</span>
              </div>
              <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {queries.map(q => (
                  <li
                    key={q.term}
                    className={`${ui.gridRow} ${a.queryGrid}`}
                    aria-label={`${q.term}: ${nf(q.views)} צפיות, ${nf(q.contacts)} פניות`}
                  >
                    <span className={a.term}>
                      <span className={a.termText}>{q.term}</span>
                      <span aria-hidden="true" className={a.termBar}>
                        <span style={{ width: `${Math.round((q.views / Math.max(1, topQ.views)) * 100)}%` }} />
                      </span>
                    </span>
                    <span className={`${ui.num} ${a.numStrong}`}>{nf(q.views)}</span>
                    <span className={`${ui.num} ${a.numSoft}`}>{nf(q.contacts)}</span>
                    <span className={`${ui.num} ${a.numRate}`}>{q.views ? `${((q.contacts / q.views) * 100).toFixed(1)}%` : '0%'}</span>
                  </li>
                ))}
              </ul>
              <p className={ui.flushNote}>
                ״{topQ.term}״ מביא <span className="ltr">{pctOf(topQ.views, queryViews)}%</span> מהצפיות שהגיעו מחיפוש.
                {bestRate && bestRate.contacts > 0 ? (
                  <>
                    {' '}שיעור הפנייה הגבוה ביותר הוא בביטוי ״{bestRate.term}״: <span className="ltr">{((bestRate.contacts / bestRate.views) * 100).toFixed(1)}%</span>.
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <p className={ui.emptyRow}>{anyLive ? 'עדיין אין צפיות שהגיעו מחיפוש בטווח הזה.' : 'ביטויי החיפוש יופיעו אחרי שהפרופיל יתפרסם ויתחיל לקבל צפיות.'}</p>
          )}
        </div>

        <div className={`${ui.twoCols} ${ui.alignStart}`}>
          <div className={ui.card}>
            <h2 className={ui.h2Tight}>מאיפה מגיעים הצופים</h2>
            <p className={ui.metaGap}>
              לפי עיר המחפש · <span className="ltr">{nf(cityTotal)}</span> צפיות
            </p>
            {geoRows.length ? (
              <BarList
                label={geoRows.map(g => `${g.name}: ${nf(g.value)}`).join(', ')}
                items={geoRows.map(g => ({ key: g.name, name: g.name, value: g.value, share: `${pctOf(g.value, cityTotal)}%` }))}
                max={geoRows[0].value}
                valueWidth={46}
              />
            ) : (
              <EmptyChart height={120}>{noData}</EmptyChart>
            )}
          </div>

          <div className={ui.stack}>
            <div className={ui.card}>
              <h2 className={ui.h2Gap} style={{ marginBottom: 16 }}>מכשיר</h2>
              {deviceTotal ? (
                <>
                  <BarList
                    label={DEVICES.map(d => `${d.name}: ${pctOf(devices[d.key], deviceTotal)}%`).join(', ')}
                    items={DEVICES.map(d => ({ key: d.key, name: d.name, value: pctOf(devices[d.key], deviceTotal), display: `${pctOf(devices[d.key], deviceTotal)}%`, fill: d.fill }))}
                    max={100}
                    nameWidth={72}
                    valueWidth={44}
                  />
                  {mobileShare >= 60 ? (
                    <p className={ui.insight} style={{ fontSize: 13, color: 'var(--muted)' }}>
                      <span className="ltr">{mobileShare}%</span> מהצפיות מהנייד, ולכן כפתור WhatsApp וקישור Waze חשובים יותר מכל טקסט ארוך.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className={ui.emptyInline}>{noData}</p>
              )}
            </div>
            <div className={ui.card}>
              <h2 className={ui.h2Gap} style={{ marginBottom: 16 }}>צפיות לפי יום</h2>
              {weekTotal ? (
                <ColumnChart
                  dir="rtl"
                  label={`צפיות לפי יום בשבוע: ${WEEKDAYS.map((d, i) => `${d} ${weekdays[i]}`).join(', ')}`}
                  cols={WEEKDAYS.map((d, i) => ({ label: d, value: weekdays[i], fill: shade(weekdays[i], dayMax, 0.74) }))}
                  height={120}
                  gap="6px"
                />
              ) : (
                <EmptyChart height={120}>{noData}</EmptyChart>
              )}
            </div>
          </div>
        </div>

        {bench ? (
          <div className={ui.card}>
            <h2 className={ui.h2Tight}>אתם מול החציון באזור</h2>
            <p className={ui.metaGap} style={{ marginBottom: 18 }}>
              <span className="ltr">{nf(bench.peers)}</span> סניפים נוספים בתחום {bench.categoryName} ב{bench.regionName} · {RANGE_TITLE[range]}
            </p>
            <ul className={a.bench}>
              {bench.rows.map(b => {
                const top = Math.max(1, b.you, b.med);
                const better = b.higherIsBetter ? b.you >= b.med : b.you <= b.med;
                const verdict = b.you === b.med ? 'בדיוק בחציון' : better ? 'מעל החציון באזור' : 'מתחת לחציון באזור';
                return (
                  <li key={b.key} className={a.benchRow} aria-label={`${b.name}: אתם ${nf(b.you)}, החציון ${nf(b.med)}. ${verdict}`}>
                    <span className={a.benchName}>{b.name}</span>
                    <span className={a.benchBars} aria-hidden="true">
                      <span className={a.benchLine}>
                        <span className={a.benchTrack}>
                          <span style={{ width: `${Math.round((b.you / top) * 100)}%`, background: better ? '#0B7A87' : '#D98A74' }} />
                        </span>
                        <span className={a.benchYou}>{nf(b.you)}</span>
                      </span>
                      <span className={a.benchLine}>
                        <span className={a.benchTrack}>
                          <span style={{ width: `${Math.round((b.med / top) * 100)}%`, background: '#D4D4D4' }} />
                        </span>
                        <span className={a.benchMed}>{nf(b.med)}</span>
                      </span>
                    </span>
                    <span className={a.benchVerdict} style={{ color: better ? '#0B7A87' : '#A8432C' }} aria-hidden="true">{verdict}</span>
                  </li>
                );
              })}
            </ul>
            <div className={a.benchKey} aria-hidden="true">
              <span><i style={{ background: '#0B7A87' }} />אתם</span>
              <span><i style={{ background: '#D4D4D4' }} />החציון באזור</span>
            </div>
          </div>
        ) : null}

        <div className={`${ui.twoCols} ${ui.alignStart}`}>
          <div className={ui.card}>
            <div className={a.ratingHead}>
              <div style={{ minWidth: 0 }}>
                <h2 className={ui.h2Tight}>פילוח הדירוגים</h2>
                <p className={ui.meta}>ביקורות BeautyFind מאומתות · <Count n={revTotal} {...REVIEWS} /></p>
              </div>
              {revTotal ? (
                <span className={a.bigNum}>{revAvg.toFixed(1)}<small>/ 5</small></span>
              ) : null}
            </div>
            {revTotal ? (
              <BarList
                label={ratings.map(r => `${r.n} כוכבים: ${r.count}`).join(', ')}
                items={ratings.map(r => ({
                  key: String(r.n),
                  name: <span className={a.stars}>{r.n} ★</span>,
                  value: r.count,
                  share: `${pctOf(r.count, revTotal)}%`,
                  fill: r.n >= 4 ? '#14B3C6' : r.n === 3 ? '#7ED7E1' : '#D98A74',
                }))}
                max={revTotal}
                nameWidth={30}
                valueWidth={44}
                track
              />
            ) : (
              <EmptyChart height={120}>ביקורות BeautyFind נכתבות רק אחרי ביקור מאומת. הפילוח יופיע עם הביקורת הראשונה שתתפרסם.</EmptyChart>
            )}
          </div>

          <div className={ui.card}>
            <h2 className={ui.h2Tight}>דירוג Google</h2>
            <p className={ui.metaGap}>מסתנכרן פעם בשבוע ומוצג בנפרד, בלי שקלול עם ביקורות BeautyFind.</p>
            {googleBranches.length ? (
              <ul className={a.google}>
                {googleBranches.map(b => (
                  <li key={b.id} className={a.googleRow}>
                    <span className={a.googleName}>
                      {b.name}
                      <span className={a.googleMeta}>
                        {b.googleReviewCount != null ? <><Count n={b.googleReviewCount} {...REVIEWS} /> ב־Google</> : 'מספר הביקורות לא סונכרן'}
                        {b.googleSyncedAt ? <> · עודכן <span className="ltr">{dateIL(b.googleSyncedAt)}</span></> : null}
                      </span>
                    </span>
                    <span className={a.bigNum}>{(b.googleRating ?? 0).toFixed(1)}<small>/ 5</small></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={ui.emptyInline}>עדיין לא סונכרן דירוג Google לסניפים שלכם. הוא יופיע כאן אחרי הסנכרון השבועי הראשון.</p>
            )}
          </div>
        </div>

        <div className={ui.card}>
          <h2 className={ui.h2Tight}>מצפייה ללקוח</h2>
          <p className={ui.metaGap} style={{ marginBottom: 18 }}>{RANGE_TITLE[range]}</p>
          {funnelSteps.every(x => x.value === 0) ? <EmptyChart height={120}>{noData}</EmptyChart> : <Funnel steps={funnelSteps} />}
          <p className={ui.foot}>
            צפיות והקלקות נמדדות אוטומטית. משלב ״פניות שנרשמו בלוח״ ומטה הנתון מגיע ממה שתיעדתם בלשונית לקוחות, ולכן שיחת טלפון שלא נרשמה לא תופיע כאן.
          </p>
        </div>

        {byTreat.length ? (
          <div className={ui.cardFlush}>
            <div className={ui.cardFlushHead}>
              <h2 className={ui.h2Tight}>אילו טיפולים מביאים פניות</h2>
              <p className={ui.meta}>פניות שנרשמו בלוח לפי טיפול, מול כמה מהן נקבע תור</p>
            </div>
            <div aria-hidden="true" className={a.treatHead}>
              <span>טיפול</span>
              <span style={{ width: 52, textAlign: 'right' }}>פניות</span>
              <span style={{ width: 44, textAlign: 'right' }}>תורים</span>
              <span style={{ width: 58 }}>המרה</span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {byTreat.map(t => (
                <li key={t.name} className={a.treatRow} aria-label={`${t.name}: ${t.leads} פניות, ${t.booked} תורים`}>
                  <span className={a.treatName}>{t.name}</span>
                  <span aria-hidden="true" className={a.treatBar}>
                    <span style={{ width: `${Math.round((t.leads / treatMax) * 100)}%` }} />
                  </span>
                  <span className={a.treatNum}>{nf(t.leads)}</span>
                  <span className={a.treatNumSoft}>{nf(t.booked)}</span>
                  <span className={a.treatRate}><span className="ltr">{pctOf(t.booked, t.leads)}%</span></span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}
