'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { addLead } from '@/app/biz/leads/actions';
import { ArrowForward } from '@/components/icons';
import { fromE164, nis, telHref } from '@/lib/format';
import { BottomSheet } from '../../shell/BottomSheet';
import { PullToRefresh } from '../../shell/PullToRefresh';
import { Segmented } from '../../shell/Segmented';
import { SwipeRow, type SwipeAction } from '../../shell/SwipeRow';
import { revealFirstInvalid, useShell } from '../media';
import { LeadDetail, LeadRow } from './LeadRow';
import {
  EMPTY_LEAD, MANUAL_SOURCES, OPEN_STAGES, STAGES, clientsCount, sourceName, stageOf, validateLead,
  type LeadDTO, type LeadErrors, type LeadField, type LeadFields, type SourceKey, type StageKey,
} from './shared';
import styles from './Leads.module.css';

// The clinic system (Noa Clinic design) is a later phase. Set this to '/clinic' once it exists.
const CLINIC_HREF: string | null = null;

type Filter = 'all' | StageKey;

/** Numbers inside Hebrew text go in their own LTR span. */
const N = ({ n }: { n: number | string }) => <span className="ltr">{n}</span>;

function countPhrase(n: number): ReactNode {
  return n === 1 || n === 2 ? clientsCount(n) : <><N n={n} /> לקוחות</>;
}

function shownLine(shown: number, total: number): ReactNode {
  if (total === 0) return 'אין עדיין לקוחות בלוח';
  if (total === 1) return shown === 1 ? 'מוצג לקוח אחד' : 'הלקוח היחיד בלוח מוסתר בסינון';
  return <>{shown === 1 ? 'מוצג' : 'מוצגים'} <N n={shown} /> מתוך {countPhrase(total)}</>;
}

const digitsOf = (v: string) => v.replace(/\D/g, '');

function matches(l: LeadDTO, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [l.name, l.treatment, l.email, l.city].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(needle)) return true;
  // Phones match however they were typed: 052-441, 0524419930 or +97252...
  const qd = digitsOf(needle);
  if (qd.length >= 3 && l.phone) {
    const local = '0' + l.phone.slice(4);
    return local.includes(qd) || l.phone.includes(qd);
  }
  return false;
}

