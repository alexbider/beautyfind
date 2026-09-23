import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowForward, Check, ChevronDown } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ContentFaq } from './ContentFaq';
import { CookiePrefsButton } from './CookiePrefsButton';
import { PENDING } from './meta';
import { Rich, isHebrew, rich } from './Rich';
import type { Aside, Block, ContentView, Section, Stat, Table } from './types';
import styles from './content.module.css';

export interface Crumb {
  name: string;
  href?: string;
}

export interface ContentPageProps {
  /** 'content' = About / Standards scale; 'legal' = Legal document scale. */
  variant: 'content' | 'legal';
  crumbs: Crumb[];
  /** Sibling pages shown as the underlined switcher (real links, aria-current on this one). */
  tabs: { label: string; items: Array<{ key: string; name: string; href: string }> };
  view: ContentView;
  /** Stats with any live values already resolved. Defaults to view.stats. */
  stats?: Stat[];
  /** Extra line under the dek (Standards: effective date and version). */
  introExtra?: ReactNode;
  /** Label for the stats list. */
  statsLabel: string;
  tocTitle: string;
  tocLabel: string;
  jsonLd?: object[];
}

const pad = (n: number, legal: boolean) => (legal ? String(n) : String(n).padStart(2, '0'));

function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.6" />
      <path d="M10 6.2v.2M10 9v4.6" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="9" r="3.6" />
      <path d="M5.2 19.4c1.3-3.1 3.8-4.6 6.8-4.6s5.5 1.5 6.8 4.6" />
    </svg>
  );
}

