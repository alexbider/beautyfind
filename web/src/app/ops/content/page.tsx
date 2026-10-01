import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, Tabs, dateIL, int, pct, ui } from '@/components/ops/ui';
import { siteUrl } from '@/lib/server/site';
import { analytics30, articles, categoryRows, JSON_LD_TYPES, pageRows, sitemapFacts } from './data';
import { SeoForm } from './SeoForm';

export const metadata: Metadata = { title: 'תוכן ו־SEO · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const TABS = [
  { key: 'pages', name: 'עמודים' }, { key: 'posts', name: 'פוסטים' }, { key: 'categories', name: 'קטגוריות' }, { key: 'settings', name: 'הגדרות SEO' },
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
  const f = await sitemapFacts();
  const staging = process.env.STAGING === '1';
  return (
    <div className={ui.grid2}>
      <Card title="מפת אתר" sub={<a href={`${siteUrl()}/sitemap.xml`} className={ui.rowLink} target="_blank" rel="noreferrer">/sitemap.xml</a>}>
        <Kpis items={[{ label: 'כתובות', value: int(f.total) }, { label: 'עמודי עסקים', value: int(f.branches) }, { label: 'עיר + תחום', value: int(f.cityCats), note: 'רק עם עסקים חיים' }, { label: 'עמודי ערים', value: int(f.cityPages) }]} />
        <p className={ui.hint}>מתחדשת כל שעה. עמודי עיר ותחום נכללים רק כשיש בהם עסקים חיים, כדי לא לשלוח את גוגל לעמודים ריקים.</p>
      </Card>
      <Card title="robots.txt" sub={<a href={`${siteUrl()}/robots.txt`} className={ui.rowLink} target="_blank" rel="noreferrer">/robots.txt</a>}>
        {staging ? <Chip tone="warn">סביבת בדיקה: הכול חסום לסריקה</Chip> : <Chip tone="ok">ייצור: סריקה פתוחה</Chip>}
        <p className={ui.note} style={{ marginTop: 10 }}>חסומים: <span dir="ltr">/biz, /ops, /login, /logout, /invite, /for-business/join, /for-business/claim, /api</span>.</p>
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
