import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Band, Card, Chip, Columns, Empty, Kpis, PageHead, Pills, Table, Tabs, dateIL, dayMonthIL, int, nisAgorot, nisWhole, pct, ui } from '@/components/ops/ui';
import { PLATFORM_BILLING_LINE } from '@/lib/pricing';
import { db } from '@/lib/server/db';
import { monthStart, mrr } from '@/lib/server/opsStats';
import { platformSettings } from '@/lib/server/platformSettings';
import { BankUpload, DeleteExpenseButton, ExpenseForm, InvoiceForm, SubscriptionActions } from './AccountingForms';
import { collectionStats, EXPENSE_CATEGORIES, expenses, ledger, ledgerCounts, LEDGER_FILTERS, profitAndLoss, subscriptions, type LedgerFilter } from './data';

export const metadata: Metadata = { title: 'הנהלת חשבונות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const TABS = [
  { key: 'ledger', name: 'ספר הכנסות' }, { key: 'subscriptions', name: 'מנויים וחיובים' }, { key: 'expenses', name: 'הוצאות' }, { key: 'vat', name: 'מע״מ' },
  { key: 'pnl', name: 'רווח והפסד' }, { key: 'bank', name: 'התאמת בנק' }, { key: 'document', name: 'הפקת מסמך' }, { key: 'export', name: 'ייצוא לרו״ח' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const KIND_NAME = { subscription: 'מנוי', sponsored: 'ממומן', manual: 'ידני', credit: 'זיכוי' } as const;
const SUB_STATUS: Record<string, { name: string; tone: 'ok' | 'bad' | 'neutral' | 'warn' }> = { active: { name: 'פעיל', tone: 'ok' }, past_due: { name: 'חוב פתוח', tone: 'bad' }, hidden: { name: 'מוסתר', tone: 'neutral' }, cancelled: { name: 'בוטל', tone: 'neutral' } };

export default async function AccountingPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('accounting', 'view', '/ops/accounting');
  const sp = await searchParams;
  const tab = (TABS.some(t => t.key === one(sp.tab)) ? one(sp.tab) : 'ledger') as Tab;
  const q = one(sp.q).slice(0, 60);
  const filter = (LEDGER_FILTERS.some(f => f.key === one(sp.filter)) ? one(sp.filter) : 'all') as LedgerFilter;
  const subFilter = (['all', 'active', 'past_due', 'hidden', 'cancelled'].includes(one(sp.filter)) ? one(sp.filter) : 'all') as 'all' | 'active' | 'past_due' | 'hidden' | 'cancelled';
  const [level, m, pnl, coll, s] = await Promise.all([areaLevel(user, 'accounting'), mrr(), profitAndLoss(12), collectionStats(), platformSettings()]);
  const canEdit = atLeast(level, 'edit');
  const thisMonth = pnl[pnl.length - 1];
  const income = thisMonth.incomeAgorot - thisMonth.creditsAgorot;

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="כספים" title="הנהלת חשבונות" lead="הכנסות, הוצאות, מע״מ, התאמת בנק, הפקת מסמכים וייצוא לרואה החשבון." />
      <Tabs label="הנהלת חשבונות" current={tab} items={TABS.map(t => ({ key: t.key, name: t.name, href: `/ops/accounting?tab=${t.key}` }))} />
      <Kpis
        items={[
          { label: 'הכנסות · החודש', value: nisAgorot(income), note: 'נגבה בפועל · ללא מע״מ ישראלי' },
          { label: 'רווח תפעולי · החודש', value: nisAgorot(thisMonth.resultAgorot), note: income ? `${pct((thisMonth.resultAgorot / income) * 100, 0)} מההכנסות` : 'אין הכנסות החודש', tone: thisMonth.resultAgorot < 0 ? 'bad' : undefined },
          { label: 'MRR צפוי', value: nisWhole(m.totalNis), note: `${int(m.branches)} סניפים בחיוב` },
          { label: 'גבייה', value: pct(coll.pct, 1), note: coll.open ? `${int(coll.open)} חיובים פתוחים` : 'אין חיובים פתוחים', tone: coll.open ? 'warn' : 'ok' },
        ]}
      />

      {tab === 'ledger' ? <LedgerTab filter={filter} q={q} /> : null}
      {tab === 'subscriptions' ? <SubscriptionsTab filter={subFilter} canEdit={canEdit} /> : null}
      {tab === 'expenses' ? <ExpensesTab canEdit={canEdit} /> : null}
      {tab === 'vat' ? <VatTab vatPct={s.vatRatePct} /> : null}
      {tab === 'pnl' ? (
        <Card title="רווח והפסד · 12 חודשים" sub="הכנסות שנגבו פחות זיכויים ופחות הוצאות (כולל מע״מ תשומות)">
          <Columns items={pnl.map((p, i) => ({ label: p.label, value: Math.max(0, p.resultAgorot) / 100, now: i === pnl.length - 1, title: nisAgorot(p.resultAgorot) }))} />
          <div style={{ marginTop: 14 }}>
            <Table head={['חודש', 'הכנסות', 'זיכויים', 'הוצאות', 'תוצאה']}>
              {[...pnl].reverse().map(p => (
                <tr key={p.label}><td className={ui.mono}>{p.label}</td><td className={ui.num}>{nisAgorot(p.incomeAgorot)}</td><td className={ui.num}>{p.creditsAgorot ? `−${nisAgorot(p.creditsAgorot)}` : '—'}</td><td className={ui.num}>{nisAgorot(p.expensesAgorot)}</td><td className={`${ui.num} ${ui.strong}`} style={{ color: p.resultAgorot < 0 ? '#A33A31' : undefined }}>{nisAgorot(p.resultAgorot)}</td></tr>
              ))}
            </Table>
          </div>
        </Card>
      ) : null}
      {tab === 'bank' ? (
        <Card title="התאמת בנק" sub="אין חיבור ישיר לחשבון הבנק; מעלים דף בנק ומתאימים לתשלומים שנגבו">
          <BankUpload />
        </Card>
      ) : null}
      {tab === 'document' ? (
        <Card title="הפקת מסמך" sub="חשבונית או חשבונית זיכוי של Israfind Group">
          {canEdit ? <InvoiceForm businesses={(await db.branch.findMany({ where: { business: { status: { not: 'pending' } } }, select: { businessId: true, name: true }, orderBy: { name: 'asc' }, distinct: ['businessId'], take: 500 })).map(b => ({ id: b.businessId, name: b.name }))} /> : <p className={ui.note}>לתפקיד שלך יש צפייה בלבד.</p>}
          <p className={ui.hint} style={{ marginTop: 12 }}>{PLATFORM_BILLING_LINE}</p>
        </Card>
      ) : null}
      {tab === 'export' ? <ExportTab /> : null}
    </AdminShell>
  );
}

