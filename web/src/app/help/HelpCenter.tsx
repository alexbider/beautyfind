'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { contactHref, slaLine } from '@/components/contact/reasons';
import { matchesQuery, normalizeHe } from '@/components/help/search';
import { SIDE, TOPICS, faqJsonLd, faqsFor, type Audience, type TopicKey } from './content';
import styles from './HelpCenter.module.css';

const AUDIENCES: Array<{ key: Audience; name: string }> = [
  { key: 'client', name: 'אני לקוחה' },
  { key: 'biz', name: 'יש לי עסק' },
];

/** שאלה אחת · שתי שאלות · N שאלות */
const plQ = (n: number) => (n === 1 ? 'שאלה אחת' : n === 2 ? 'שתי שאלות' : `${n} שאלות`);

export function HelpCenter({ initialAudience, initialQuery = '' }: { initialAudience: Audience; initialQuery?: string }) {
  const [aud, setAud] = useState<Audience>(initialAudience);
  const [topic, setTopic] = useState<TopicKey | null>(null);
  const [q, setQ] = useState(initialQuery);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [voted, setVoted] = useState<Record<string, 'y' | 'n'>>({});

  const topics = TOPICS[aud];
  const pool = useMemo(
    () => faqsFor(aud).map(f => ({ ...f, hay: normalizeHe(`${f.q} ${f.a} ${TOPICS[aud].find(t => t.key === f.topic)?.name ?? ''}`) })),
    [aud],
  );
  const query = q.trim();
  const list = pool.filter(f => (!topic || f.topic === topic) && matchesQuery(f.hay, query));
  const topicName = (k: TopicKey) => topics.find(t => t.key === k)?.name ?? '';
  const contactReason = aud === 'client' ? 'general' : 'business';

  const pickAudience = (a: Audience) => {
    if (a === aud) return;
    setAud(a);
    setTopic(null);
    setOpen({});
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.set('audience', a);
      window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`);
    } catch {}
  };

  const title = query ? `${plQ(list.length)} על ״${query}״` : topic ? topicName(topic) : aud === 'client' ? 'שאלות נפוצות' : 'שאלות נפוצות לעסקים';
  const filtered = !!(query || topic);
  const announce = query || topic ? (list.length ? `נמצאו ${plQ(list.length)}` : 'לא נמצאו שאלות מתאימות') : '';
  const side = SIDE[aud];
  const placeholder = aud === 'client' ? 'למשל: ביטול תור, מקדמה, בוטוקס' : 'למשל: סניף נוסף, רישיון, ביקורת';

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(aud)) }} />

      {/* App shell: the search field sits under the top bar and stays there while scrolling. */}
      <form role="search" className={`${styles.phoneSearch} bf-shell-only`} onSubmit={e => e.preventDefault()}>
        <label htmlFor="hp-q-phone" className="sr-only">חיפוש בשאלות</label>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#5B6B7B" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="6" />
          <path d="m13 13 5 5" />
        </svg>
        <input
          id="hp-q-phone" type="search" value={q} aria-controls="hp-list" autoComplete="off" enterKeyHint="search"
          onChange={e => { setQ(e.target.value); setTopic(null); }}
          placeholder={placeholder}
        />
      </form>

      <section aria-labelledby="hp-h" className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 id="hp-h" className={styles.h1}>במה אפשר לעזור?</h1>
          <div role="group" aria-label="אני" className={styles.auds}>
            {AUDIENCES.map(a => {
              const on = a.key === aud;
              return (
                <button key={a.key} type="button" aria-pressed={on} aria-controls="hp-list" onClick={() => pickAudience(a.key)} className={styles.aud} data-on={on || undefined}>
                  {a.name}
                </button>
              );
            })}
          </div>
          <form role="search" className={`${styles.search} bf-desk-only`} onSubmit={e => e.preventDefault()}>
            <label htmlFor="hp-q" className="sr-only">חיפוש בשאלות</label>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#5B6B7B" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="6" />
              <path d="m13 13 5 5" />
            </svg>
            <input
              id="hp-q" type="search" value={q} aria-controls="hp-list" autoComplete="off"
              onChange={e => { setQ(e.target.value); setTopic(null); }}
              placeholder={placeholder}
            />
          </form>
        </div>
      </section>

      <div className={styles.body}>
        <nav aria-label="נושאים" className={styles.topics}>
          {topics.map(t => {
            const on = topic === t.key;
            return (
              <button key={t.key} type="button" aria-pressed={on} onClick={() => { setTopic(on ? null : t.key); setQ(''); }} className={styles.topic} data-on={on || undefined}>
                <span className={styles.topicName}>{t.name}</span>
                <span className={styles.topicCount}>{plQ(pool.filter(f => f.topic === t.key).length)}</span>
              </button>
            );
          })}
        </nav>

        <div className={styles.shell}>
          <main id="hp-list" className={styles.main} key={aud}>
            <div className={styles.listHead}>
              <h2 className={styles.h2}>{title}</h2>
              {filtered && (
                <button type="button" onClick={() => { setQ(''); setTopic(null); }} className={styles.clear}>כל השאלות</button>
              )}
            </div>
            <p aria-live="polite" className="sr-only">{announce}</p>

            {list.length === 0 ? (
              <div className={styles.none}>
                <p className={styles.noneTitle}>לא מצאנו תשובה ל״{query}״</p>
                <p className={styles.noneBody}>
                  נסו מילה אחרת, או <Link href={contactHref(contactReason)}>כתבו לנו</Link>. {slaLine(contactReason)}.
                </p>
              </div>
            ) : (
              <div className={styles.list}>
                {list.map((f, i) => {
                  const isOpen = !!open[f.q];
                  const v = voted[f.q];
                  const id = `hp-a-${aud}-${i}`;
                  return (
                    <div key={f.q} className={styles.item} data-open={isOpen || undefined}>
                      <h3 className={styles.itemH}>
                        <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(o => ({ ...o, [f.q]: !o[f.q] }))} className={styles.q}>
                          <span className={styles.qText}>
                            <span className={styles.qTitle}>{f.q}</span>
                            <span className={styles.qTopic}>{topicName(f.topic)}</span>
                          </span>
                          <span aria-hidden="true" className={styles.sign}>{isOpen ? '−' : '+'}</span>
                        </button>
                      </h3>
                      {isOpen && (
                        <div id={id} className={styles.answer}>
                          <p>{f.a}</p>
                          {f.link && <Link href={f.link.href} className={styles.answerLink}>{f.link.label}</Link>}
                          <div className={styles.vote}>
                            <span role="status">{v === 'y' ? 'תודה!' : v === 'n' ? 'תודה. נשפר את התשובה.' : 'עזר?'}</span>
                            {!v && (
                              <>
                                <button type="button" onClick={() => setVoted(s => ({ ...s, [f.q]: 'y' }))}>כן</button>
                                <button type="button" onClick={() => setVoted(s => ({ ...s, [f.q]: 'n' }))}>לא</button>
                              </>
                            )}
                            {v === 'n' && <Link href={contactHref(contactReason)} className={styles.voteLink}>לשאול אותנו ישירות</Link>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          <aside className={styles.side}>
            <div className={styles.card}>
              <h2 className={styles.cardH}>{side.title}</h2>
              <p className={styles.cardBody}>{side.body}</p>
              <div className={styles.cardLinks}>
                {side.links.map(l => (
                  <Link key={l.href} href={l.href} className={styles.sideLink}>{l.name}</Link>
                ))}
              </div>
            </div>
            <div className={styles.card}>
              <h2 className={styles.cardH}>לא מצאתם?</h2>
              <div className={styles.cardLinks}>
                <Link href={contactHref(contactReason)} className={styles.contactBtn}>טופס פנייה · {slaLine(contactReason)}</Link>
                <a href="mailto:help@beautyfind.co.il" className={styles.sideLink}>
                  <span className="ltr">help@beautyfind.co.il</span>
                </a>
              </div>
              <p className={styles.cardNote}>
                שאלה על טיפול או תור ספציפי? הקליניקה היא הכתובת: הפרטים בכל פרופיל. בבעיה רפואית דחופה חייגו <a href="tel:101" className="ltr">101</a>.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
