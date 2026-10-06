import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, dateTimeIL, int, ui } from '@/components/ops/ui';
import { articlePath } from '@/lib/articleHtml';
import { listAuthors, listCategories } from '@/lib/server/articles';
import { db } from '@/lib/server/db';
import { MCP_TOOLS } from '@/lib/server/mcpTools';
import { platformSettings } from '@/lib/server/platformSettings';
import { siteUrl } from '@/lib/server/site';
import { ApprovalToggle, ArticleActions } from './MagazineControls';

// /ops/magazine: every article with its state, the authors and reviewers, the categories, the approvals
// switch and the MCP tools that write here. Articles are written through the MCP tools (or any client of
// the same server actions); this screen is where a person sees, publishes, takes down and deletes.

export const metadata: Metadata = { title: 'מגזין · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const STATUS: Record<string, { name: string; tone: 'ok' | 'warn' | 'neutral' | 'info' }> = {
  draft: { name: 'טיוטה', tone: 'neutral' }, scheduled: { name: 'מתוזמן', tone: 'info' }, published: { name: 'מפורסם', tone: 'ok' }, unpublished: { name: 'הורד', tone: 'warn' },
};

export default async function MagazineAdminPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('magazine', 'view', '/ops/magazine');
  const sp = await searchParams;
  const filter = one(sp.filter) || 'all';
  const [level, settings, articles, authors, categories] = await Promise.all([
    areaLevel(user, 'magazine'), platformSettings(),
    db.article.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: 'desc' }, include: { author: true, category: true }, take: 300 }),
    listAuthors({ includeInactive: true }), listCategories(),
  ]);
  const canEdit = atLeast(level, 'edit');
  const canFull = atLeast(level, 'full');
  const by = (s: string) => articles.filter(a => a.status === s).length;
  const shown = filter === 'all' ? articles : articles.filter(a => a.status === filter);
  const tools = MCP_TOOLS.filter(t => t.area === 'magazine');

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="צמיחה" title="מגזין" lead={<>מאמרים ב־<span dir="ltr">/magazine/{'{slug}'}</span>, כותבים וסוקרים רפואיים, קטגוריות ותמונות. הכתיבה נעשית דרך כלי ה־MCP; כאן מפרסמים, מורידים ומוחקים.</>} />
      <Kpis items={[
        { label: 'מאמרים', value: int(articles.length), note: `${int(by('published'))} מפורסמים` },
        { label: 'טיוטות', value: int(by('draft')), note: 'ממתינות לפרסום' },
        { label: 'מתוזמנים', value: int(by('scheduled')), note: 'יתפרסמו בזמנם', tone: by('scheduled') ? 'ok' : undefined },
        { label: 'כותבים וסוקרים', value: int(authors.length), note: `${int(authors.filter(a => a.isMedicalReviewer).length)} סוקרים רפואיים` },
      ]} />
      <div className={ui.toolbar}>
        <Pills current={filter} items={[
          { key: 'all', name: 'הכול', count: articles.length, href: '/ops/magazine' },
          { key: 'published', name: 'מפורסמים', count: by('published'), href: '/ops/magazine?filter=published' },
          { key: 'scheduled', name: 'מתוזמנים', count: by('scheduled'), href: '/ops/magazine?filter=scheduled' },
          { key: 'draft', name: 'טיוטות', count: by('draft'), href: '/ops/magazine?filter=draft' },
          { key: 'unpublished', name: 'הורדו', count: by('unpublished'), href: '/ops/magazine?filter=unpublished' },
        ]} />
      </div>
      <Card flush>
        {shown.length ? (
          <Table head={['כותרת', 'מצב', 'כותב', 'קטגוריה', 'מילים', 'עודכן', '']} foot="מאמר מפורסם מתרענן באתר עם כל שמירה. מחיקה היא רכה: השורה נשמרת ואפשר לראות אותה ב־list_articles עם include_deleted.">
            {shown.map(a => (
              <tr key={a.id}>
                <td>
                  {a.status === 'published' ? <a href={`${siteUrl()}${articlePath(a.slug)}`} className={ui.rowLink} target="_blank" rel="noreferrer">{a.title}</a> : <span className={ui.strong}>{a.title}</span>}
                  <span className={ui.sub} dir="ltr">{articlePath(a.slug)}</span>
                  {a.reviewRequired ? <span className={ui.sub}>{a.reviewerId && a.reviewedAt ? 'סקירה רפואית: נעשתה' : 'סקירה רפואית: חסרה'}</span> : null}
                </td>
                <td><Chip tone={STATUS[a.status]?.tone ?? 'neutral'}>{STATUS[a.status]?.name ?? a.status}</Chip>{a.status === 'scheduled' && a.scheduledFor ? <span className={ui.sub}>{dateTimeIL(a.scheduledFor)}</span> : null}</td>
                <td>{a.author?.name ?? <span className={ui.sub}>אין</span>}</td>
                <td>{a.category?.name ?? <span className={ui.sub}>ללא</span>}</td>
                <td className={ui.num}>{int(a.wordCount)}</td>
                <td className={ui.num}>{dateTimeIL(a.updatedAt)}</td>
                <td>{canEdit ? <ArticleActions id={a.id} status={a.status} title={a.title} /> : null}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="אין מאמרים" text="מאמרים נוצרים דרך create_article בשרת ה־MCP (לשונית ״שרת MCP״ ב־AI ו־MCP)." />}
      </Card>
      <div className={ui.grid2}>
        <Card title="כותבים וסוקרים רפואיים" sub="upsert_author יוצר ומעדכן; סוקר רפואי צריך סוג רישיון" flush>
          {authors.length ? (
            <Table head={['שם', 'תפקיד', 'סוקר רפואי', 'מאמרים', 'פעיל']}>
              {authors.map(a => (
                <tr key={a.id}><td className={ui.strong}>{a.name}<span className={ui.sub} dir="ltr">{a.slug}</span></td><td>{a.title ?? ''}</td><td>{a.isMedicalReviewer ? <Chip tone="ok">{a.licenseKind === 'doctor' ? 'רופא/ה' : a.licenseKind === 'dentist' ? 'רופא/ת שיניים' : a.licenseKind === 'nurse' ? 'אח/ות' : 'כן'}</Chip> : <span className={ui.sub}>לא</span>}</td><td className={ui.num}>{int((a.articles ?? 0) + (a.reviewed ?? 0))}</td><td>{a.active ? <Chip tone="ok">כן</Chip> : <Chip tone="neutral">לא</Chip>}</td></tr>
              ))}
            </Table>
          ) : <Empty title="אין כותבים" text="כל מאמר צריך כותב לפני פרסום." />}
        </Card>
        <Card title="קטגוריות" sub="upsert_category; הסינון ב־/magazine?category=slug" flush>
          {categories.length ? (
            <Table head={['שם', 'slug', 'מאמרים מפורסמים']}>
              {categories.map(c => <tr key={c.id}><td className={ui.strong}>{c.name}</td><td className={ui.mono} dir="ltr">{c.slug}</td><td className={ui.num}>{int(c.count)}</td></tr>)}
            </Table>
          ) : <Empty title="אין קטגוריות" />}
        </Card>
      </div>
      <div className={ui.grid2}>
        <Card title="הגדרות" flush>
          <ApprovalToggle checked={settings.magazinePublishApproval} canEdit={canFull} />
        </Card>
        <Card title="כלי ה־MCP של המגזין" sub={<Link href="/ops/ai?tab=mcp" className={ui.rowLink}>שרת MCP</Link>}>
          <p className={ui.note} style={{ marginTop: 0 }}>
            <span dir="ltr">{tools.filter(t => !t.write).map(t => t.name).join(', ')}</span> לקריאה;{' '}
            <span dir="ltr">{tools.filter(t => t.write).map(t => t.name).join(', ')}</span> לכתיבה.
          </p>
          <p className={ui.hint}>אסימון אישי עם היקף ״מגזין בלבד״ מקבל את הכלים האלה בלבד, בלי נתוני עסקים, חיוב ולקוחות (חוץ מ־list_branches ו־search_businesses לקישורים פנימיים). כל קריאה נרשמת ביומן הפעולות.</p>
        </Card>
      </div>
    </AdminShell>
  );
}
