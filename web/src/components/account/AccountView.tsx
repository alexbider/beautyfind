'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { requestDeletionAction, setConsentAction, updateNameAction } from '@/app/account/actions';
import { relHe } from '@/components/profile/format';
import { setSaved } from '../save-heart/SaveHeart';
import { PullToRefresh } from '../shell/PullToRefresh';
import { Segmented } from '../shell/Segmented';
import { SearchIcon, TopBar } from '../shell/TopBar';
import { ratingText } from '../saved/types';
import type { AccountData, ApptView, ConsentsView, Tone } from './data';
import { ConfirmDialog, Switch, Toast, useToast } from './ui';
import styles from './account.module.css';

// Design: project/BeautyFind Account.dc.html. Server data in, small optimistic writes out.

export type Tab = 'appts' | 'saved' | 'reviews' | 'settings';
const NAV: Array<[Tab, string]> = [
  ['appts', 'התורים שלי'],
  ['saved', 'קליניקות שמורות'],
  ['reviews', 'הביקורות שלי'],
  ['settings', 'הגדרות ופרטיות'],
];
const META: Record<Tab, [string, string]> = {
  appts: ['התורים שלי', 'תורים עתידיים וטיפולים שעברו. שינוי או ביטול דרך עמוד התור, לפי מדיניות הקליניקה.'],
  saved: ['קליניקות שמורות', 'הקליניקות שסימנתם, עם הדירוג והאחריות הרפואית שלהן.'],
  reviews: ['הביקורות שלי', 'ביקורות שכתבתם אחרי טיפול. ביקורת חדשה עוברת בדיקה לפני פרסום.'],
  settings: ['הגדרות ופרטיות', 'פרטים אישיים, הודעות ודיוור, ונתונים.'],
};
const CHANNELS: Array<['wa' | 'sms' | 'email', string]> = [
  ['wa', 'וואטסאפ'],
  ['sms', 'SMS'],
  ['email', 'מייל'],
];
const SERVICE_MSGS: Array<[string, string]> = [
  ['אישור ותזכורת לתור', 'בוואטסאפ, ותזכורת לפני התור'],
  ['הנחיות אחרי טיפול ובקשת ביקורת', 'מהקליניקה שטיפלה בך'],
  ['קבלות, חשבוניות והחזרים', 'במייל, מהקליניקה'],
];

const toneClass = (t: Tone) => styles[`tone_${t}`];
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