function TableBlock({ table, label }: { table: Table; label: string }) {
  const status = table.kind === 'status';
  return (
    <figure className={styles.figure}>
      <div className={styles.tableScroll} role="region" aria-label={label} tabIndex={0}>
        <table className={styles.table} style={{ minWidth: table.minWidth ?? 420 }}>
          <thead>
            <tr>
              {table.head.map(h => <th key={h} scope="col">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={r.label}>
                <th scope="row">{rich(r.label, `tl${i}`)}</th>
                {status ? (
                  <>
                    <td>
                      <span className={styles.state} data-ok={r.state === 'ok' || undefined}>
                        <span aria-hidden="true" className={styles.mark} data-ok={r.state === 'ok' || undefined}>{r.state === 'ok' ? '✓' : '⋯'}</span>
                        {r.what}
                      </span>
                    </td>
                    <td>{rich(r.last, `td${i}`)}</td>
                  </>
                ) : (
                  <>
                    <td>{rich(r.what, `tw${i}`)}</td>
                    <td className={styles.strong}>{rich(r.last, `tf${i}`)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.caption && <figcaption><Rich text={table.caption} /></figcaption>}
    </figure>
  );
}

function BlockView({ block, section }: { block: Block; section: Section }) {
  switch (block.kind) {
    case 'paras':
      return (
        <>
          {block.paras.map((p, i) => (
            <p key={i} className={styles.para}>{rich(p, `p${i}`)}</p>
          ))}
        </>
      );
    case 'steps':
      return (
        <ol className={styles.stack}>
          {block.steps.map((s, i) => (
            <li key={s.name} className={styles.stackRow}>
              <span aria-hidden="true" className={`${styles.stepNum} ltr`}>{pad(i + 1, false)}</span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{rich(s.name, `sn${i}`)}</span>
                <span className={styles.rowBody}>{rich(s.body, `sb${i}`)}</span>
              </span>
            </li>
          ))}
        </ol>
      );
    case 'reqs':
      return (
        <ul className={styles.stack} data-kind="reqs">
          {block.reqs.map((r, i) => (
            <li key={r.name} className={styles.stackRow}>
              <span aria-hidden="true" className={styles.reqMark}>
                <span style={{ background: '#0B7A87' }}>✓</span>
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{rich(r.name, `rn${i}`)}</span>
                <span className={styles.rowBody}>{rich(r.body, `rb${i}`)}</span>
                <span className={styles.rowTag} style={{ color: '#0B7A87' }}>{r.tag}</span>
              </span>
            </li>
          ))}
        </ul>
      );
    case 'rules':
      return (
        <ul className={styles.rules}>
          {block.rules.map((r, i) => (
            <li key={i} className={styles.rule} data-ok={r.ok || undefined}>
              <span className={styles.ruleTag}>
                <span aria-hidden="true" className={styles.mark} data-ok={r.ok || undefined}>{r.ok ? '✓' : '✕'}</span>
                {r.tag}
              </span>
              <span className={styles.ruleBody}>{rich(r.body, `ru${i}`)}</span>
            </li>
          ))}
        </ul>
      );
    case 'items':
      return (
        <ul className={styles.items}>
          {block.items.map((it, i) => (
            <li key={it.name}>
              <span aria-hidden="true" className={styles.bullet} />
              <span className={styles.rowText}>
                <span className={styles.itemName}>{rich(it.name, `in${i}`)}</span>
                <span className={styles.itemBody}>{rich(it.body, `ib${i}`)}</span>
              </span>
            </li>
          ))}
        </ul>
      );
    case 'note':
      return (
        <div className={styles.note}>
          <InfoIcon />
          <p>
            <strong>{block.note.title}</strong> {rich(block.note.body, 'n')}
          </p>
        </div>
      );
    case 'team':
      return (
        <ul className={styles.team}>
          {block.team.map((m, i) => (
            <li key={m.role} className={styles.member}>
              <span aria-hidden="true" className={styles.avatar}>
                {m.img ? <Image src={m.img} alt="" fill sizes="52px" style={{ objectFit: 'cover' }} /> : <PersonIcon />}
              </span>
              <span className={styles.memberName}>{rich(m.name ?? m.role, `mn${i}`)}</span>
              {m.name && <span className={styles.memberRole}>{m.role}</span>}
              <span className={styles.memberBio}>{rich(m.bio, `mb${i}`)}</span>
            </li>
          ))}
        </ul>
      );
    case 'plans':
      return (
        <ul className={styles.plans}>
          {block.plans.map(p => (
            <li key={p.name} className={styles.plan} data-sponsored={p.sponsored || undefined}>
              <span className={styles.planTag}>{p.tag}</span>
              <span className={styles.planName}>{p.name}</span>
              <span className={`${styles.planPrice} ltr`}>{p.price}</span>
              <span className={styles.planUnit}>{rich(p.unit, 'u')}</span>
              <ul className={styles.planItems}>
                {p.items.map((it, i) => (
                  <li key={it}>
                    <Check size={14} strokeWidth={2} />
                    <span>{rich(it, `pi${i}`)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      );
    case 'sponsoredLabel':
      return (
        <figure className={styles.specimen}>
          <figcaption>כך נראה כרטיס ממומן באינדקס</figcaption>
          <div className={styles.specCard} aria-hidden="true">
            <span className={styles.specThumb}>
              <Image src="/assets/biz-facial.jpg" alt="" fill sizes="52px" style={{ objectFit: 'cover' }} />
            </span>
            <span className={styles.specText}>
              <span className={styles.specTop}>
                <span className={styles.specName}>שם העסק</span>
                <span className={styles.specTag}>ממומן</span>
              </span>
              <span className={styles.specMeta}>תחום · עיר</span>
            </span>
            <span dir="ltr" className={styles.specRating}>★ 4.8 (120)</span>
          </div>
          <p>
            התג &quot;ממומן&quot; מוצג תמיד, בלי אפשרות להסתירו. הכרטיס אינו נספר בדירוג האורגני של העמוד ואינו נכלל בהשוואה בין עסקים.
          </p>
        </figure>
      );
    case 'table':
      return <TableBlock table={block.table} label={section.head} />;
    case 'faq':
      return <ContentFaq faqs={block.faqs} />;
    case 'cookiePrefs':
      return <CookiePrefsButton />;
    case 'fine':
      return <p className={styles.fine}>{rich(block.text, 'f')}</p>;
  }
}

function Toc({ sections, legal }: { sections: Section[]; legal: boolean }) {
  return sections.map((s, i) => (
    <a key={s.id} href={`#${s.id}`} className={styles.tocLink}>
      <span className={`${styles.tocNum} ltr`}>{pad(i + 1, legal)}</span>
      <span className={styles.tocName}>{s.head}</span>
    </a>
  ));
}

function AsideMore({ aside }: { aside: Aside }) {
  const external = !aside.href.startsWith('/');
  const inner = (
    <>
      {aside.ltr ? <span className="ltr">{aside.label}</span> : aside.label}
      {aside.arrow !== false && !aside.ltr && <ArrowForward size={13} />}
    </>
  );
  return (
    <div className={styles.railMore}>
      <div className={styles.railMoreTitle}>{aside.title}</div>
      <p>{rich(aside.body, 'as')}</p>
      {external ? (
        <a href={aside.href} className={styles.railMoreLink}>{inner}</a>
      ) : (
        <Link href={aside.href} className={styles.railMoreLink}>{inner}</Link>
      )}
    </div>
  );
}

export function ContentPage(props: ContentPageProps) {
  const { variant, crumbs, tabs, view, introExtra, statsLabel, tocTitle, tocLabel, jsonLd } = props;
  const legal = variant === 'legal';
  const stats = props.stats ?? view.stats;
  const { cta } = view;
  const ctaExternal = !cta.primary.href.startsWith('/');
  const ctaInner = (
    <>
      <span className={cta.primary.ltr ? 'ltr' : undefined}>{cta.primary.label}</span>
      {cta.primary.arrow !== false && !cta.primary.ltr && <ArrowForward />}
    </>
  );

  return (
    <div className={styles.root} data-variant={variant}>
      {jsonLd?.map((j, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j) }} />
      ))}
      <SiteHeader variant="public" />

      <nav aria-label="נתיב ניווט" className={styles.crumbs}>
        <ol className={styles.crumbList}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return [
              i > 0 && <li key={`s${i}`} aria-hidden="true" className={styles.crumbSep}>/</li>,
              <li key={c.name} className={last ? styles.crumbCurrent : undefined} aria-current={last ? 'page' : undefined}>
                {!last && c.href ? <Link href={c.href}>{c.name}</Link> : c.name}
              </li>,
            ];
          })}
        </ol>
      </nav>

      <section aria-labelledby="h-title" className={styles.intro}>
        <div className={styles.introGrid}>
          <div className={styles.introCopy}>
            <span className={styles.kicker}>
              <span aria-hidden="true" className={styles.kickerLine} />
              {view.kicker}
            </span>
            <h1 id="h-title" className={styles.h1}>
              {view.title}
              <span className={styles.dot}>.</span>
            </h1>
            <p className={styles.dek}>{rich(view.dek, 'dek')}</p>
            {introExtra}
          </div>
          <dl className={styles.stats} aria-label={statsLabel}>
            {stats.map((s, i) => (
              <div key={s.label} className={styles.stat}>
                <dt>{s.label}</dt>
                {isHebrew(s.value) ? <dd>{rich(s.value, `st${i}`)}</dd> : <dd dir="ltr">{s.value}</dd>}
              </div>
            ))}
          </dl>
        </div>
        <div className={styles.tabsWrap}>
          <nav aria-label={tabs.label} className={styles.tabs}>
            {tabs.items.map(t => (
              <Link key={t.key} href={t.href} className={styles.tab} aria-current={t.key === view.key ? 'page' : undefined}>
                {t.name}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <main className={styles.main}>
        <div className={styles.mainGrid}>
          <aside className={styles.rail}>
            <nav aria-label={tocLabel} className={styles.railNav}>
              <div className={styles.railTitle}>{tocTitle}</div>
              <Toc sections={view.sections} legal={legal} />
            </nav>
            <AsideMore aside={view.aside} />
          </aside>

          <div className={styles.body}>
            <details className={styles.mobileToc}>
              <summary>
                {tocTitle}
                <ChevronDown />
              </summary>
              <nav aria-label={tocLabel} className={styles.railNav}>
                <Toc sections={view.sections} legal={legal} />
              </nav>
            </details>

            {view.sections.map((sec, i) => (
              <section key={sec.id} id={sec.id} aria-labelledby={`h-${sec.id}`} className={styles.section}>
                <div className={styles.secHead}>
                  <span aria-hidden="true" className={`${styles.secNum} ltr`}>{pad(i + 1, legal)}</span>
                  <h2 id={`h-${sec.id}`} className={styles.h2}>{sec.head}</h2>
                </div>
                {sec.blocks.map((b, j) => (
                  <BlockView key={j} block={b} section={sec} />
                ))}
              </section>
            ))}

            <section aria-labelledby="h-cta" className={styles.cta}>
              <div className={styles.ctaCopy}>
                <h2 id="h-cta" className={styles.ctaH}>{cta.title}</h2>
                <p className={styles.ctaBody}>{rich(cta.body, 'cta')}</p>
              </div>
              <div className={styles.ctaBtns}>
                {ctaExternal ? (
                  <a href={cta.primary.href} className={styles.ctaPrimary}>{ctaInner}</a>
                ) : (
                  <Link href={cta.primary.href} className={styles.ctaPrimary}>{ctaInner}</Link>
                )}
                <Link href={cta.secondary.href} className={styles.ctaGhost}>{cta.secondary.label}</Link>
              </div>
            </section>
          </div>
        </div>
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