async function LedgerTab({ filter, q }: { filter: LedgerFilter; q: string }) {
  const [rows, counts] = await Promise.all([ledger({ filter, q }), ledgerCounts()]);
  const net = rows.reduce((a, r) => a + r.netAgorot, 0);
  const vat = rows.reduce((a, r) => a + r.vatAgorot, 0);
  return (
    <>
      <div className={ui.toolbar}>
        <Pills current={filter} items={LEDGER_FILTERS.map(f => ({ key: f.key, name: f.name, count: counts[f.key], href: `/ops/accounting?tab=ledger&filter=${f.key}` }))} />
        <form method="get" action="/ops/accounting" className={ui.toolbarGrow} role="search" style={{ maxWidth: 320 }}>
          <input type="hidden" name="tab" value="ledger" /><input type="hidden" name="filter" value={filter} />
          <input name="q" defaultValue={q} className={ui.input} placeholder="מספר מסמך או דוא״ל" aria-label="חיפוש מסמכים" />
        </form>
        <Link href={`/ops/accounting/export?kind=documents&filter=${filter}`} className={ui.btn}>הורדת CSV</Link>
      </div>
      <Card flush>
        {rows.length ? (
          <Table head={['מסמך', 'תאריך', 'לקוח', 'סוג', 'לפני מע״מ', 'מע״מ', 'סה״כ', 'מצב']}>
            {rows.map(r => (
              <tr key={r.id}>
                <td className={`${ui.mono} ${ui.strong}`}>{r.pdfUrl ? <a href={r.pdfUrl} className={ui.rowLink} target="_blank" rel="noreferrer">{r.number}</a> : r.number}</td>
                <td className={ui.num}>{dayMonthIL(r.issuedAt)}</td>
                <td className={ui.strong}>{r.customer}<span className={ui.sub}>{r.description}</span></td>
                <td>{KIND_NAME[r.kind]}</td>
                <td className={ui.num}>{nisAgorot(r.netAgorot, { cents: true })}</td>
                <td className={ui.num}>{r.vatAgorot ? nisAgorot(r.vatAgorot, { cents: true }) : '—'}</td>
                <td className={`${ui.num} ${ui.strong}`}>{nisAgorot(r.grossAgorot, { cents: true })}</td>
                <td><Chip tone={r.status === 'paid' ? 'ok' : r.status === 'credit' ? 'warn' : 'bad'}>{r.status === 'paid' ? 'שולם' : r.status === 'credit' ? 'זיכוי' : 'פתוח'}</Chip></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="אין מסמכים בסינון הזה" text="מסמכים נוצרים מחיובי מנויים וממומנים, או מהפקה ידנית בלשונית ״הפקת מסמך״." />}
      </Card>
      <Band items={[{ label: 'לפני מע״מ', value: nisAgorot(net, { cents: true }) }, { label: 'מע״מ', value: nisAgorot(vat, { cents: true }) }, { label: 'סה״כ', value: nisAgorot(net + vat, { cents: true }) }, { label: 'מסמכים', value: int(rows.length) }]} />
    </>
  );
}

async function SubscriptionsTab({ filter, canEdit }: { filter: 'all' | 'active' | 'past_due' | 'hidden' | 'cancelled'; canEdit: boolean }) {
  const rows = await subscriptions(filter);
  const counts = await db.subscription.groupBy({ by: ['status'], _count: true });
  const c = (k: string) => counts.find(x => x.status === k)?._count ?? 0;
  const PL = { basic: 'בסיסי', advanced: 'מתקדם + CRM' };
  return (
    <>
      <div className={ui.toolbar}>
        <Pills current={filter} items={[{ key: 'all', name: 'הכל', count: counts.reduce((a, x) => a + x._count, 0), href: '/ops/accounting?tab=subscriptions' }, { key: 'active', name: 'פעילים', count: c('active'), href: '/ops/accounting?tab=subscriptions&filter=active' }, { key: 'past_due', name: 'חוב פתוח', count: c('past_due'), href: '/ops/accounting?tab=subscriptions&filter=past_due' }, { key: 'hidden', name: 'מוסתרים', count: c('hidden'), href: '/ops/accounting?tab=subscriptions&filter=hidden' }, { key: 'cancelled', name: 'בוטלו', count: c('cancelled'), href: '/ops/accounting?tab=subscriptions&filter=cancelled' }]} />
      </div>
      <Card flush>
        {rows.length ? (
          <Table head={['עסק', 'מסלול', 'סניפים חיים', 'חיוב חודשי', 'סוף תקופה', 'ניסיון חוזר', 'מצב', '']}>
            {rows.map(r => (
              <tr key={r.id}>
                <td><Link href={`/ops/businesses/${r.businessId}`} className={ui.rowLink}>{r.businessName}</Link></td>
                <td>{PL[r.plan]} · {r.cycle === 'yearly' ? 'שנתי' : 'חודשי'}</td>
                <td className={ui.num}>{int(r.liveBranches)}</td>
                <td className={`${ui.num} ${ui.strong}`}>{nisWhole(r.monthlyNis)}</td>
                <td className={ui.num}>{dateIL(r.currentPeriodEnd)}</td>
                <td className={ui.num}>{r.retry?.next_at ? `${dateIL(r.retry.next_at)} · ניסיון ${int(r.retry.attempts ?? 1)}` : '—'}</td>
                <td><Chip tone={SUB_STATUS[r.status]?.tone ?? 'neutral'}>{SUB_STATUS[r.status]?.name ?? r.status}</Chip></td>
                <td>{canEdit ? <SubscriptionActions id={r.id} status={r.status} /> : null}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="אין מנויים בסינון הזה" />}
      </Card>
      <p className={ui.hint} style={{ marginTop: 10 }}>חיוב שנכשל: ניסיון חוזר אחרי {3} ו־{7} ימים, הסתרת הפרופיל אחרי 14 יום (ניתן לשינוי בהגדרות הפלטפורמה). ההודעות לעסק: M23.</p>
    </>
  );
}

async function ExpensesTab({ canEdit }: { canEdit: boolean }) {
  const rows = await expenses(monthStart(new Date(), -11));
  const total = rows.reduce((a, r) => a + r.netAgorot + r.vatAgorot, 0);
  const noReceipt = rows.filter(r => !r.receiptUrl && r.date >= monthStart()).length;
  return (
    <div className={ui.split}>
      <Card title="הוצאות · 12 חודשים" sub={noReceipt ? `${int(noReceipt)} ללא קבלה החודש` : undefined} flush>
        {rows.length ? (
          <Table head={['תאריך', 'ספק', 'קטגוריה', 'לפני מע״מ', 'מע״מ', 'קבלה', '']} foot={`סה״כ ${nisAgorot(total)} כולל מע״מ תשומות`}>
            {rows.map(e => (
              <tr key={e.id}>
                <td className={ui.num}>{dateIL(e.date)}</td>
                <td className={ui.strong}>{e.vendor}{e.description ? <span className={ui.sub}>{e.description}</span> : null}</td>
                <td>{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                <td className={ui.num}>{nisAgorot(e.netAgorot)}</td>
                <td className={ui.num}>{e.vatAgorot ? nisAgorot(e.vatAgorot) : '—'}</td>
                <td>{e.receiptUrl ? <a href={e.receiptUrl} className={ui.rowLink} target="_blank" rel="noreferrer">קבלה</a> : <Chip tone="warn">חסרה</Chip>}</td>
                <td>{canEdit ? <DeleteExpenseButton id={e.id} /> : null}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="עוד לא נרשמו הוצאות" />}
      </Card>
      <Card title="רישום הוצאה">{canEdit ? <ExpenseForm categories={Object.entries(EXPENSE_CATEGORIES).map(([key, name]) => ({ key, name }))} /> : <p className={ui.note}>לתפקיד שלך יש צפייה בלבד.</p>}</Card>
    </div>
  );
}

async function VatTab({ vatPct }: { vatPct: number }) {
  const pnl = await profitAndLoss(12);
  const exp = await db.expense.groupBy({ by: ['category'], where: { date: { gte: monthStart(new Date(), -11) } }, _sum: { vatAgorot: true } });
  const inputVat = exp.reduce((a, x) => a + (x._sum.vatAgorot ?? 0), 0);
  return (
    <div className={ui.split}>
      <Card title="מע״מ" sub="מה חל על הפלטפורמה ומה חל על הקליניקות">
        <p className={ui.note}>{PLATFORM_BILLING_LINE}</p>
        <p className={ui.note} style={{ marginTop: 8 }}>לכן אין כאן דוח מע״מ עסקאות: מסמכי הפלטפורמה יוצאים ללא מע״מ ישראלי. מע״מ תשומות ששולם לספקים ישראליים נרשם על ההוצאה ומופיע כאן לצורך ייעוץ רואה החשבון.</p>
        <p className={ui.note} style={{ marginTop: 8 }}>הקליניקות מציגות מחירים לפני מע״מ ({vatPct}%) ומפיקות חשבוניות מס דרך ספק החשבוניות שלהן; המסמכים שלהן אינם חלק מהספרים של BeautyFind.</p>
      </Card>
      <Card title="מע״מ תשומות · 12 חודשים" flush>
        <Table head={['חודש', 'הכנסות (ללא מע״מ)', 'הוצאות']} foot={`מע״מ תשומות מצטבר: ${nisAgorot(inputVat)}`}>
          {[...pnl].reverse().map(p => <tr key={p.label}><td className={ui.mono}>{p.label}</td><td className={ui.num}>{nisAgorot(p.incomeAgorot)}</td><td className={ui.num}>{nisAgorot(p.expensesAgorot)}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

function ExportTab() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => { const d = monthStart(now, -i); return { from: d, to: monthStart(now, -i + 1), label: d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }) }; });
  return (
    <Card title="ייצוא לרואה החשבון" sub="CSV של המסמכים וההוצאות, לפי חודש">
      <ul className={ui.list}>
        {months.map(mo => (
          <li key={mo.label} className={ui.listItem} style={{ paddingInline: 0 }}>
            <div className={ui.listText}><div className={ui.listTitle}>{mo.label}</div></div>
            <Link href={`/ops/accounting/export?kind=documents&from=${mo.from.toISOString()}&to=${mo.to.toISOString()}`} className={`${ui.btn} ${ui.small}`}>מסמכים</Link>
            <Link href={`/ops/accounting/export?kind=expenses&from=${mo.from.toISOString()}&to=${mo.to.toISOString()}`} className={`${ui.btn} ${ui.small}`}>הוצאות</Link>
          </li>
        ))}
      </ul>
      <p className={ui.hint} style={{ marginTop: 10 }}>הקבצים בקידוד UTF-8 עם BOM, נפתחים ישירות באקסל. כל ייצוא נרשם ביומן הפעולות.</p>
    </Card>
  );
}
