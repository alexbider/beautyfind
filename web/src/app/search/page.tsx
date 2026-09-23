import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterPanel } from '@/components/search/FilterPanel';
import { LoadMore } from '@/components/search/LoadMore';
import { NoResults, type Rescue } from '@/components/search/NoResults';
import {
  DEFAULT_STATE,
  PER_LOAD,
  cityName,
  clearedFilters,
  hasPanelFilters,
  headline,
  parseSearch,
  regionName,
  searchHref,
  toFilter,
  type SearchState,
} from '@/components/search/params';
import { BizCount } from '@/components/search/Plural';
import { ResultCard } from '@/components/search/ResultCard';
import { ResultsRegion } from '@/components/search/ResultsRegion';
import { ResultsToolbar } from '@/components/search/ResultsToolbar';
import { SearchHeader } from '@/components/search/SearchHeader';
import { SearchProvider } from '@/components/search/SearchProvider';
import s from '@/components/search/search.module.css';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { CATEGORIES, MENU_REGION_ORDER, regionBySlug } from '@/lib/catalog';
import { listBranches, listingCounts, type ListingFilter } from '@/lib/server/public';
import { cardExtras } from './extras';
import p from './page.module.css';

// Design: project/BeautyFind Search.dc.html (no-results and loading: BeautyFind States.dc.html)

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const DESCRIPTION = 'חיפוש מכוני יופי, אסתטיקה וקוסמטיקה בכל רחבי ישראל. סינון לפי אזור, עיר, תחום טיפול, מאפיינים ומחיר.';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const st = parseSearch(await searchParams);
  return {
    title: headline(st),
    description: DESCRIPTION,
    // Search result pages are not indexed; the region, city and category pages are the canonical ones.
    robots: { index: false, follow: true },
    alternates: { canonical: '/search' },
  };
}

const SORT_LINE: Record<SearchState['sort'], string> = {
  recommended: '',
  rating: 'ממוין לפי דירוג גוגל, מהגבוה לנמוך',
  reviews: 'ממוין לפי מספר הביקורות בגוגל',
  price: 'ממוין לפי המחיר ההתחלתי, מהזול ליקר',
};

const PRESETS: Array<{ name: string; st: Partial<SearchState> }> = [
  { name: 'בוטוקס בתל אביב', st: { q: 'בוטוקס', region: 'dan', city: 'tel-aviv' } },
  { name: 'הסרת שיער בחיפה', st: { t: 'hair-removal', region: 'haifa', city: 'haifa' } },
  { name: 'ניקוי פנים בשרון', st: { q: 'ניקוי פנים', region: 'sharon' } },
  { name: 'ספא בצפון', st: { t: 'spa-massage', region: 'north' } },
  { name: 'מניקור בגוש דן', st: { q: 'מניקור', region: 'dan' } },
];

/** listBranches caps one call at 60 cards; "load more" pages can ask for more, so read in chunks. */
async function fetchUpTo(filter: ListingFilter, n: number) {
  const CHUNK = 60;
  const calls = Array.from({ length: Math.max(1, Math.ceil(n / CHUNK)) }, (_, i) =>
    listBranches({ ...filter, skip: i * CHUNK, take: Math.min(CHUNK, n - i * CHUNK) }),
  );
  const res = await Promise.all(calls);
  return { total: res[0].total, items: res.flatMap(r => r.items) };
}

const countOf = (st: SearchState) => listBranches({ ...toFilter(st), sort: undefined, take: 0 }).then(r => r.total);

/** Ways out of an empty result, each with its real count. Only exits that lead somewhere are offered. */
async function rescueOptions(st: SearchState): Promise<Rescue[]> {
  const region = regionName(st.region);
  const city = cityName(st.city);
  const cands: Array<Omit<Rescue, 'n' | 'href'> & { st: SearchState }> = [];
  if (st.city) cands.push({ key: 'region', name: `כל אזור ${region}`, note: `במקום ${city} בלבד`, st: { ...st, city: null } });
  if (st.region) cands.push({ key: 'country', name: 'חפשו בכל הארץ', note: city ? `במקום ${city} בלבד` : `במקום אזור ${region} בלבד`, st: { ...st, region: null, city: null } });
  if (st.t || st.f.length || st.price != null)
    cands.push({ key: 'filters', name: 'בלי סינונים נוספים', note: 'שומרים רק על המקום והחיפוש', st: { ...st, t: null, f: [], price: null } });
  if (hasPanelFilters(st))
    cands.push({ key: 'all', name: 'נקו את כל הסינונים', note: st.q ? `רק החיפוש ״${st.q}״, בכל הארץ` : 'כל העסקים באינדקס', st: clearedFilters(st) });
  if (st.q && hasPanelFilters(st)) cands.push({ key: 'q', name: `בלי ״${st.q}״`, note: 'רק לפי הסינונים שבחרתם', st: { ...st, q: '' } });

  const seen = new Set<string>();
  const unique = cands
    .map(c => ({ ...c, href: searchHref({ ...c.st, page: 1 }) }))
    .filter(c => !seen.has(c.href) && seen.add(c.href));
  const withN = await Promise.all(unique.map(async c => ({ key: c.key, name: c.name, note: c.note, href: c.href, n: await countOf(c.st) })));
  return withN.filter(c => c.n > 0).slice(0, 3);
}

