import type { Metadata } from 'next';
import Link from 'next/link';
import { Desk, GiftScreen, PhoneLedger, PhoneLookup } from '@/components/gift/Desk';
import { FILTERS, ledger, type LedgerFilter } from '@/components/gift/server';
import { STATUS, money } from '@/components/gift/shared';
import d from '@/components/gift/Desk.module.css';
import s from '@/components/gift/gift.module.css';
import { Segmented } from '@/components/shell/Segmented';
import { TopBar } from '@/components/shell/TopBar';
import { clinicContext } from '@/lib/server/clinic';
import { canTakePayments, connectionFor } from '@/lib/server/money';

// Design: project/BeautyFind Gift Cards.dc.html (view=clinic): KPIs, reception desk, ledger.
// Open balance is the clinic's liability, not revenue, until redeemed (07-rules-and-tokens.md).

export const metadata: Metadata = { title: 'שוברי מתנה', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const FILTER_NAMES: Record<LedgerFilter, string> = { all: 'הכול', open: 'פתוחים', redeemed: 'מומשו', refunded: 'בוטלו', expired: 'פג תוקף' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ClinicGiftCardsPage({ searchParams }: Props) {
  const ctx = await clinicContext('giftcards');
  const branchName = ctx.branch?.name ?? 'הקליניקה';

  if (!ctx.advanced) {
    return (
      <div className={d.wrap}>
        <TopBar mode="root" largeTitle="שוברי מתנה" />
        <div className={d.inner}>
        <div className={s.clinicHead}>
          <span className={s.eyebrow}>{branchName} · הכנסות</span>
          <h1 className={`${s.clinicH1} bf-desk-only`}>שוברי מתנה</h1>
        </div>
        <div className={s.upgrade}>
          <h2 className={s.h2}>שוברי מתנה זמינים במסלול המתקדם</h2>
          <p>מכירת שוברים באתר, מימוש בקבלה עם חשבונית מס, ומעקב אחרי היתרה הפתוחה. השדרוג נכנס לתוקף מיד.</p>
          <div className={s.actions}>
            <Link href="/biz/billing" className={s.btn}>לשדרוג המסלול</Link>
          </div>
        </div>
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const f = (FILTERS as readonly string[]).includes(String(sp.f)) ? (sp.f as LedgerFilter) : 'all';
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 60) : '';
  const [data, payments, invoicing] = await Promise.all([
    ledger(ctx.business.id, f, q),
    canTakePayments(ctx.business.id),
    connectionFor(ctx.business.id, 'invoicing'),
  ]);
  const k = data.kpis;
  const hrefFor = (key: LedgerFilter) => {
    const u = new URLSearchParams();
    if (key !== 'all') u.set('f', key);
    if (q) u.set('q', q);
    const str = u.toString();
    return `/clinic/gift-cards${str ? `?${str}` : ''}`;
  };

  const empty = q || f !== 'all' ? 'אין שוברים שמתאימים לסינון.' : 'עוד לא נמכרו שוברים. הם יופיעו כאן מיד אחרי התשלום.';

  return (
    <div className={d.wrap}>
      <GiftScreen canManage={ctx.canManage} invoicing={!!invoicing}>
      <div className={d.inner}>
      <div className={s.clinicHead}>
        <span className={s.eyebrow}>{branchName} · הכנסות</span>
        <h1 className={`${s.clinicH1} bf-desk-only`}>שוברי מתנה</h1>
      </div>

      <PhoneLookup />

      <dl className={s.kpis}>
        <div className={s.kpi}>
          <dt>נמכרו החודש</dt>
          <dd>{k.soldCount}</dd>
          <span className={s.kpiNote}><span className="ltr">{money(k.soldAgorot)}</span></span>
        </div>
        <div className={s.kpi}>
          <dt>מומשו החודש</dt>
          <dd>{money(k.redeemedAgorot)}</dd>
          <span className={s.kpiNote}>עם חשבונית מס</span>
        </div>
        <div className={s.kpi}>
          <dt>יתרה פתוחה</dt>
          <dd>{money(k.openAgorot)}</dd>
          <span className={s.kpiNote}>התחייבות · לא הכנסה</span>
        </div>
        <div className={s.kpi}>
          <dt>פג תוקף בקרוב</dt>
          <dd>{k.expiring}</dd>
          <span className={s.kpiNote}>ב־90 הימים הקרובים</span>
        </div>
      </dl>

      {!payments ? (
        <p className={`${s.note} ${s.noteWarn}`} style={{ marginBottom: 14 }}>
          אין חיבור פעיל לחברת סליקה, ולכן אי אפשר לקנות שוברים חדשים באתר. שוברים קיימים ממשיכים להתממש כרגיל.{' '}
          <Link href="/biz/payments">לחיבור חברת סליקה</Link>
        </p>
      ) : ctx.branch ? (
        <p className={s.small} style={{ marginBottom: 12 }}>
          עמוד הקנייה של הקליניקה: <Link href={`/gift/${ctx.branch.slug}`} className={d.inlineLink}><span className="ltr">/gift/{ctx.branch.slug}</span></Link>
        </p>
      ) : null}

      <Desk canManage={ctx.canManage} invoicing={!!invoicing} />

      <div className={`${d.seg} bf-shell-only`}>
        <Segmented label="סינון שוברים" value={f} items={FILTERS.map(key => ({ key, label: FILTER_NAMES[key], href: hrefFor(key) }))} />
      </div>
      <div className={s.filters}>
        <nav aria-label="סינון שוברים" className={`${s.chips} bf-desk-only`}>
          {FILTERS.map(key => (
            <Link key={key} href={hrefFor(key)} aria-current={f === key ? 'page' : undefined} className={s.filter}>{FILTER_NAMES[key]}</Link>
          ))}
        </nav>
        <form className={s.search} role="search" action="/clinic/gift-cards">
          {f !== 'all' ? <input type="hidden" name="f" value={f} /> : null}
          <input name="q" defaultValue={q} placeholder="קוד או שם" aria-label="חיפוש לפי קוד או שם" className={s.input} />
          <button type="submit" className={s.deskBtnGhost}>חיפוש</button>
        </form>
      </div>

      </div>

      <div className={`${s.tableWrap} bf-desk-only`}>
        <table className={s.table}>
          <caption className="sr-only">יומן שוברים</caption>
          <thead>
            <tr>
              <th scope="col">קוד</th>
              <th scope="col">מקבל/ת</th>
              <th scope="col">שווי</th>
              <th scope="col">יתרה</th>
              <th scope="col">מצב</th>
              <th scope="col">תוקף</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={s.emptyRow}>{empty}</td>
              </tr>
            ) : (
              data.rows.map(r => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.id}>
                    <td className={s.tdCode}><span className={s.code}>{r.code}</span></td>
                    <td>{r.recipient}<span className={s.tdSub}>מאת {r.buyer} · <span className="ltr">{r.purchased}</span></span></td>
                    <td><span className="ltr">{money(r.valueAgorot)}</span></td>
                    <td className={s.tdStrong}><span className="ltr">{money(r.balanceAgorot)}</span></td>
                    <td><span className={s.pill} style={{ background: st.bg, color: st.color }}>{r.statusNote ?? st.name}</span></td>
                    <td><span className="ltr">{r.expires}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <PhoneLedger rows={data.rows} empty={empty} />
      <div className={d.foot}>
      {data.total > data.rows.length ? (
        <p className={s.foot}>מוצגים <span className="ltr">{data.rows.length}</span> שוברים אחרונים מתוך <span className="ltr">{data.total}</span>. אפשר לחפש לפי קוד או שם.</p>
      ) : null}
      <p className={s.foot}>
        יתרת שוברים פתוחה, <span className="ltr">{money(k.openAgorot)}</span>, היא התחייבות של הקליניקה, לא הכנסה. היא נרשמת כהכנסה רק במימוש, יחד עם חשבונית המס. BeautyFind לא גובה עמלה על שוברים.
      </p>
      </div>
      </GiftScreen>
    </div>
  );
}
