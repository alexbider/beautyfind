import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireArea } from '@/components/ops/guard';
import { Card, Chip, Empty, PageHead, Table, dateTimeIL, int, relIL, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { serviceChecks, type ServiceState } from '@/lib/server/opsHealth';
import styles from './health.module.css';

export const metadata: Metadata = { title: 'בריאות מערכת · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATE: Record<ServiceState, { name: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  ok: { name: 'תקין', tone: 'ok' }, degraded: { name: 'ירידה בביצועים', tone: 'warn' }, down: { name: 'לא זמין', tone: 'bad' }, unknown: { name: 'לא נבדק', tone: 'neutral' },
};

export default async function HealthPage() {
  const user = await requireArea('health', 'view', '/ops/health');
  const now = new Date();
  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [services, runsQueued, runsRunning, runsPaused, tasksPending, importReview, enrichPending, sessions, failedRuns, providerErrors, workerRow, otpHour, consentRows] = await Promise.all([
    serviceChecks(),
    safe(db.importRun.count({ where: { status: 'queued' } }), 0),
    safe(db.importRun.count({ where: { status: 'running' } }), 0),
    safe(db.importRun.count({ where: { status: 'paused' } }), 0),
    safe(db.importTask.count({ where: { status: 'pending' } }), 0),
    safe(db.importPlace.count({ where: { status: { in: ['ready', 'needs_review'] } } }), 0),
    safe(db.importPlace.count({ where: { status: { in: ['found', 'enriched', 'extracted'] } } }), 0),
    safe(db.session.count({ where: { expiresAt: { gt: now } } }), 0),
    safe(db.importRun.findMany({ where: { status: 'failed' }, orderBy: { updatedAt: 'desc' }, take: 8, select: { id: true, label: true, error: true, updatedAt: true } }), []),
    safe(db.providerConnection.findMany({ where: { status: 'error' }, orderBy: { updatedAt: 'desc' }, take: 8, select: { provider: true, kind: true, lastError: true, updatedAt: true, businessId: true } }), []),
    safe(db.importSettings.findUnique({ where: { id: 1 } }), null),
    safe(db.otpCode.count({ where: { createdAt: { gte: new Date(now.getTime() - 3_600_000) } } }), 0),
    safe(db.messageConsent.count(), 0),
  ]);
  const ws = (workerRow?.values as { workerStatus?: { at?: string; browser?: boolean } } | null)?.workerStatus ?? null;
  const dbCheck = services.find(s => s.key === 'db');

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="מערכת" title="בריאות מערכת" lead="זמינות שירותים, תורים, גיבויים ותקלות. כל מספר נמדד עכשיו; מה שאין לו מדידה מסומן כך." />
      <div className={styles.services}>
        {services.map(s => (
          <div key={s.key} className={styles.service}>
            <div className={styles.serviceTop}><span className={ui.dot} data-tone={STATE[s.state].tone === 'neutral' ? undefined : STATE[s.state].tone} /><span className={styles.serviceName}>{s.name}</span></div>
            <div className={styles.serviceState} data-tone={STATE[s.state].tone}>{STATE[s.state].name}</div>
            <div className={styles.serviceNote}>{s.ms !== null ? `${s.ms}ms · ` : ''}{s.note}</div>
          </div>
        ))}
        <div className={styles.service}>
          <div className={styles.serviceTop}><span className={ui.dot} data-tone="info" /><span className={styles.serviceName}>שרת MCP</span></div>
          <div className={styles.serviceState} data-tone="neutral">טרם הופעל</div>
          <div className={styles.serviceNote}>ראו AI ו־MCP</div>
        </div>
      </div>

      <div className={ui.grid3}>
        <Card title="תורים" flush>
          <Table head={['תור', 'עכשיו']}>
            <tr><td>ריצות ייבוא בתור</td><td className={ui.num}><Link href="/ops/import" className={ui.rowLink}>{int(runsQueued)}</Link></td></tr>
            <tr><td>ריצות ייבוא בעבודה</td><td className={ui.num}>{int(runsRunning)}{runsPaused ? ` · ${int(runsPaused)} מושהות` : ''}</td></tr>
            <tr><td>משימות סריקה ממתינות</td><td className={ui.num}>{int(tasksPending)}</td></tr>
            <tr><td>רשומות באמצע העשרה</td><td className={ui.num}>{int(enrichPending)}</td></tr>
            <tr><td>רשומות לבדיקת אדם</td><td className={ui.num}><Link href="/ops/import/review" className={ui.rowLink}>{int(importReview)}</Link></td></tr>
            <tr><td>קודי OTP בשעה האחרונה</td><td className={ui.num}>{int(otpHour)}</td></tr>
            <tr><td>הודעות ממתינות לשליחה</td><td className={ui.num}><span className={ui.note}>אין תור הודעות (שליחה מיידית דרך הספק)</span></td></tr>
          </Table>
        </Card>
        <Card title="גיבויים ונתונים">
          <div className={styles.kv}><span>גיבוי מסד נתונים</span><strong>מנוהל ב־Neon (שחזור לנקודת זמן); לא נמדד כאן</strong></div>
          <div className={styles.kv}><span>שחזור נבדק</span><strong>לא תועד</strong></div>
          <div className={styles.kv}><span>קבצי לקוחות</span><strong>{process.env.STORAGE_ADAPTER === 'blob' || process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob · שכפול מנוהל' : 'אחסון מקומי'}</strong></div>
          <div className={styles.kv}><span>זמן תגובת מסד</span><strong>{dbCheck?.ms !== null && dbCheck?.ms !== undefined ? `${dbCheck.ms}ms` : '—'}</strong></div>
          <div className={styles.kv}><span>חיבורי צוות פתוחים</span><strong>{int(sessions)} סשנים</strong></div>
          <div className={styles.kv}><span>הסכמות דיוור רשומות</span><strong>{int(consentRows)}</strong></div>
          <div className={styles.kv}><span>העובד · דיווח אחרון</span><strong>{ws?.at ? `${relIL(ws.at)} · ${ws.browser ? 'Chromium זמין' : 'ללא Chromium'}` : 'אין דיווח'}</strong></div>
        </Card>
        <Card title="תקלות אחרונות" flush>
          {failedRuns.length || providerErrors.length ? (
            <ul className={ui.list}>
              {failedRuns.map(r => (
                <li key={r.id} className={ui.listItem}>
                  <span className={ui.dot} data-tone="bad" />
                  <div className={ui.listText}><div className={ui.listTitle}>ריצת ייבוא נכשלה · {r.label}</div><div className={ui.listSub}>{dateTimeIL(r.updatedAt)} · {(r.error ?? '').slice(0, 120) || 'ללא פירוט'}</div></div>
                  <Link href={`/ops/import?run=${r.id}`} className={`${ui.btn} ${ui.small}`}>לריצה</Link>
                </li>
              ))}
              {providerErrors.map((p, i) => (
                <li key={i} className={ui.listItem}>
                  <span className={ui.dot} data-tone="warn" />
                  <div className={ui.listText}><div className={ui.listTitle}>חיבור ספק בשגיאה · {p.provider} ({p.kind})</div><div className={ui.listSub}>{dateTimeIL(p.updatedAt)} · {(p.lastError ?? '').slice(0, 120) || 'ללא פירוט'}</div></div>
                  <Link href={`/ops/businesses/${p.businessId}`} className={`${ui.btn} ${ui.small}`}>לעסק</Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="אין תקלות פתוחות" text="ריצות ייבוא שנכשלו וחיבורי ספקים בשגיאה יופיעו כאן." />}
        </Card>
      </div>
      <p className={ui.hint} style={{ marginTop: 14 }}>זמינות היסטורית (אחוזי uptime) לא נמדדת במערכת; הסטטוס כאן הוא מדידה חיה של הרגע. <Chip tone="neutral">Sentry וניטור חיצוני: לא מחוברים</Chip></p>
    </AdminShell>
  );
}