export default async function SearchPage({ searchParams }: Props) {
  const st = parseSearch(await searchParams);
  const filter = toFilter(st);
  const [{ total, items }, counts] = await Promise.all([fetchUpTo(filter, st.page * PER_LOAD), listingCounts()]);
  const [extras, rescues] = await Promise.all([cardExtras(items.map(i => i.id)), total === 0 ? rescueOptions(st) : Promise.resolve([])]);

  const region = regionName(st.region);
  const city = cityName(st.city);
  const place = city ?? region;
  const queryPath = decodeURIComponent(searchHref({ ...st, view: 'list', page: 1 }));

  const catsByCount = [...CATEGORIES].sort((a, b) => (counts.category[b.slug] ?? 0) - (counts.category[a.slug] ?? 0));
  const relatedCats = [...(st.t ? CATEGORIES.filter(c => c.slug === st.t) : []), ...catsByCount.filter(c => c.slug !== st.t)].slice(0, 4);
  const related = [
    ...(st.city && st.region ? [{ name: `מכוני יופי ב${city}`, href: `/${st.region}/${st.city}` }] : []),
    ...(st.region
      ? [{ name: `מכוני יופי ב${region}`, href: `/${st.region}` }]
      : MENU_REGION_ORDER.slice(0, 2).map(r => ({ name: `מכוני יופי ב${regionBySlug(r)!.name}`, href: `/${r}` }))),
    ...relatedCats.map(c => ({ name: c.name, href: `/treatments/${c.slug}` })),
    { name: 'כל תחומי הטיפול', href: '/treatments' },
  ];
  const noResCats = catsByCount.filter(c => (counts.category[c.slug] ?? 0) > 0).slice(0, 8);

  return (
    <SearchProvider state={st} total={total}>
      <div className={p.root}>
        <SearchHeader />

        <main className={p.main}>
          <nav aria-label="נתיב ניווט" className={p.crumbs}>
            <ol>
              <li>
                <Link href="/">BeautyFind</Link>
              </li>
              <li aria-hidden="true" className={p.crumbSep}>/</li>
              <li aria-current="page">חיפוש</li>
            </ol>
          </nav>

          <div className={p.hero}>
            <div className={p.heroText}>
              <span className={p.eyebrow}>
                <span aria-hidden="true" className={p.eyebrowLine} />
                {place ? `חיפוש ב${place}` : 'חיפוש בכל הארץ'}
              </span>
              <h1 className={p.h1}>
                {headline(st)}
                <span className={p.h1Dot}>.</span>
              </h1>
              <p className={p.answer}>
                {total === 0 ? (
                  <>אף עסק לא עומד בחיפוש הזה, מתוך <span className="ltr tnum">{counts.total.toLocaleString('en-US')}</span> באינדקס.</>
                ) : (
                  <>
                    <BizCount n={total} /> {total === 1 ? 'עומד' : 'עומדים'} בחיפוש הזה, מתוך <span className="ltr tnum">{counts.total.toLocaleString('en-US')}</span> באינדקס.
                  </>
                )}{' '}
                {st.sort === 'recommended'
                  ? 'הסדר נקבע לפי אימות הבעלות, דירוג גוגל ומספר הביקורות, לא לפי תשלום.'
                  : `${SORT_LINE[st.sort]}. תשלום אף פעם לא משנה את הסדר.`}
              </p>
            </div>
            <p dir="ltr" className={p.queryPath}>{queryPath}</p>
          </div>

          <div className={p.presets}>
            <span className={p.presetsLabel}>מבוקש</span>
            {PRESETS.map(pr => (
              <Link key={pr.name} href={searchHref({ ...DEFAULT_STATE, ...pr.st })} className={p.preset}>
                {pr.name}
              </Link>
            ))}
          </div>

          <div className={s.shell}>
            <FilterPanel counts={counts} />

            <section aria-labelledby="h-results" className={p.results}>
              <ResultsToolbar />

              {/* TODO(sponsored): no campaigns table yet, so no sponsored slot. When it exists: at most 2
                  sponsored cards per list, each tagged "ממומן", shown with the note "מקום בתשלום. הוא לעולם
                  אינו משנה את סדר התוצאות שמתחת." and never changing the order of the results below. */}

              <ResultsRegion hasResults={total > 0}>
                {total === 0 ? (
                  <NoResults rescues={rescues} categories={noResCats.length ? noResCats : CATEGORIES.slice(0, 8)} hasFilters={hasPanelFilters(st)} />
                ) : (
                  <ol className={s.list}>
                    {items.map((c, i) => (
                      <ResultCard key={c.id} card={c} extra={extras[c.id]} index={i} delay={(i % PER_LOAD) * 45} query={st.q} />
                    ))}
                  </ol>
                )}
              </ResultsRegion>

              <LoadMore shown={items.length} total={total} perLoad={PER_LOAD} />

              <section aria-labelledby="h-related" className={p.related}>
                <h2 id="h-related" className={p.relatedTitle}>דפים מאונדקסים לחיפוש הזה</h2>
                <p className={p.relatedLine}>
                  דפי חיפוש אינם מאונדקסים. אלה דפי האינדקס שמכסים את אותו תחום, כך שהקישורים והדירוג נשארים על כתובת קנונית אחת לכל עיר ולכל תחום טיפול.
                </p>
                <div className={p.relatedLinks}>
                  {related.map(l => (
                    <Link key={l.href} href={l.href} className={p.relatedLink}>
                      <span className={p.relatedName}>{l.name}</span>
                      <span dir="ltr" className={p.relatedHref}>{l.href}</span>
                    </Link>
                  ))}
                </div>
              </section>
            </section>
          </div>
        </main>

        <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
      </div>
    </SearchProvider>
  );
}
