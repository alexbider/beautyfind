import type { Metadata } from 'next';
import Link from 'next/link';
import ui from '@/components/dashboard/charts/ui.module.css';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { PHASE, phaseOf } from '@/app/ops/sponsored/data';
import { db } from '@/lib/server/db';
import { cardsByIds } from '@/lib/server/public';
import { CARD_WAIT_DAYS, freeMonthAvailable, hasSponsoredCard, pageOptionsFor, pageTitle, sponsoredConfig, statTotals } from '@/lib/server/sponsored';
import { pathOfPageKey, type SponsoredCardData } from '@/lib/sponsored';
import { ROUTES } from '@/lib/routes';
import { CampaignActions, SponsoredBuilder } from './SponsoredBuilder';
import s from './page.module.css';

// Sponsored placements for the business (docs/sponsored.md): pick a page (the city + category list, the
// national treatment page or the homepage), write one line, see the card exactly as visitors will, send it for
// review. Billing is monthly and starts only after approval. Below: every placement with its results.
// Design: project/BeautyFind Sponsored.dc.html, moved from weekly region slots to monthly page slots.

export const metadata: Metadata = { title: 'מקומות ממומנים', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const dateIL = (d: Date) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' });
const int = (n: number) => n.toLocaleString('en-US');

export default async function BizSponsoredPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await tabGuard('billing');
  const canEdit = ctx.canEdit && !ctx.preview;
  const sp = await searchParams;
  const card = typeof sp.card === 'string' ? sp.card : null;
  const biz = ctx.business.id;

  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [cfg, options, campaigns, free, hasCard] = await Promise.all([
    sponsoredConfig(),
    pageOptionsFor(biz),
    db.campaign.findMany({ where: { businessId: biz }, orderBy: { createdAt: 'desc' }, take: 50 }),
    freeMonthAvailable(biz),
    hasSponsoredCard(biz),
  ]);
  const [totals30, totalsAll] = await Promise.all([statTotals(campaigns.map(c => c.id), since30), statTotals(campaigns.map(c => c.id))]);

  // Preview cards for the builder: each live branch as its card would look.
  const branchIds = [...new Set(options.map(o => o.branchId))];
  const [cards, treatments] = await Promise.all([
    cardsByIds(branchIds),
    branchIds.length ? db.treatment.findMany({ where: { branchId: { in: branchIds }, isPublished: true }, select: { branchId: true, name: true, categorySlug: true }, orderBy: { sortOrder: 'asc' }, take: 300 }) : [],
  ]);
  const previews: Record<string, Omit<SponsoredCardData, 'campaignId' | 'line' | 'featured'>> = Object.fromEntries(cards.map(c => [c.id, {
    branchId: c.id, href: c.href, name: c.name, categoryName: c.categories[0]?.name ?? null, cityName: c.cityName, coverUrl: c.coverUrl, coverAlt: c.coverAlt,
    google: c.google, beautyfind: c.beautyfind, verified: c.verified, priceFromShekels: c.priceFromShekels,
  }]));
  const categoryNames: Record<string, Record<string, string>> = Object.fromEntries(cards.map(c => [c.id, Object.fromEntries(c.categories.map(x => [x.slug, x.name]))]));
  const suggestions: Record<string, string[]> = {};
  for (const t of treatments) {
    const list = (suggestions[t.branchId] ??= []);
    if (list.length < 8 && !list.includes(t.name) && t.name.length <= 40) list.push(t.name);
  }

  const k30 = [...totals30.values()].reduce((a, t) => ({ impressions: a.impressions + t.impressions, clicks: a.clicks + t.clicks, contacts: a.contacts + t.contacts }), { impressions: 0, clicks: 0, contacts: 0 });
  const now = new Date();
  const rows = campaigns.map(c => ({ c, phase: phaseOf(c, now), title: pageTitle(c), path: pathOfPageKey(c.pageKey), t: totalsAll.get(c.id) ?? { impressions: 0, clicks: 0, contacts: 0 } }));
  const running = rows.filter(r => ['live', 'free_month', 'ending', 'scheduled', 'needs_card', 'charge_failed', 'review'].includes(r.phase));
  const past = rows.filter(r => !running.includes(r));
  const monthly = running.filter(r => r.phase === 'live' || r.phase === 'ending' || r.phase === 'charge_failed').reduce((a, r) => a + r.c.monthlyPriceAgorot, 0);

  return (
    <section aria-labelledby="h-sp" className={ui.section}>
      <div>
        <h1 id="h-sp" className={ui.h1}>מקומות ממומנים<span>.</span></h1>
        <p className={ui.h1Sub}>
          הכרטיס שלכם בסליידר ״ממומן״ בראש העמוד שתבחרו: רשימת העסקים בעיר ובתחום שלכם, עמוד התחום הארצי או עמוד הבית. מחיר קבוע לחודש, בלי התחייבות. החיוב מתחיל רק אחרי שהתוכן אושר, ואפשר לבטל בכל רגע.
        </p>
      </div>

      {!canEdit && <ReadOnlyBanner roleName={ctx.roleName} />}

      {card === 'saved' && <p className={s.flash} data-tone="ok" role="status">הכרטיס נשמר. החיוב יתחיל רק כשהמקום יאושר, ונעדכן אתכם במייל.</p>}
      {card === 'cancelled' && <p className={s.flash} role="status">הכרטיס לא נשמר. הבקשה ממתינה לבדיקה, ואפשר לשמור כרטיס בכל רגע מהרשימה למטה.</p>}

      <dl className={ui.kpis}>
        <div className={ui.kpi}><dt>הצגות · 30 יום</dt><dd className={ui.kpiValue}>{int(k30.impressions)}</dd><span className={ui.kpiNote}>כשהכרטיס הופיע על המסך</span></div>
        <div className={ui.kpi}><dt>כניסות לפרופיל</dt><dd className={ui.kpiValue}>{int(k30.clicks)}</dd><span className={ui.kpiNote}>{k30.impressions ? `${((k30.clicks / k30.impressions) * 100).toFixed(1)}% מההצגות` : 'מלחיצה על הכרטיס'}</span></div>
        <div className={ui.kpi}><dt>פניות</dt><dd className={ui.kpiValue}>{int(k30.contacts)}</dd><span className={ui.kpiNote}>שיחה, וואטסאפ, תור או ניווט</span></div>
        <div className={ui.kpi}><dt>חיוב חודשי</dt><dd className={ui.kpiValue}>₪{int(monthly / 100)}</dd><span className={ui.kpiNote}>ללא מע״מ ישראלי</span></div>
      </dl>

      {running.length > 0 && (
        <div className={ui.card}>
          <h2 className={ui.h2Gap}>המקומות שלכם</h2>
          <ul className={s.list}>
            {running.map(({ c, phase, title, path, t }) => (
              <li key={c.id} className={s.row}>
                <div className={s.rowMain}>
                  <div className={s.rowTop}>
                    <Link href={path} target="_blank" className={s.rowTitle}>{title}</Link>
                    <span className={s.pill} data-tone={PHASE[phase].tone}>{PHASE[phase].name}</span>
                    <span className={`${s.ref} ltr`}>{c.ref}</span>
                  </div>
                  <p className={s.rowLine}>״{c.line}״{c.featuredTreatment ? <span className={s.rowFeat}> · {c.featuredTreatment}</span> : null}</p>
                  <p className={s.rowMeta}>
                    <span>₪{int(c.monthlyPriceAgorot / 100)} לחודש{c.freeMonths ? ' · החודש הראשון חינם' : ''}</span>
                    {phase === 'review' && <span>נבדק בדרך כלל תוך יום עסקים</span>}
                    {phase === 'needs_card' && <span>אושר! נשאר לשמור כרטיס כדי שהמקום יעלה. בלי כרטיס המקום משתחרר {CARD_WAIT_DAYS} ימים אחרי האישור</span>}
                    {phase === 'charge_failed' && <span>החיוב החודשי לא עבר. עדכנו כרטיס והחיוב יבוצע מיד; בלי עדכון הכרטיס יירד מהסליידר בסוף החודש ששולם</span>}
                    {c.activeUntil && phase !== 'review' && phase !== 'charge_failed' && <span>{phase === 'ending' ? 'מוצג עד ' : c.freeMonths && !c.paymentId ? 'חינם עד ' : 'מתחדש ב־'}<span className="ltr">{dateIL(c.activeUntil)}</span></span>}
                    {phase !== 'review' && phase !== 'needs_card' && <span><span className="ltr">{int(t.impressions)}</span> הצגות · <span className="ltr">{int(t.clicks)}</span> כניסות · <span className="ltr">{int(t.contacts)}</span> פניות</span>}
                  </p>
                </div>
                {canEdit && <CampaignActions id={c.id} phase={phase} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit ? (
        options.length ? (
          <SponsoredBuilder
            options={options}
            previews={previews}
            categoryNames={categoryNames}
            suggestions={suggestions}
            free={free}
            hasCard={hasCard}
            listNis={cfg.listMonthlyNis}
            homeNis={cfg.homeMonthlyNis}
            slots={cfg.slots}
          />
        ) : (
          <div className={ui.card}>
            <h2 className={ui.h2Tight}>עוד אי אפשר להזמין מקום ממומן</h2>
            <p className={ui.meta}>מקום ממומן נפתח לסניף שכבר מופיע באתר. אחרי אימות העסק והפרסום של הסניף, העמודים שלכם יופיעו כאן.</p>
          </div>
        )
      ) : null}

      {past.length > 0 && (
        <div className={ui.card}>
          <h2 className={ui.h2Gap}>היסטוריה</h2>
          <ul className={s.list}>
            {past.map(({ c, phase, title, t }) => (
              <li key={c.id} className={s.row} data-past>
                <div className={s.rowMain}>
                  <div className={s.rowTop}>
                    <span className={s.rowTitle}>{title}</span>
                    <span className={s.pill} data-tone={PHASE[phase].tone}>{PHASE[phase].name}</span>
                    <span className={`${s.ref} ltr`}>{c.ref}</span>
                  </div>
                  {c.status === 'rejected' && c.reviewNote ? <p className={s.rowReject}>{c.reviewNote} · לא חויבתם. אפשר לתקן ולשלוח שוב.</p> : null}
                  <p className={s.rowMeta}><span>״{c.line}״</span>{c.status !== 'rejected' && <span><span className="ltr">{int(t.impressions)}</span> הצגות · <span className="ltr">{int(t.clicks)}</span> כניסות · <span className="ltr">{int(t.contacts)}</span> פניות</span>}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className={ui.foot}>
        הצגה נספרת רק כשהכרטיס הופיע על המסך, וכניסה כשמבקר לחץ עליו; שתיהן ספירות כלליות בלי מידע על מבקרים. פניות נספרות אצל מבקרים שאישרו קובצי מדידה.
        החיובים של BeautyFind הם של Israfind Group (דלאוור, ארה״ב) וללא מע״מ ישראלי. <Link href={ROUTES.sponsorship}>מדיניות הפרסום</Link>
      </p>
    </section>
  );
}