export function LeadsBoard({ leads, canEdit }: { leads: LeadDTO[]; canEdit: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // App shell: rows open the lead in a sheet, and the add form is a sheet too.
  const shell = useShell();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheetLead = sheetId ? leads.find(l => l.id === sheetId) ?? null : null;
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const shown = useMemo(() => leads.filter(l => (filter === 'all' || l.stage === filter) && matches(l, q)), [leads, filter, q]);

  // A deleted lead disappears from the props; keep the open id honest.
  useEffect(() => {
    if (openId && !leads.some(l => l.id === openId)) setOpenId(null);
    if (sheetId && !leads.some(l => l.id === sheetId)) setSheetId(null);
  }, [leads, openId, sheetId]);

  const total = leads.length;
  const openN = leads.filter(l => l.stage === 'new' || l.stage === 'contacted').length;
  const bookedN = leads.filter(l => l.stage === 'booked' || l.stage === 'done').length;
  const pipeline = leads.filter(l => OPEN_STAGES.includes(l.stage)).reduce((a, l) => a + (l.value ?? 0), 0);

  const stats: Array<{ label: string; value: string; note: ReactNode }> = [
    { label: 'פניות פתוחות', value: String(openN), note: 'ממתינות לפעולה שלכם' },
    { label: 'נקבע תור', value: String(bookedN), note: <>מתוך {countPhrase(total)} בלוח</> },
    { label: 'שיעור המרה לתור', value: `${total ? Math.round((bookedN / total) * 100) : 0}%`, note: 'מכלל הפניות שנרשמו' },
    { label: 'שווי בצנרת', value: nis(pipeline), note: 'לא כולל טיפולים שהסתיימו' },
  ];

  const chips = [{ key: 'all' as Filter, name: 'הכול', count: total }].concat(
    STAGES.map(s => ({ key: s.key as Filter, name: s.name, count: leads.filter(l => l.stage === s.key).length })),
  );

  const closeAdd = (added: boolean) => {
    setAddOpen(false);
    if (added) {
      setFilter('all');
      setQ('');
    }
    requestAnimationFrame(() => addBtnRef.current?.focus());
  };

  return (
    <section aria-labelledby="h-leads" className={styles.section}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 id="h-leads" ref={headingRef} tabIndex={-1} className={styles.h1}>ניהול לקוחות<span className={styles.dot}>.</span></h1>
          <p className={styles.lede}>
            טופס יצירת הקשר בפרופיל שולח לכם מייל ובמקביל פותח כרטיס לקוח כאן, עם תאריך ושעה. מי שהתקשר או כתב ב־WhatsApp, הוסיפו ידנית,
            כדי שכל ההיסטוריה תשב במקום אחד.{CLINIC_HREF && ' לתיק לקוח מלא, יומן וקופה, מעבר ל־CRM של הקליניקה.'}
          </p>
        </div>
        {CLINIC_HREF && (
          <a href={CLINIC_HREF} className={styles.clinicLink}>
            <span>ה־CRM של הקליניקה</span>
            <ArrowForward size={14} />
          </a>
        )}
        {canEdit && (
          <button
            ref={addBtnRef}
            type="button"
            className={styles.addBtn}
            aria-expanded={addOpen}
            aria-controls="lead-add"
            onClick={() => (addOpen ? closeAdd(false) : setAddOpen(true))}
          >
            <span aria-hidden="true" className={styles.plus}>+</span>הוספת לקוח
          </button>
        )}
      </div>

      {canEdit && addOpen && !shell && <AddLeadForm onClose={closeAdd} />}
      {canEdit && (
        <BottomSheet open={addOpen && shell} onClose={() => closeAdd(false)} title="לקוח חדש" size="full">
          <AddLeadForm onClose={closeAdd} inSheet />
        </BottomSheet>
      )}

      <dl className={styles.stats}>
        {stats.map(s => (
          <div key={s.label} className={styles.stat}>
            <dt className={styles.statLabel}>{s.label}</dt>
            <dd dir="ltr" className={styles.statValue}>{s.value}</dd>
            <dd className={styles.statNote}>{s.note}</dd>
          </div>
        ))}
      </dl>

      <div className={`${styles.segBleed} bf-shell-only`}>
        <Segmented
          label="סינון לפי שלב"
          value={filter}
          onChange={k => setFilter(k as Filter)}
          items={chips.map(c => ({ key: c.key, label: c.name, count: c.count }))}
        />
      </div>
      <div role="group" aria-label="סינון לפי שלב" className={`${styles.chips} bf-desk-only`}>
        {chips.map(c => {
          const on = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              className={styles.chip}
              onClick={() => { setFilter(c.key); setOpenId(null); }}
            >
              <span>{c.name}</span>
              <span dir="ltr" className={styles.chipCount}>{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.searchRow}>
        <label className={styles.search}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="5.4" /><path d="m12.2 12.2 3 3" />
          </svg>
          <span className="sr-only">חיפוש לקוח</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, טלפון או טיפול" />
        </label>
        <span className={styles.countLine} aria-live="polite">{shownLine(shown.length, total)}</span>
        <button type="button" className={styles.clear} onClick={() => { setQ(''); setFilter('all'); }}>ניקוי סינון</button>
      </div>

      {shown.length > 0 && (
        <div className={`${styles.rows} bf-shell-only`}>
          <PullToRefresh>
            <ul className={styles.rowList}>
              {shown.map(l => (
                <li key={l.id}>
                  <MobileLeadRow lead={l} onOpen={() => setSheetId(l.id)} />
                </li>
              ))}
            </ul>
          </PullToRefresh>
        </div>
      )}
      <BottomSheet open={!!sheetLead && shell} onClose={() => setSheetId(null)} title={sheetLead?.name ?? 'לקוח'} size="full">
        {sheetLead && (
          <LeadDetail
            id={`lead-sheet-${sheetLead.id}`}
            lead={sheetLead}
            canEdit={canEdit}
            stacked
            onDeleted={() => { setSheetId(null); headingRef.current?.focus(); }}
          />
        )}
      </BottomSheet>

      <div className={`${styles.list} ${shown.length > 0 ? 'bf-desk-only' : ''}`}>
        {shown.map(l => (
          <LeadRow
            key={l.id}
            lead={l}
            canEdit={canEdit}
            open={openId === l.id}
            onToggle={() => setOpenId(id => (id === l.id ? null : l.id))}
            onDeleted={() => { setOpenId(null); headingRef.current?.focus(); }}
          />
        ))}
        {shown.length === 0 && (
          total === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>עדיין אין לקוחות בלוח</p>
              <p className={styles.emptyNote}>פניות מהטופס בפרופיל יופיעו כאן אוטומטית. מי שהתקשר, כתב או נכנס לקליניקה, הוסיפו ידנית.</p>
            </div>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>אין לקוחות שמתאימים לסינון</p>
              <p className={styles.emptyNote}>נסו לנקות את החיפוש או לבחור שלב אחר.</p>
            </div>
          )
        )}
      </div>
    </section>
  );
}

// ---------- App shell row: 64-72px, full bleed, swipe for WhatsApp and call ----------

function MobileLeadRow({ lead: l, onOpen }: { lead: LeadDTO; onOpen: () => void }) {
  const stg = stageOf(l.stage);
  const sub = [l.treatment, sourceName(l.source)].filter(Boolean).join(' · ');
  const actions: SwipeAction[] = l.phone
    ? [
        { label: 'WhatsApp', tone: 'primary', onAction: () => window.open(`https://wa.me/${l.phone!.slice(1)}`, '_blank', 'noopener') },
        { label: 'חיוג', tone: 'neutral', onAction: () => window.location.assign(telHref(l.phone!)) },
      ]
    : [];
  const body = (
    <button type="button" className={styles.mRow} onClick={onOpen}>
      <span aria-hidden="true" className={styles.mAvatar}>{l.name.trim().slice(0, 1)}</span>
      <span className={styles.mText}>
        <span className={styles.mName}>{l.name}</span>
        <span className={styles.mSub}>{sub || (l.phone ? <span className="ltr">{fromE164(l.phone)}</span> : l.email)}</span>
      </span>
      <span className={styles.mEnd}>
        <span className={styles.pill} style={{ color: stg.color, background: stg.bg, borderColor: stg.border }}>{stg.name}</span>
        <span dir="ltr" className={styles.mWhen}>{l.lastWhen.split(' · ')[0]}</span>
      </span>
    </button>
  );
  return actions.length ? <SwipeRow actions={actions}>{body}</SwipeRow> : body;
}

// ---------- Manual add ----------

function AddLeadForm({ onClose, inSheet }: { onClose: (added: boolean) => void; inSheet?: boolean }) {
  const [f, setF] = useState<LeadFields>(EMPTY_LEAD);
  const [source, setSource] = useState<SourceKey>('phone');
  const [errs, setErrs] = useState<LeadErrors | null>(null);
  const [serverErr, setServerErr] = useState('');
  const [pending, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!inSheet) nameRef.current?.focus(); }, [inSheet]);

  const set = (k: LeadField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = k === 'value' ? digitsOf(e.target.value).slice(0, 7) : e.target.value;
    setF(prev => ({ ...prev, [k]: v }));
    setErrs(null);
    setServerErr('');
  };

  const submit = () => {
    const v = validateLead(f, { withNext: false });
    if (v.first) { setErrs(v); revealFirstInvalid(formRef.current); return; }
    start(async () => {
      const r = await addLead({ fields: f, source });
      if (r.ok) onClose(true);
      else {
        setServerErr(r.error);
        if (r.field) setErrs({ fields: { [r.field]: r.error }, first: r.error });
      }
    });
  };

  const message = serverErr || errs?.first || '';
  const bad = (k: LeadField) => !!errs?.fields[k];
  const aria = (k: LeadField) => ({ 'aria-invalid': bad(k) || undefined, 'aria-describedby': bad(k) ? 'lead-add-err' : undefined });

  return (
    <div
      ref={formRef}
      id="lead-add"
      role="region"
      aria-labelledby="lead-add-h"
      className={styles.addCard}
      data-sheet={inSheet || undefined}
      onKeyDown={e => { if (e.key === 'Escape') onClose(false); }}
    >
      <h2 id="lead-add-h" className={inSheet ? 'sr-only' : styles.addTitle}>לקוח חדש</h2>
      <p className={styles.addSub}>לתיעוד שיחה, הודעה ב־WhatsApp או מי שנכנס/ה לקליניקה. נדרש טלפון או דוא״ל.</p>
      <div className={styles.addFields}>
        <label className={`${styles.field} ${styles.g180}`}>
          <span className={styles.label}>שם <span className={styles.req} aria-hidden="true">*</span></span>
          <input ref={nameRef} type="text" value={f.name} onChange={set('name')} autoComplete="name" required maxLength={100} className={styles.input} {...aria('name')} />
        </label>
        <label className={`${styles.field} ${styles.g160}`}>
          <span className={styles.label}>טלפון</span>
          <input type="tel" dir="ltr" value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="050-000-0000" maxLength={24} className={`${styles.input} ${styles.num}`} {...aria('phone')} />
        </label>
        <label className={`${styles.field} ${styles.g190}`}>
          <span className={styles.label}>דוא״ל</span>
          <input type="email" dir="ltr" value={f.email} onChange={set('email')} autoComplete="email" placeholder="name@example.com" maxLength={170} className={`${styles.input} ${styles.ltrInput}`} {...aria('email')} />
        </label>
        <label className={`${styles.field} ${styles.w150}`}>
          <span className={styles.label}>יישוב</span>
          <input type="text" value={f.city} onChange={set('city')} autoComplete="address-level2" maxLength={70} className={styles.input} {...aria('city')} />
        </label>
        <label className={`${styles.field} ${styles.g180}`}>
          <span className={styles.label}>טיפול מבוקש</span>
          <input type="text" value={f.treatment} onChange={set('treatment')} maxLength={130} className={styles.input} {...aria('treatment')} />
        </label>
        <label className={`${styles.field} ${styles.w130}`}>
          <span className={styles.label}>שווי משוער ₪</span>
          <input type="text" dir="ltr" value={f.value} onChange={set('value')} inputMode="numeric" className={`${styles.input} ${styles.num}`} {...aria('value')} />
        </label>
      </div>
      <div role="group" aria-label="מקור הפנייה" className={styles.sources}>
        {MANUAL_SOURCES.map(s => (
          <button key={s.key} type="button" aria-pressed={source === s.key} className={styles.sourceChip} onClick={() => setSource(s.key)}>
            {s.name}
          </button>
        ))}
      </div>
      {message && <p id="lead-add-err" role="alert" className={styles.formErr}>{message}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={submit} disabled={pending}>הוספה ללוח</button>
        <button type="button" className={styles.ghost} onClick={() => onClose(false)}>ביטול</button>
      </div>
    </div>
  );
}
