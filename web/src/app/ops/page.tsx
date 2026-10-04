import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { ACTOR_KIND_NAMES } from '@/components/ops/activity';
import { requireArea } from '@/components/ops/guard';
import { Bars, Card, Chip, Columns, Kpis, PageHead, Empty, dateIL, int, nisAgorot, nisWhole, pct, relIL, timeIL, ui } from '@/components/ops/ui';
import { serviceChecks } from '@/lib/server/opsHealth';
import { aiCostThisMonth, attention, bookingStats, businessStats, churn30, creditsThisMonth, monthlyPlatformIncome, mrr, recentActivity } from '@/lib/server/opsStats';

export const metadata: Metadata = { title: 'סקירה כללית · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATE_TONE = { ok: 'ok', degraded: 'warn', down: 'bad', unknown: 'neutral' } as const;
const STATE_NAME = { ok: 'תקין', degraded: 'ירידה בביצועים', down: 'לא זמין', unknown: 'לא נבדק' } as const;
const PROVIDER_NAME: Record<string, string> = { openai: 'ChatGPT · OpenAI', anthropic: 'Claude · Anthropic' };

export default async function OverviewPage() {
  const user = await requireArea('overview', 'view', '/ops');
  const [m, income, credits, bookings, churn, biz, ai, todo, activity, services] = await Promise.all([
    mrr(), monthlyPlatformIncome(12), creditsThisMonth(), bookingStats(), churn30(), businessStats(), aiCostThisMonth(), attention(), recentActivity(8), serviceChecks(),
  ]);
  const thisMonth = income[income.length - 1];
  const hasIncome = income.some(x => x.agorot > 0);
  const anthropicUsd = ai.find(x => x.provider === 'anthropic');
  const openaiUsd = ai.find(x => x.provider === 'openai');
  const usd = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="ראשי" title="סקירה כללית" lead="מה דורש טיפול עכשיו ואיך הפלטפורמה מתפקדת." />
      <Kpis
        items={[
          { label: 'MRR · מנויים', value: nisWhole(m.totalNis), note: `${int(m.businesses)} עסקים · ${int(m.branches)} סניפים בחיוב` },
          { label: 'עסקים פעילים', value: int(biz.live), note: biz.newThisMonth ? `+${int(biz.newThisMonth)} החודש` : 'ללא חדשים החודש', tone: biz.newThisMonth ? 'ok' : undefined },
          { label: 'הזמנות · החודש', value: int(bookings.thisMonth), note: bookings.deltaPct == null ? `${int(bookings.lastMonth)} בחודש שעבר` : `${bookings.deltaPct >= 0 ? '+' : ''}${pct(bookings.deltaPct)} מהחודש שעבר`, tone: bookings.deltaPct == null ? undefined : bookings.deltaPct >= 0 ? 'ok' : 'bad' },
          { label: 'נטישה · 30 יום', value: pct(churn.pct), note: `${int(churn.cancelled)} ${churn.cancelled === 1 ? 'עסק ביטל' : 'עסקים ביטלו'}`, tone: churn.cancelled ? 'warn' : undefined },
        ]}
      />

      <div className={ui.split}>
        <div className={ui.stack}>
          <Card title="הכנסה חוזרת חודשית" sub="12 חודשים · הכנסות הפלטפורמה שנגבו · ללא מע״מ ישראלי">
            {hasIncome ? (
              <Columns items={income.map((x, i) => ({ label: x.label, value: x.agorot / 100, now: i === income.length - 1, title: nisAgorot(x.agorot) }))} />
            ) : (
              <Empty title="עוד לא נגבו תשלומים לפלטפורמה" text="הגרף יתמלא מהחיוב הראשון של מנוי או מקום ממומן. ה־MRR למעלה מחושב מהמנויים החיים." />
            )}
          </Card>
          <Card title="תמהיל הכנסות · החודש">
            <Bars
              items={[
                { name: 'מנויים · רישום בסיסי', value: m.basicNis, display: nisWhole(m.basicNis) },
                { name: 'מנויים · מתקדם + CRM', value: m.advancedNis, display: nisWhole(m.advancedNis) },
                { name: 'מקומות ממומנים', value: thisMonth.sponsored / 100, display: nisAgorot(thisMonth.sponsored) },
                { name: 'זיכויים', value: credits / 100, display: credits ? `−${nisAgorot(credits)}` : '0 ₪', tone: credits ? 'bad' : undefined },
              ]}
            />
            <p className={ui.hint} style={{ marginTop: 10 }}>המנויים לפי המחירון והסניפים החיים; ממומנים וזיכויים לפי מה שנגבה והופק החודש.</p>
          </Card>
        </div>

        <Card title="דורש טיפול" aside={<Chip tone={todo.length ? 'navy' : 'ok'}>{int(todo.length)}</Chip>} flush>
          {todo.length ? (
            <ul className={ui.list}>
              {todo.map(t => (
                <li key={t.key} className={ui.listItem}>
                  <span className={ui.dot} data-tone={t.tone} aria-hidden="true" />
                  <div className={ui.listText}>
                    <div className={ui.listTitle}>{t.title}</div>
                    <div className={ui.listSub}>{t.sub}</div>
                  </div>
                  <Link href={t.href} className={`${ui.btn} ${ui.small}`}>{t.action}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="אין משימות פתוחות" text="כל התורים ריקים: חיובים, אישורים, מחלוקות, ממומנים, פרטיות ואימות." />
          )}
        </Card>
      </div>

      <div className={ui.grid3} style={{ marginTop: 16 }}>
        <Card title="פעילות אחרונה" flush>
          {activity.length ? (
            <ul className={ui.list}>
              {activity.map((a, i) => (
                <li key={i} className={ui.listItem}>
                  <span className={ui.time} title={dateIL(a.at)}>{relIL(a.at) === 'עכשיו' || Date.now() - a.at.getTime() < 86_400_000 ? timeIL(a.at) : relIL(a.at)}</span>
                  <div className={ui.listText}>
                    <div className={ui.listTitle}><b>{a.who}</b> · {a.text}</div>
                    <div className={ui.listSub}>{ACTOR_KIND_NAMES[a.kind]} · {a.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty title="עוד אין פעילות" />}
          <div className={ui.foot}><Link href="/ops/audit" className={ui.rowLink}>ליומן המלא</Link></div>
        </Card>

        <Card title="AI · עלות החודש" sub="לפי יומן ההוצאות של הייבוא">
          <Bars
            items={[
              { name: `${PROVIDER_NAME.anthropic} · ${int(anthropicUsd?.calls ?? 0)} קריאות`, value: anthropicUsd?.usd ?? 0, display: usd(anthropicUsd?.usd ?? 0) },
              { name: `${PROVIDER_NAME.openai} · ${int(openaiUsd?.calls ?? 0)} קריאות`, value: openaiUsd?.usd ?? 0, display: usd(openaiUsd?.usd ?? 0) },
            ]}
          />
          <p className={ui.hint} style={{ marginTop: 10 }}>
            {process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'מפתחות: ' : 'לא הוגדר מפתח מודל באתר. '}
            {process.env.ANTHROPIC_API_KEY ? 'Claude ' : ''}{process.env.OPENAI_API_KEY ? 'ChatGPT ' : ''}
            <Link href="/ops/ai?tab=usage" className={ui.rowLink}>לשימוש ועלויות</Link>
          </p>
        </Card>

        <Card title="שירותים">
          {services.map(s => (
            <div key={s.key} className={ui.service}>
              <span className={ui.dot} data-tone={s.state === 'ok' ? 'ok' : s.state === 'degraded' ? undefined : s.state === 'down' ? 'bad' : 'info'} aria-hidden="true" />
              <span className={ui.serviceName}>{s.name}</span>
              <Chip tone={STATE_TONE[s.state]}>{STATE_NAME[s.state]}</Chip>
              <span className={ui.serviceMs} dir="ltr">{s.ms != null ? `${s.ms}ms` : ''}</span>
            </div>
          ))}
          <div className={ui.foot} style={{ paddingInline: 0 }}><Link href="/ops/health" className={ui.rowLink}>לבריאות המערכת</Link></div>
        </Card>
      </div>
    </AdminShell>
  );
}
