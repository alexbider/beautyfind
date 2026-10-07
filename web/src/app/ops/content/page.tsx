import type { Prisma } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, Tabs, dateIL, dateTimeIL, int, pct, ui } from '@/components/ops/ui';
import { PRIVATE_AREAS, PRIVATE_PREFIXES } from '@/lib/indexing';
import { indexingPolicy } from '@/lib/server/indexing';
import { siteUrl } from '@/lib/server/site';
import { analytics30, articles, categoryRows, indexingFacts, JSON_LD_TYPES, pageRows, sitemapFacts } from './data';
import { IndexingToggle } from './IndexingControls';
import { GoogleLimitsForm, GoogleRunButtons, GoogleToggle } from './GoogleIndexingControls';
import { googleIndexingStatus, propertyOf } from '@/lib/server/googleIndexing';
import { db } from '@/lib/server/db';
import { SeoForm } from './SeoForm';

export const metadata: Metadata = { title: 'תוכן ו־SEO · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // the "run now" button on the Google tab runs the indexer inside this request

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const TABS = [
  { key: 'pages', name: 'עמודים' }, { key: 'indexing', name: 'אינדוקס' }, { key: 'google', name: 'גוגל' }, { key: 'posts', name: 'פוסטים' }, { key: 'categories', name: 'קטגוריות' }, { key: 'settings', name: 'הגדרות SEO' },
  { key: 'schema', name: 'סכמה' }, { key: 'redirects', name: 'הפניות ו־404' }, { key: 'sitemap', name: 'מפת אתר ו־robots' }, { key: 'performance', name: 'ביצועים ומעקב' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const KIND: Record<string, string> = { page: 'עמוד', medical: 'עמוד רפואי', region: 'עמוד אזור', category: 'עמוד תחום', legal: 'משפטי' };
const scoreTone = (s: number): 'ok' | 'warn' | 'bad' => (s >= 70 ? 'ok' : s >= 45 ? 'warn' : 'bad');

export default async function ContentPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('content', 'view', '/ops/content');
  const sp = await searchParams;
  const tab = (TABS.some(t => t.key === one(sp.tab)) ? one(sp.tab) : 'pages') as Tab;
  const filter = one(sp.filter) || 'all';
  const [level, pages] = await Promise.all([areaLevel(user, 'content'), pageRows()]);
  const canEdit = atLeast(level, 'edit');
  const avg = pages.length ? Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length) : 0;
  const noDesc = pages.filter(p => !p.description).length;
  const noindex = pages.filter(p => p.noindex).length;
  const low = pages.filter(p => p.score < 70).length;
  const shown = pages.filter(p => (filter === 'low' ? p.score < 70 : filter === 'nodesc' ? !p.description : filter === 'noindex' ? p.noindex : filter === 'custom' ? p.overridden : true));

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="צמיחה" title="תוכן ו־SEO" lead="עמודים עם ניתוח SEO לכל פריט, קטגוריות, סכמה, הפניות, מפת אתר ומעקב." />
      <Tabs label="תוכן" current={tab} items={TABS.map(t => ({ key: t.key, name: t.name, href: `/ops/content?tab=${t.key}` }))} />
      {tab === 'pages' ? (
        <>
          <Kpis items={[
            { label: 'עמודים', value: int(pages.length), note: `${int(pages.filter(p => p.overridden).length)} עם הגדרות מותאמות` },
            { label: 'ציון SEO ממוצע', value: int(avg), note: 'מתוך 100', tone: scoreTone(avg) },
            { label: 'ללא תיאור מותאם', value: int(noDesc), note: 'משתמשים בברירת המחדל של הקוד', tone: noDesc ? 'warn' : undefined },
            { label: 'noindex', value: int(noindex), note: 'מוסתרים מגוגל', tone: noindex ? 'warn' : undefined },
          ]} />
          <div className={ui.toolbar}>
            <Pills current={filter} items={[{ key: 'all', name: 'הכול', count: pages.length, href: '/ops/content' }, { key: 'low', name: 'ציון מתחת ל־70', count: low, href: '/ops/content?filter=low' }, { key: 'nodesc', name: 'ללא תיאור', count: noDesc, href: '/ops/content?filter=nodesc' }, { key: 'noindex', name: 'noindex', count: noindex, href: '/ops/content?filter=noindex' }, { key: 'custom', name: 'מותאמים', count: pages.filter(p => p.overridden).length, href: '/ops/content?filter=custom' }]} />
          </div>
          <Card flush>
            <Table head={['כותרת', 'סוג', 'מילת מפתח', 'ציון SEO', 'אינדקס', 'עודכן', '']} foot="הציון מחושב מאורך הכותרת והתיאור, מילת המפתח ומצב האינדקס. עמודי עסקים מכוונים בכרטיס העסק.">
              {shown.map(p => (
                <tr key={p.path}>
                  <td><a href={`${siteUrl()}${p.path}`} className={ui.rowLink} target="_blank" rel="noreferrer">{p.name}</a><span className={ui.sub} dir="ltr">{p.path}</span><span className={ui.sub}>{p.title}</span></td>
                  <td>{KIND[p.kind]}</td>
                  <td>{p.keyword ?? <span className={ui.sub}>—</span>}</td>
                  <td><Chip tone={scoreTone(p.score)}>{int(p.score)}</Chip>{p.notes.length ? <span className={ui.sub}>{p.notes.join(' · ')}</span> : null}</td>
                  <td>{p.noindex ? <Chip tone="warn">noindex</Chip> : <Chip tone="ok">index</Chip>}</td>
                  <td className={ui.num}>{p.updatedAt ? dateIL(p.updatedAt) : '—'}</td>
                  <td><SeoForm path={p.path} title={p.title} description={p.description} keyword={p.keyword} noindex={p.noindex} defaultTitle={p.defaultTitle} defaultDescription={p.defaultDescription} keywordHint={p.keywordHint} canEdit={canEdit} /></td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      ) : null}
      {tab === 'indexing' ? <IndexingTab canEdit={canEdit} /> : null}
      {tab === 'google' ? <GoogleTab canEdit={canEdit} filter={one(sp.g) || 'all'} /> : null}
      {tab === 'posts' ? <PostsTab /> : null}
      {tab === 'categories' ? <CategoriesTab /> : null}
      {tab === 'settings' ? (
        <Card title="הגדרות SEO גלובליות">
          <ul className={ui.list}>
            <li className={ui.note}><b>כתובת האתר:</b> <span dir="ltr">{siteUrl()}</span> (SITE_URL)</li>
            <li className={ui.note}><b>תבנית כותרת:</b> <span dir="ltr">%s | BeautyFind</span>; דף הבית עם כותרת מוחלטת</li>
            <li className={ui.note}><b>שפה וכיוון:</b> he, rtl · Open Graph he_IL · תמונת שיתוף ברירת מחדל hero-clinic</li>
            <li className={ui.note}><b>קנוניקל:</b> כל עמוד ציבורי מצהיר על הכתובת הקנונית שלו; סלאגים בעברית מקודדים ב־sitemap</li>
            <li className={ui.note}><b>רשומות עסקים:</b> כותרת SEO מותאמת (שם + מיקום) עד שהעסק נתבע, אז הכותרת של הבעלים</li>
          </ul>
          <p className={ui.hint} style={{ marginTop: 10 }}>הערכים האלה בקוד; שינוי שלהם הוא שינוי קוד. כותרות ותיאורים של עמודים בודדים נערכים בלשונית ״עמודים״.</p>
        </Card>
      ) : null}
      {tab === 'schema' ? (
        <Card title="נתונים מובנים (JSON-LD)" flush>
          <Table head={['סוג', 'איפה', 'הערה']}>{JSON_LD_TYPES.map(t => <tr key={t.type}><td className={ui.mono} dir="ltr">{t.type}</td><td>{t.where}</td><td>{t.note}</td></tr>)}</Table>
        </Card>
      ) : null}
      {tab === 'redirects' ? (
        <Card title="הפניות ו־404">
          <ul className={ui.list}>
            <li className={ui.note}><b>הפניה קבועה (301):</b> <span dir="ltr">/:region/biz/:slug</span> אל <span dir="ltr">/:region/:category/:slug</span>, הכתובת עם התחום הראשון של העסק.</li>
            <li className={ui.note}><b>עסק שהוסתר או נמחק:</b> העמוד מחזיר 404 עם עמוד ״לא נמצא״ ממותג; אין הפניה אוטומטית לעסק אחר.</li>
            <li className={ui.note}><b>רישום 404:</b> לא נשמר; הדרך לראות עמודים חסרים היא Search Console (עוד לא מחובר).</li>
          </ul>
        </Card>
      ) : null}
      {tab === 'sitemap' ? <SitemapTab /> : null}
      {tab === 'performance' ? <PerformanceTab /> : null}
    </AdminShell>
  );
}

const G_FILTERS: Array<{ key: string; name: string; where: Prisma.IndexingUrlWhereInput }> = [
  { key: 'all', name: 'הכול', where: {} },
  { key: 'new', name: 'חדשות', where: { isNew: true } },
  { key: 'not', name: 'לא באינדקס', where: { indexed: false } },
  { key: 'yes', name: 'באינדקס', where: { indexed: true } },
  { key: 'unknown', name: 'לא נבדקו', where: { indexed: null } },
  { key: 'errors', name: 'שגיאות', where: { OR: [{ inspectError: { not: null } }, { lastSubmitError: { not: null } }] } },
];
const TRIGGER: Record<string, string> = { cron: 'מתוזמן', manual: 'ידני', publish: 'אחרי פרסום' };

async function GoogleTab({ canEdit, filter }: { canEdit: boolean; filter: string }) {
  const st = await googleIndexingStatus();
  const f = G_FILTERS.find(x => x.key === filter) ?? G_FILTERS[0];
  const live = { removedAt: null };
  const [counts, rows, runs] = await Promise.all([
    Promise.all(G_FILTERS.map(x => db.indexingUrl.count({ where: { ...live, ...x.where } }))),
    db.indexingUrl.findMany({ where: { ...live, ...f.where }, orderBy: [{ isNew: 'desc' }, { firstSeenAt: 'desc' }], take: 100 }),
    db.indexingRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);
  const count = Object.fromEntries(G_FILTERS.map((x, i) => [x.key, counts[i]])) as Record<string, number>;
  const s = st.settings;
  const ready = st.configured && st.cron && !st.blockedBy;
  return (
    <div className={ui.stack}>
      <Kpis items={[
        { label: 'מצב', value: !s.enabled ? 'כבוי' : !st.configured ? 'חסר מפתח' : st.blockedBy ? 'האתר חסום' : 'פעיל', tone: s.enabled && ready ? 'ok' : s.enabled ? 'bad' : 'warn', note: st.clientEmail ? <span dir="ltr">{st.clientEmail}</span> : 'GOOGLE_INDEXING_CREDENTIALS' },
        { label: 'באינדקס של גוגל', value: int(count.yes), note: `מתוך ${int(count.all)} כתובות במפת האתר` },
        { label: 'לא באינדקס', value: int(count.not), note: `${int(count.unknown)} עוד לא נבדקו`, tone: count.not ? 'warn' : undefined },
        { label: 'נשלחו ב־24 שעות', value: int(st.submittedToday), note: `מכסה ${int(s.dailySubmitLimit)} · נבדקו ${int(st.inspectedToday)}/${int(s.dailyInspectLimit)}` },
      ]} />
      <div className={ui.grid2}>
        <Card title="אינדוקס אוטומטי" flush>
          <GoogleToggle name="enabled" checked={s.enabled} title="הפעלה" sub="המתג הראשי. כבוי: שום דבר לא נשלח לגוגל" canEdit={canEdit} />
          <GoogleToggle name="submitNew" checked={s.submitNew} title="שליחת עמודים חדשים" sub="עמוד שנוסף למפת האתר נשלח בהרצה הבאה; מאמר נשלח מיד עם הפרסום" canEdit={canEdit} />
          <GoogleToggle name="submitBacklog" checked={s.submitBacklog} title="שליחת עמודים שלא באינדקס" sub="עמודים קיימים שגוגל לא הכניס לאינדקס, או שעוד לא נבדקו. עד 3 פעמים, כל 14 יום" canEdit={canEdit} />
          <GoogleToggle name="inspect" checked={s.inspect} title="בדיקת מצב האינדקס" sub="URL Inspection של Search Console: מה באינדקס ומה לא. כל שבוע ללא אינדקס, כל חודש עם" canEdit={canEdit} />
        </Card>
        <Card title="מכסות ונכס">
          <GoogleLimitsForm values={{ dailySubmitLimit: s.dailySubmitLimit, dailyInspectLimit: s.dailyInspectLimit, property: s.property }} defaultProperty={propertyOf({ ...s, property: '' })} canEdit={canEdit} />
          <div style={{ marginTop: 14 }}><GoogleRunButtons canEdit={canEdit} configured={st.configured} /></div>
        </Card>
      </div>
      <Card title="הגדרת המערכת" sub="מה צריך כדי שהאינדוקס ירוץ">
        <ul className={ui.list}>
          <li className={ui.note}>{st.configured ? <Chip tone="ok">מוגדר</Chip> : <Chip tone="bad">חסר</Chip>} <b>מפתח חשבון שירות:</b> <span className={ui.mono}>GOOGLE_INDEXING_CREDENTIALS</span> ב־Vercel (קובץ ה־JSON של חשבון השירות, כמו שהוא או ב־base64). לא נשמר במסד ולא מוצג כאן.</li>
          <li className={ui.note}>{st.cron ? <Chip tone="ok">מוגדר</Chip> : <Chip tone="bad">חסר</Chip>} <b>הרצה מתוזמנת:</b> <span className={ui.mono}>CRON_SECRET</span> ב־Vercel; הריצה היומית ב־06:17 (שעון ישראל) ב־<span className={ui.mono} dir="ltr">/api/cron/indexing</span>.</li>
          <li className={ui.note}>{st.blockedBy ? <Chip tone="bad">חסום</Chip> : <Chip tone="ok">פתוח</Chip>} <b>מדיניות האינדוקס:</b> רק כתובות ממפת האתר נשלחות, כך שעמודי noindex, אזורים כבויים וסביבת בדיקה לא מגיעים לגוגל.</li>
          <li className={ui.note}><b>Search Console:</b> חשבון השירות{st.clientEmail ? <> (<span dir="ltr">{st.clientEmail}</span>)</> : null} צריך להיות <b>Owner</b> בנכס <span dir="ltr" className={ui.mono}>{st.property}</span>, וב־Google Cloud צריכים להיות פעילים Web Search Indexing API ו־Google Search Console API.</li>
        </ul>
        <p className={ui.hint} style={{ marginTop: 10 }}>גוגל מגדירה את Indexing API רשמית לעמודי משרות ושידורים חיים; לעמודים אחרים היא לא מתחייבת לאינדוקס. מפת האתר ממשיכה לעבוד במקביל.</p>
      </Card>
      <div className={ui.toolbar}>
        <Pills current={f.key} items={G_FILTERS.map(x => ({ key: x.key, name: x.name, count: count[x.key], href: `/ops/content?tab=google${x.key === 'all' ? '' : `&g=${x.key}`}` }))} />
      </div>
      <Card flush>
        {rows.length ? (
          <Table head={['כתובת', 'סוג', 'באינדקס', 'מצב בגוגל', 'נבדק', 'נשלח', '']} foot={count[f.key] > rows.length ? `מוצגות ${int(rows.length)} מתוך ${int(count[f.key])}` : undefined}>
            {rows.map(r => (
              <tr key={r.id}>
                <td><a href={r.url} className={ui.rowLink} target="_blank" rel="noreferrer" dir="ltr">{decodeURI(r.path)}</a>{r.isNew ? <span className={ui.sub}>חדש · {dateIL(r.firstSeenAt)}</span> : null}</td>
                <td className={ui.mono}>{r.type}</td>
                <td>{r.indexed === true ? <Chip tone="ok">כן</Chip> : r.indexed === false ? <Chip tone="warn">לא</Chip> : <span className={ui.sub}>לא נבדק</span>}</td>
                <td>{r.coverageState ?? '—'}{r.lastCrawlAt ? <span className={ui.sub}>נסרק {dateIL(r.lastCrawlAt)}</span> : null}</td>
                <td className={ui.num}>{r.inspectedAt ? dateIL(r.inspectedAt) : '—'}</td>
                <td className={ui.num}>{r.lastSubmittedAt ? `${dateIL(r.lastSubmittedAt)} (${int(r.submitCount)})` : '—'}</td>
                <td>{r.inspectError || r.lastSubmitError ? <span className={ui.error}>{r.lastSubmitError ?? r.inspectError}</span> : null}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="אין כתובות" text={count.all ? 'אין כתובות במסנן הזה.' : 'הכתובות ייאספו ממפת האתר בהרצה הראשונה.'} />}
      </Card>
      <Card title="הרצות אחרונות" flush>
        {runs.length ? (
          <Table head={['התחלה', 'הפעלה', 'חדשות', 'נבדקו', 'נשלחו', 'שגיאות', 'הערה']}>
            {runs.map(r => (
              <tr key={r.id}>
                <td className={ui.num}>{dateTimeIL(r.startedAt)}</td>
                <td>{TRIGGER[r.trigger] ?? r.trigger}</td>
                <td className={ui.num}>{int(r.discovered)}</td>
                <td className={ui.num}>{int(r.inspected)}</td>
                <td className={ui.num}>{int(r.submitted)}</td>
                <td className={ui.num}>{r.errors ? <Chip tone="bad">{int(r.errors)}</Chip> : '0'}</td>
                <td>{r.note ?? (r.finishedAt ? '' : 'רץ')}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="עוד לא היו הרצות" />}
      </Card>
    </div>
  );
}

async function IndexingTab({ canEdit }: { canEdit: boolean }) {
  const f = await indexingFacts();
  const blocked = f.policy.staging || !f.policy.site;
  return (
    <div className={ui.stack}>
      <Kpis items={[
        { label: 'מצב האתר', value: f.policy.staging ? 'חסום (STAGING)' : f.policy.site ? 'פתוח לאינדוקס' : 'חסום מההגדרות', tone: blocked ? 'bad' : 'ok', note: f.policy.staging ? 'משתנה הסביבה STAGING=1 חוסם הכול' : 'robots.txt, מפת האתר ותגיות robots' },
        { label: 'כתובות במפת האתר', value: int(blocked ? 0 : f.total), note: 'מתעדכן תוך שעה' },
        { label: 'אזורים כבויים', value: int(f.sections.filter(s => !s.on).length), note: `מתוך ${f.sections.length}`, tone: f.sections.some(s => !s.on) ? 'warn' : undefined },
        { label: 'חריגים', value: int(f.hiddenPages + f.hiddenBranches), note: `${int(f.hiddenPages)} עמודים · ${int(f.hiddenBranches)} פרופילי עסקים`, tone: f.hiddenPages + f.hiddenBranches ? 'warn' : undefined },
      ]} />
      {f.policy.staging ? <Card><Chip tone="warn">סביבת בדיקה</Chip><p className={ui.note} style={{ marginTop: 8 }}>הפריסה הזו רצה עם <span className={ui.mono}>STAGING=1</span>: robots.txt חוסם הכול, כל תשובה נושאת noindex ומפת האתר ריקה. המתגים כאן נשמרים וייכנסו לתוקף כשהמשתנה יוסר מ־Vercel.</p></Card> : null}
      <div className={ui.grid2}>
        <Card title="האתר כולו" sub="המתג הראשי. כבוי: robots.txt חוסם הכול, מפת האתר ריקה וכל עמוד ציבורי מקבל noindex" flush>
          <IndexingToggle name="site" checked={f.policy.site} title="האתר פתוח למנועי חיפוש" sub="כיבוי מתאים לפני השקה או בתקלה חמורה; ההפעלה מחדש מיידית, אבל גוגל חוזר לסרוק לפי הקצב שלו" canEdit={canEdit} />
        </Card>
        <Card title="אזורים פרטיים" sub="תמיד מחוץ לאינדקס, אין מתג" flush>
          <p className={`${ui.hint} ${ui.cardPad}`}>robots.txt חוסם אותם, כל תשובה בהם נושאת X-Robots-Tag: noindex, והעמודים מצהירים noindex בעצמם.</p>
          <Table head={['אזור', 'נתיב']}>
            {PRIVATE_AREAS.map(a => <tr key={a.prefix}><td>{a.name}</td><td className={ui.mono} dir="ltr">{a.prefix}</td></tr>)}
          </Table>
        </Card>
      </div>
      <Card title="אזורי האתר הציבוריים" sub="אזור כבוי ממשיך להיות מוצג למבקרים, אבל יוצא ממפת האתר ומקבל noindex. עמוד בודד מסתירים בלשונית ״עמודים״, פרופיל בודד בעורך הסניף" flush>
        {f.sections.map(s => (
          <IndexingToggle key={s.key} name={`section:${s.key}`} checked={s.on} title={`${s.name} · ${int(s.count)}`} sub={`${s.desc} · לדוגמה ${s.example}`} canEdit={canEdit} />
        ))}
      </Card>
      <Card title="חריגים">
        <ul className={ui.list}>
          <li className={ui.note}><b>{int(f.hiddenPages)} עמודים</b> מסומנים noindex בלשונית ״עמודים״. <Link href="/ops/content?filter=noindex" className={ui.rowLink}>לרשימה</Link>.</li>
          <li className={ui.note}><b>{int(f.hiddenBranches)} פרופילי עסקים</b> חיים מוסתרים ממנועי חיפוש (הסימון ״מוסתר ממנועי חיפוש״ בלשונית הפרטים של עורך הסניף). הם לא במפת האתר ונושאים noindex.</li>
          <li className={ui.note}><b>עמודי חיפוש, מדריכים ותוצאות עם סינון</b> מסומנים noindex בקוד ולא תלויים במתגים.</li>
        </ul>
      </Card>
    </div>
  );
}

function PostsTab() {
  const rows = articles();
  return (
    <Card title="פוסטים ומאמרים" sub="המגזין מנוהל כרגע בקוד" flush>
      <Table head={['כותרת', 'סוג', 'תקציר']} foot="הוספת פוסט חדש היא שינוי קוד (components/home/content.ts). הדף /magazine מציג את הרשימה הזו.">
        {rows.map((a, i) => <tr key={i}><td className={ui.strong}><Link href="/magazine" className={ui.rowLink}>{a.title}</Link></td><td>{a.kind}</td><td className={ui.note}>{a.desc}</td></tr>)}
      </Table>
    </Card>
  );
}

async function CategoriesTab() {
  const rows = await categoryRows();
  return (
    <Card title="קטגוריות (14 תחומי טיפול)" flush>
      <Table head={['תחום', 'קבוצה', 'עסקים חיים', 'עמוד']}>
        {rows.map(c => <tr key={c.slug}><td className={ui.strong}>{c.name}</td><td>{c.group}</td><td className={ui.num}>{int(c.live)}</td><td><a href={`${siteUrl()}/treatments/${c.slug}`} className={ui.rowLink} target="_blank" rel="noreferrer" dir="ltr">/treatments/{c.slug}</a></td></tr>)}
      </Table>
    </Card>
  );
}

async function SitemapTab() {
  const [f, policy] = await Promise.all([sitemapFacts(), indexingPolicy()]);
  return (
    <div className={ui.grid2}>
      <Card title="מפת אתר" sub={<a href={`${siteUrl()}/sitemap.xml`} className={ui.rowLink} target="_blank" rel="noreferrer">/sitemap.xml</a>}>
        <Kpis items={[{ label: 'כתובות', value: int(f.total) }, { label: 'עמודי עסקים', value: int(f.branches) }, { label: 'עיר + תחום', value: int(f.cityCats), note: 'רק עם עסקים חיים' }, { label: 'עמודי ערים', value: int(f.cityPages) }]} />
        <p className={ui.hint}>מתחדשת כל שעה. עמודי עיר ותחום נכללים רק כשיש בהם עסקים חיים, כדי לא לשלוח את גוגל לעמודים ריקים. אזורים כבויים ועמודים ופרופילים שסומנו noindex אינם נכללים (לשונית ״אינדוקס״).</p>
      </Card>
      <Card title="robots.txt" sub={<a href={`${siteUrl()}/robots.txt`} className={ui.rowLink} target="_blank" rel="noreferrer">/robots.txt</a>}>
        {policy.staging ? <Chip tone="warn">סביבת בדיקה: הכול חסום לסריקה</Chip> : policy.site ? <Chip tone="ok">ייצור: סריקה פתוחה</Chip> : <Chip tone="warn">האתר כבוי לאינדוקס מההגדרות</Chip>}
        <p className={ui.note} style={{ marginTop: 10 }}>חסומים תמיד: <span dir="ltr">{PRIVATE_PREFIXES.join(', ')}</span>.</p>
      </Card>
    </div>
  );
}

async function PerformanceTab() {
  const a = await analytics30();
  const delta = a.prevViews ? ((a.views - a.prevViews) / a.prevViews) * 100 : null;
  return (
    <div className={ui.stack}>
      <Kpis items={[
        { label: 'צפיות בפרופילים · 30 יום', value: int(a.views), note: delta == null ? `${int(a.prevViews)} ב־30 הימים שלפני` : `${delta >= 0 ? '+' : ''}${pct(delta, 0)} מול התקופה הקודמת`, tone: delta == null ? undefined : delta >= 0 ? 'ok' : 'bad' },
        { label: 'פניות (טלפון, וואטסאפ, טופס)', value: int(a.contacts + a.forms), note: a.views ? `${pct(((a.contacts + a.forms) / a.views) * 100)} מהצפיות` : undefined },
        { label: 'התחלות הזמנה', value: int(a.bookingStarts) },
        { label: 'ניווט Waze', value: int(a.waze) },
      ]} />
      <div className={ui.grid2}>
        <Card title="העמודים הנצפים ביותר · 30 יום" flush>
          {a.top.length ? <Table head={['עסק', 'צפיות']}>{a.top.map((t, i) => <tr key={i}><td className={ui.strong}>{t.branch ? `${t.branch.name} · ${t.branch.cityName}` : 'עסק שהוסר'}</td><td className={ui.num}>{int(t.count)}</td></tr>)}</Table> : <Empty title="עוד אין צפיות" text="נספרות רק צפיות של מבקרים שאישרו עוגיות אנליטיקס." />}
        </Card>
        <Card title="מעקב חיצוני">
          <ul className={ui.list}>
            <li className={ui.listItem} style={{ paddingInline: 0 }}><div className={ui.listText}><div className={ui.listTitle}>Google Search Console</div><div className={ui.listSub}>אינדקס, ביטויים, Core Web Vitals</div></div><Chip tone="neutral">לא מחובר</Chip></li>
            <li className={ui.listItem} style={{ paddingInline: 0 }}><div className={ui.listText}><div className={ui.listTitle}>Google Analytics 4</div><div className={ui.listSub}>תנועה ומשפכים</div></div><Chip tone="neutral">לא מחובר</Chip></li>
            <li className={ui.listItem} style={{ paddingInline: 0 }}><div className={ui.listText}><div className={ui.listTitle}>אנליטיקס פנימי</div><div className={ui.listSub}>אירועי פרופיל, בהסכמת המבקר בלבד</div></div><Chip tone="ok">פעיל</Chip></li>
          </ul>
          <p className={ui.hint} style={{ marginTop: 8 }}>חיבור Search Console ו־GA4 דורש אימות דומיין בחשבון Google של החברה; עד אז המספרים כאן הם מהמעקב הפנימי בלבד.</p>
        </Card>
      </div>
    </div>
  );
}