export function AccountView({ data, initialTab }: { data: AccountData; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [savedOut, setSavedOut] = useState<Set<string>>(new Set());
  const { toast, show, hide } = useToast();

  useEffect(() => {
    // Keep the tab in the URL so refresh and back return to it.
    const url = new URL(window.location.href);
    if (tab === 'appts') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [tab]);

  const saved = data.saved.filter(c => !savedOut.has(c.id));
  const counts: Record<Tab, number> = { appts: data.upcoming.length, saved: saved.length, reviews: data.reviews.length, settings: 0 };
  const pick = (t: Tab) => setTab(t);

  const removeSaved = (id: string, name: string) => {
    setSavedOut(s => new Set(s).add(id));
    void setSaved(id, false).then(ok => {
      if (!ok) {
        setSavedOut(s => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        return show('לא הצלחנו להסיר. נסו שוב.');
      }
      show(`${name} הוסרה מהשמורים`, {
        label: 'ביטול',
        run: () =>
          void setSaved(id, true).then(() =>
            setSavedOut(s => {
              const n = new Set(s);
              n.delete(id);
              return n;
            }),
          ),
      });
    });
  };

  // App shell: "התורים שלי" is a tab root; the other sections are pushed screens reached from "עוד".
  const topBar =
    tab === 'appts' ? (
      <TopBar mode="root" largeTitle="התורים שלי" actions={[{ label: 'חיפוש', href: '/search', icon: SearchIcon }]} />
    ) : (
      <TopBar mode="pushed" title={META[tab][0]} backHref="/more" />
    );

  return (
    <>
    {topBar}
    <div className={styles.shell}>
      <aside className={styles.side} aria-label="החשבון">
        <div className={styles.who}>
          <span className={styles.avatar} aria-hidden="true">{data.profile.initials}</span>
          <span className={styles.whoText}>
            <span className={styles.whoName}>{data.profile.name}</span>
            {data.profile.phone && <span className={`ltr ${styles.whoSub}`}>{data.profile.phone}</span>}
          </span>
          <form action="/logout" method="post" className={styles.whoLogout}>
            <button type="submit" className={styles.logoutSm}>יציאה</button>
          </form>
        </div>
        <nav aria-label="ניווט החשבון" className={styles.navCard}>
          <ul className={styles.navList}>
            {NAV.map(([k, name]) => (
              <li key={k}>
                <button type="button" className={styles.navBtn} aria-current={tab === k ? 'page' : undefined} onClick={() => pick(k)}>
                  <span className={styles.navName}>{name}</span>
                  {counts[k] > 0 && <span className={`ltr tnum ${styles.badge}`}>{counts[k]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <p className={styles.sideNote}>שינוי או ביטול ללא חיוב עד חלון הביטול של הקליניקה, בדרך כלל <span className="ltr">24</span> שעות לפני התור. המדיניות שהוצגה לך בהזמנה היא הקובעת.</p>
        <form action="/logout" method="post" className={styles.logoutForm}>
          <button type="submit" className={styles.logout}>יציאה מהחשבון</button>
        </form>
      </aside>

      <main className={styles.main}>
        <nav className={styles.tabs} aria-label="ניווט החשבון">
          {NAV.map(([k, name]) => (
            <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} className={styles.tab} onClick={() => pick(k)}>
              {name}
            </button>
          ))}
        </nav>

        <div className={styles.titleBlock}>
          <h1 className={styles.h1}>{META[tab][0]}</h1>
          <p className={styles.lead}>{META[tab][1]}</p>
        </div>

        {tab === 'appts' && <Appointments key="appts" data={data} />}

        {tab === 'saved' && (
          <div key="saved">
            <div className={styles.two}>
              {saved.map(c => (
                <article key={c.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2 className={styles.cardTitle}><Link href={c.href}>{c.name}</Link></h2>
                    <button type="button" className={styles.x} aria-label={`הסרת ${c.name} מהשמורים`} onClick={() => removeSaved(c.id, c.name)}>×</button>
                  </div>
                  <p className={styles.muted}>{[c.city, c.cats].filter(Boolean).join(' · ')}</p>
                  <p className={styles.ratings}>
                    {c.google && <span>Google <span className="ltr tnum">★ {ratingText(c.google.rating)}</span> <span className={styles.count}>(<span className="ltr tnum">{c.google.count.toLocaleString('en-US')}</span>)</span></span>}
                    {c.beautyfind && <span>BeautyFind <span className="ltr tnum">★ {ratingText(c.beautyfind.rating)}</span> <span className={styles.count}>(<span className="ltr tnum">{c.beautyfind.count.toLocaleString('en-US')}</span>)</span></span>}
                    {!c.google && !c.beautyfind && <span className={styles.count}>עדיין אין דירוג</span>}
                  </p>
                  {c.responsible && <p className={styles.resp}>{c.responsible}</p>}
                  <div className={styles.actions}>
                    <Link href={c.bookHref} className={styles.btnPrimarySm}>{c.bookLabel === 'לפרופיל' ? 'לפרופיל הקליניקה' : c.bookLabel}</Link>
                    {c.savedIso && <span className={styles.savedAt}>נשמרה {relHe(new Date(c.savedIso))}</span>}
                  </div>
                </article>
              ))}
              {saved.length === 0 && (
                <div className={`${styles.empty} ${styles.full}`}>
                  <p className={styles.emptyTitle}>לא שמרתם קליניקות</p>
                  <p className={styles.emptyText}>סמנו קליניקה בלב בתוצאות החיפוש כדי לחזור אליה מכאן.</p>
                </div>
              )}
            </div>
            {saved.length > 0 && (
              <p className={styles.moreLink}>
                <Link href="/saved">לכל השמורים ולהשוואה בין קליניקות</Link>
              </p>
            )}
          </div>
        )}

        {tab === 'reviews' && (
          <div className={styles.stack} key="reviews">
            {data.reviews.map(r => (
              <article key={r.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>{r.clinic}</h2>
                  <span className={`ltr ${styles.stars}`} aria-label={`דירוג ${r.rating} מתוך 5`}>{stars(r.rating)}</span>
                  <span className={`${styles.pill} ${toneClass(r.tone)}`}>{r.state}</span>
                </div>
                <p className={styles.subtle}>
                  {r.svc && <>{r.svc} · </>}
                  <span className="ltr tnum">{r.date}</span>
                </p>
                <p className={styles.revTitle}>{r.title}</p>
                <p className={styles.revBody}>{r.body}</p>
                {r.reply && (
                  <div className={styles.reply}>
                    <p className={styles.replyHead}>תשובת הקליניקה</p>
                    <p className={styles.replyText}>{r.reply}</p>
                  </div>
                )}
              </article>
            ))}
            {data.reviews.length === 0 && (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>לא כתבתם ביקורות</p>
                <p className={styles.emptyText}>אחרי טיפול נשלח קישור לכתיבת ביקורת. רק מי שהיתה בטיפול יכולה לכתוב.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && <Settings data={data} show={show} />}
      </main>

      <Toast toast={toast} onHide={hide} />
    </div>
    </>
  );
}

/** Appointments: both lists on desktop; on phones an upcoming / past segmented control, pull to refresh, quick links. */
function Appointments({ data }: { data: AccountData }) {
  const [seg, setSeg] = useState<'up' | 'past'>('up');
  return (
    <PullToRefresh>
      <div className={styles.stack} data-seg={seg}>
        <div className={styles.segSlot}>
          <Segmented
            sticky
            label="התורים שלי"
            value={seg}
            onChange={k => setSeg(k as 'up' | 'past')}
            items={[
              { key: 'up', label: 'קרובים', count: data.upcoming.length },
              { key: 'past', label: 'קודמים', count: data.past.length },
            ]}
          />
        </div>
        <div className={styles.grpUp}>
          {data.upcoming.map(a => <Appt key={a.id} a={a} />)}
          {data.upcoming.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>אין תורים עתידיים</p>
              <p className={styles.emptyText}>מצאו קליניקה מאומתת באזור שלכם וקבעו תור.</p>
              <Link href="/search" className={styles.btnPrimary}>חיפוש קליניקה</Link>
            </div>
          )}
        </div>
        <div className={styles.grpPast}>
          {data.past.length > 0 ? (
            <>
              <h2 className={styles.sectionHead}>תורים קודמים וביטולים</h2>
              {data.past.map(a => <Appt key={a.id} a={a} />)}
            </>
          ) : (
            <div className={`${styles.empty} bf-shell-only`}>
              <p className={styles.emptyTitle}>אין עדיין תורים קודמים</p>
              <p className={styles.emptyText}>טיפולים שהסתיימו ותורים שבוטלו יופיעו כאן.</p>
            </div>
          )}
        </div>
        <nav aria-label="עוד בחשבון" className={`${styles.quick} bf-shell-only`}>
          <Link href="/saved" className={styles.quickRow}>קליניקות שמורות<QuickChevron /></Link>
          <Link href="/account?tab=reviews" className={styles.quickRow}>הביקורות שלי<QuickChevron /></Link>
          <Link href="/account?tab=settings" className={styles.quickRow}>הגדרות ופרטיות<QuickChevron /></Link>
        </nav>
      </div>
    </PullToRefresh>
  );
}

function QuickChevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function Appt({ a }: { a: ApptView }) {
  return (
    <article className={styles.appt} data-late={a.notice && a.upcoming ? true : undefined}>
      <div className={styles.apptTop}>
        <span className={styles.dateBox} data-past={!a.upcoming || undefined} aria-hidden="true">
          <span className={`ltr tnum ${styles.dom}`}>{a.dom}</span>
          <span className={styles.mon}>{a.mon}</span>
        </span>
        <div className={styles.apptBody}>
          <div className={styles.apptHead}>
            <h3 className={styles.apptTitle}>{a.svc}</h3>
            <span className={`${styles.pill} ${toneClass(a.tone)}`}>{a.state}</span>
          </div>
          <p className={styles.muted}>
            {a.weekday}, <span className="ltr tnum">{a.date}</span> · <span className="ltr tnum">{a.time}</span>
            {a.staff && <> · {a.staff}</>}
          </p>
          <p className={styles.muted}>{a.clinic}{a.address && <> · {a.address}</>}</p>
          {(a.price || a.notes.length > 0) && (
            <p className={styles.price}>
              {a.price && <><span className="ltr tnum">{a.price}</span> לפני מע״מ</>}
              {a.notes.map((n, i) => (
                <span key={i}>{(a.price || i > 0) && ' · '}{n.pre}{n.ltr && <span className="ltr tnum">{n.ltr}</span>}{n.post}</span>
              ))}
            </p>
          )}
        </div>
      </div>
      {a.notice && <p className={styles.notice}>{a.notice}</p>}
      <div className={styles.apptActions}>
        {a.upcoming ? (
          <>
            <Link href={a.manageHref} className={styles.btnPrimarySm}>{a.canChange ? 'שינוי או ביטול' : 'פרטי התור'}</Link>
            {a.wazeHref && <a href={a.wazeHref} target="_blank" rel="noopener noreferrer" className={styles.btnGhost}>ניווט</a>}
            {a.waHref && <a href={a.waHref} target="_blank" rel="noopener noreferrer" className={styles.btnTint}>הודעה לקליניקה</a>}
          </>
        ) : (
          <>
            {a.reviewHref && <Link href={a.reviewHref} className={styles.btnPrimarySm}>כתיבת ביקורת</Link>}
            <Link href={a.rebookHref} className={styles.btnGhost}>{a.rebookLabel}</Link>
          </>
        )}
        {a.receiptHref && <Link href={a.receiptHref} className={styles.btnLink}>קבלות וחשבוניות</Link>}
        <span className={styles.ref}>אסמכתא <span className="ltr tnum">{a.ref}</span></span>
      </div>
    </article>
  );
}

function Settings({ data, show }: { data: AccountData; show: (t: string) => void }) {
  const [name, setName] = useState(data.profile.name === 'החשבון שלי' ? '' : data.profile.name);
  const [savedName, setSavedName] = useState(name);
  const [nameErr, setNameErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consents, setConsents] = useState<ConsentsView>(data.consents);
  const [deletion, setDeletion] = useState(data.deletion);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const dirty = name.trim() !== savedName.trim();

  const saveName = async () => {
    if (name.trim().length < 2) return setNameErr(true);
    setNameErr(false);
    setBusy(true);
    const r = await updateNameAction(name).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setSavedName(name.trim());
      show('הפרטים נשמרו');
    } else show('לא הצלחנו לשמור. נסו שוב.');
  };

  const toggle = async (scope: string, ch: 'wa' | 'sms' | 'email', on: boolean) => {
    const before = consents;
    setConsents(c =>
      scope === 'all'
        ? { ...c, allStopped: { ...c.allStopped, [ch]: !on } }
        : { ...c, businesses: c.businesses.map(b => (b.id === scope ? { ...b, on: { ...b.on, [ch]: on } } : b)) },
    );
    const r = await setConsentAction(scope, ch, on).catch(() => null);
    if (r?.ok) show(on ? 'הדיוור הופעל' : 'הדיוור הופסק. זה נכנס לתוקף מיד.');
    else {
      setConsents(before);
      show('לא הצלחנו לעדכן. נסו שוב.');
    }
  };

  const doDelete = async () => {
    setBusy(true);
    const r = await requestDeletionAction(reason).catch(() => null);
    setBusy(false);
    setConfirm(false);
    if (r?.ok) {
      const d = new Date(r.requested);
      const fmt = (x: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(x);
      setDeletion({ requested: fmt(d), dueBy: fmt(new Date(d.getTime() + 30 * 86_400_000)) });
      show('בקשת המחיקה התקבלה');
    } else show('לא הצלחנו לשלוח את הבקשה. נסו שוב.');
  };

  return (
    <div className={styles.stack} key="settings">
      <section className={styles.panel} aria-labelledby="ac-details">
        <h2 id="ac-details" className={styles.panelTitle}>פרטים אישיים</h2>
        <div className={styles.fields}>
          <label className={styles.field}>
            שם מלא
            <input value={name} onChange={e => setName(e.target.value)} className={styles.input} aria-invalid={nameErr || undefined} autoComplete="name" maxLength={80} />
          </label>
          <label className={styles.field}>
            טלפון נייד
            <input value={data.profile.phone ?? ''} readOnly dir="ltr" className={`${styles.input} ${styles.readonly}`} placeholder="לא הוזן" />
          </label>
          <label className={styles.field}>
            דוא״ל
            <input value={data.profile.email ?? ''} readOnly dir="ltr" className={`${styles.input} ${styles.readonly}`} placeholder="לא הוזן" />
          </label>
        </div>
        <p className={styles.hint}>הטלפון והדוא״ל מאומתים בקוד, ולכן משתנים רק דרך <Link href="/contact">פנייה אלינו</Link>.</p>
        {nameErr && <p className={styles.err} role="alert">שם מלא צריך לכלול לפחות שני תווים.</p>}
        <div className={styles.saveRow}>
          <button type="button" className={styles.btnPrimary} onClick={saveName} disabled={busy || !dirty}>
            {dirty ? 'שמירת שינויים' : 'נשמר'}
          </button>
          {dirty && <span className={styles.dirty}>יש שינויים שלא נשמרו</span>}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="ac-msgs">
        <h2 id="ac-msgs" className={styles.panelTitle}>הודעות ודיוור</h2>
        <p className={styles.hint}>הודעות שירות נשלחות תמיד, הן חלק מהתור. דיוור ומבצעים נשלחים רק מעסקים שאישרת, ורק בערוצים שבחרת.</p>
        <ul className={styles.prefs}>
          {SERVICE_MSGS.map(([n, note]) => (
            <li key={n} className={styles.pref}>
              <span className={styles.prefText}>
                <span className={styles.prefName}>{n}</span>
                <span className={styles.prefNote}>{note}</span>
              </span>
              <span className={styles.locked}>קבוע</span>
            </li>
          ))}
        </ul>

        <h3 className={styles.subHead}>דיוור ומבצעים</h3>
        <div className={styles.matrix}>
          <div className={styles.mRow} data-head>
            <span className={styles.mName} />
            {CHANNELS.map(([ch, label]) => <span key={ch} className={styles.mCh}>{label}</span>)}
          </div>
          <div className={styles.mRow}>
            <span className={styles.mName}>
              <span className={styles.prefName}>כל העסקים ו־BeautyFind</span>
              <span className={styles.prefNote}>כיבוי עוצר כל דיוור בערוץ, מכל שולח</span>
            </span>
            {CHANNELS.map(([ch, label]) => (
              <span key={ch} className={styles.mCh}>
                <span className={styles.mChLabel} aria-hidden="true">{label}</span>
                <Switch size="sm" on={!consents.allStopped[ch]} disabled={!consents.contacts[ch]} label={`דיוור מכל העסקים ב${label}`} onChange={on => toggle('all', ch, on)} />
              </span>
            ))}
          </div>
          {consents.businesses.map(b => (
            <div key={b.id} className={styles.mRow}>
              <span className={styles.mName}><span className={styles.prefName}>{b.name}</span></span>
              {CHANNELS.map(([ch, label]) => (
                <span key={ch} className={styles.mCh}>
                  <span className={styles.mChLabel} aria-hidden="true">{label}</span>
                  <Switch
                    size="sm"
                    on={b.on[ch] && !consents.allStopped[ch]}
                    disabled={!consents.contacts[ch] || consents.allStopped[ch]}
                    label={`דיוור מ${b.name} ב${label}`}
                    onChange={on => toggle(b.id, ch, on)}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
        {consents.businesses.length === 0 && <p className={styles.hint}>אחרי תור ראשון, העסקים שביקרת בהם יופיעו כאן ותוכלי לבחור ממי לקבל עדכונים.</p>}
        {!consents.contacts.email && <p className={styles.hint}>אין דוא״ל בחשבון, ולכן אין דיוור במייל.</p>}
      </section>

      <section className={styles.panel} aria-labelledby="ac-privacy">
        <h2 id="ac-privacy" className={styles.panelTitle}>פרטיות ונתונים</h2>
        <p className={styles.hint}>
          רשומות רפואיות והצהרות בריאות שמורות אצל הקליניקה שטיפלה בכם, לא אצלנו, ואפשר לבקש אותן ממנה. אנחנו שומרים את התורים, הביקורות, הקליניקות השמורות וההעדפות שכאן.
        </p>
        {deletion && (
          <p className={styles.deletion} role="status">
            בקשת מחיקת החשבון התקבלה ב־<span className="ltr tnum">{deletion.requested}</span> ותטופל עד <span className="ltr tnum">{deletion.dueBy}</span>. נאשר בהודעה כשהחשבון יימחק.
          </p>
        )}
        <div className={styles.actionsWrap}>
          <a href="/account/export" download className={styles.btnGhostLg}>ייצוא הנתונים שלי</a>
          {!deletion && (
            <button type="button" className={styles.btnDangerSoft} onClick={() => setConfirm(true)}>מחיקת החשבון</button>
          )}
          <Link href="/privacy" className={styles.btnLinkLg}>מדיניות פרטיות</Link>
        </div>
      </section>

      <ConfirmDialog
        open={confirm}
        title="מחיקת החשבון"
        confirmLabel="שליחת בקשת מחיקה"
        cancelLabel="השארת החשבון"
        danger
        busy={busy}
        onConfirm={doDelete}
        onClose={() => setConfirm(false)}
      >
        <p>נמחק את החשבון, הקליניקות השמורות, ההעדפות והביקורות שלא פורסמו, תוך <span className="ltr">30</span> יום לפי מדיניות הפרטיות. תורים עתידיים לא יבוטלו אוטומטית, כדאי לבטל אותם קודם.</p>
        <p>חשבוניות ורשומות שהקליניקות חייבות לשמור על פי חוק יישארו אצלן.</p>
        <label className={styles.field}>
          סיבה (לא חובה)
          <textarea value={reason} onChange={e => setReason(e.target.value)} className={styles.textarea} rows={3} maxLength={500} />
        </label>
      </ConfirmDialog>
    </div>
  );
}
