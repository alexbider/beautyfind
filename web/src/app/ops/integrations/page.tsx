import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireArea } from '@/components/ops/guard';
import { Kpis, PageHead, int } from '@/components/ops/ui';
import { integrationGroups } from '@/lib/server/integrations';
import { IntegrationCard } from './IntegrationCard';
import styles from './integrations.module.css';

export const metadata: Metadata = { title: 'אינטגרציות ומקורות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const user = await requireArea('integrations', 'view', '/ops/integrations');
  const groups = await integrationGroups();
  const all = groups.flatMap(g => g.items);
  const n = (s: string) => all.filter(i => i.state === s).length;
  return (
    <AdminShell user={user}>
      <PageHead eyebrow="AI ונתונים" title="אינטגרציות ומקורות" lead="סליקה, חשבוניות, הודעות, יומנים, אנליטיקס, מקורות ייבוא ותפעול. המצב נמדד מהפריסה הזו ומהחיבורים של העסקים; הסודות עצמם לעולם לא מוצגים." />
      <Kpis items={[
        { label: 'מחוברים', value: int(n('connected')), tone: 'ok' },
        { label: 'דורשים טיפול', value: int(n('attention')), tone: n('attention') ? 'bad' : undefined, note: n('attention') ? 'חיבורי עסקים בשגיאה' : 'אין שגיאות' },
        { label: 'לא מחוברים', value: int(n('not_connected')), note: 'קיימים בקוד, חסר סוד או הגדרה' },
        { label: 'לא זמינים עדיין', value: int(n('unavailable')), note: 'מתוכננים, עוד לא בקוד' },
      ]} />
      {groups.map(g => (
        <section key={g.name} className={styles.group} aria-label={g.name}>
          <h2 className={styles.groupTitle}>{g.name}</h2>
          <div className={styles.grid}>{g.items.map(i => <IntegrationCard key={i.key} item={i} />)}</div>
        </section>
      ))}
    </AdminShell>
  );
}
