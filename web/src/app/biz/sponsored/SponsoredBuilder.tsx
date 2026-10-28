'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { SponsoredCard } from '@/components/sponsored/SponsoredSlider';
import { freeSlotsHe, PLACEMENT_HINT, PLACEMENT_NAME, type Placement, type SponsoredCardData } from '@/lib/sponsored';
import { contentChecks, SPONSORED_LINE_MAX } from '@/lib/sponsoredChecks';
import type { PageOption } from '@/lib/server/sponsored';
import { cancelPlacementAction, requestPlacementAction, resumePlacementAction, saveCardAction } from './actions';
import s from './page.module.css';

type Preview = Omit<SponsoredCardData, 'campaignId' | 'line' | 'featured'>;

const GROUPS: Placement[] = ['city_list', 'treatment_page', 'homepage'];
const nis = (n: number) => `₪${n.toLocaleString('en-US')}`;

export function SponsoredBuilder({ options, previews, categoryNames, suggestions, free, hasCard, listNis, homeNis, slots }: {
  options: PageOption[];
  previews: Record<string, Preview>;
  categoryNames: Record<string, Record<string, string>>;
  suggestions: Record<string, string[]>;
  free: boolean;
  hasCard: boolean;
  listNis: number;
  homeNis: number;
  slots: number;
}) {
  const router = useRouter();
  const firstOpen = options.find(o => o.free > 0) ?? options[0];
  const [key, setKey] = useState(firstOpen?.pageKey ?? '');
  const [line, setLine] = useState('');
  const [featured, setFeatured] = useState<string | null>(null);
  const [customFeat, setCustomFeat] = useState('');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; free: boolean } | null>(null);
  const [pending, start] = useTransition();

  const opt = options.find(o => o.pageKey === key) ?? null;
  const checks = useMemo(() => contentChecks(line, featured ?? customFeat), [line, featured, customFeat]);
  const flags = checks.filter(c => c.result === 'bad' && line.trim());
  const feat = (featured ?? customFeat).trim() || null;
  const lineOk = line.trim().length >= 3 && !flags.length;

  const preview: SponsoredCardData | null = opt && previews[opt.branchId] ? {
    ...previews[opt.branchId],
    campaignId: 'preview',
    categoryName: (opt.categorySlug && categoryNames[opt.branchId]?.[opt.categorySlug]) || previews[opt.branchId].categoryName,
    line: line.trim() || 'שורת ההדגשה שלכם תופיע כאן',
    featured: feat,
  } : null;

  const submit = () => {
    setTried(true);
    setErr(null);
    if (!opt) return setErr('בחרו איפה להופיע');
    if (opt.free <= 0) return setErr('אין מקום פנוי בעמוד הזה כרגע');
    if (!line.trim()) return setErr('כתבו שורת הדגשה');
    if (!lineOk) return setErr('שורת ההדגשה כוללת ניסוח שלא יאושר בבדיקה');
    start(async () => {
      const r = await requestPlacementAction({ branchId: opt.branchId, pageKey: opt.pageKey, line: line.trim(), featuredTreatment: feat ?? undefined });
      if (!r.ok) return setErr(r.error);
      if (r.url) {
        window.location.href = r.url; // Stripe: save a card, no charge
        return;
      }
      setDone({ ref: r.ref ?? '', free: r.message === 'free' });
      router.refresh();
    });
  };

  if (done) {
    return (
      <div className={s.done}>
        <span className={s.doneIcon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 7.5 2.5 2.5L11 4.5" /></svg>
        </span>
        <h2 className={s.doneTitle}>נשלח לבדיקה</h2>
        <p className={s.doneText}>
          המקום שמור לכם ל־24 שעות עד שהבדיקה תסתיים, בדרך כלל תוך יום עסקים. {done.free ? 'החודש הראשון עלינו, והחיוב החודשי יתחיל רק בסופו.' : 'החיוב החודשי יתחיל רק אחרי האישור.'} נעדכן במייל ובלוח הבקרה.
        </p>
        <dl className={s.doneList}>
          <dt>איפה</dt><dd>{opt?.title}</dd>
          <dt>מספר</dt><dd className="ltr">{done.ref}</dd>
        </dl>
        <button type="button" className={s.ghostBtn} onClick={() => { setDone(null); setLine(''); setFeatured(null); setCustomFeat(''); setTried(false); }}>להזמנת מקום נוסף</button>
      </div>
    );
  }

  const branchSuggestions = opt ? suggestions[opt.branchId] ?? [] : [];

  return (
    <div className={s.builder}>
      <div className={s.builderMain}>
        <section className={s.step} aria-labelledby="sp-where">
          <div className={s.stepHead}>
            <span className={s.stepNo}>1</span>
            <h2 id="sp-where" className={s.stepTitle}>איפה להופיע</h2>
          </div>
          {GROUPS.map(g => {
            const list = options.filter(o => o.placement === g);
            if (!list.length) return null;
            return (
              <div key={g} className={s.group}>
                <div className={s.groupHead}>
                  <span className={s.groupName}>{PLACEMENT_NAME[g]}</span>
                  <span className={s.groupPrice}>{nis(g === 'homepage' ? homeNis : listNis)} לחודש</span>
                </div>
                <p className={s.groupHint}>{PLACEMENT_HINT[g]}</p>
                <div className={s.tiles} data-home={g === 'homepage' || undefined}>
                  {list.map(o => {
                    const on = o.pageKey === key;
                    const full = o.free <= 0;
                    return (
                      <button key={o.pageKey} type="button" className={s.tile} aria-pressed={on} disabled={full} onClick={() => setKey(o.pageKey)}>
                        <span className={s.tileTitle}>{o.title}</span>
                        <span className={s.tileMeta} data-tone={full ? 'full' : o.free <= 2 ? 'low' : 'ok'}>
                          <span className={s.slotsBar} aria-hidden="true"><span style={{ width: `${Math.round(((slots - o.free) / Math.max(1, slots)) * 100)}%` }} /></span>
                          {full ? 'תפוס' : freeSlotsHe(o.free)}
                        </span>
                        {options.length > 1 && new Set(options.map(x => x.branchId)).size > 1 ? <span className={s.tileBranch}>{o.branchName}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <section className={s.step} aria-labelledby="sp-what">
          <div className={s.stepHead}>
            <span className={s.stepNo}>2</span>
            <h2 id="sp-what" className={s.stepTitle}>מה יופיע בכרטיס</h2>
          </div>
          <label className={s.field}>
            <span className={s.label}>שורת הדגשה <span className={s.labelSoft}>· עד {SPONSORED_LINE_MAX} תווים</span></span>
            <input
              className={s.input} value={line} maxLength={SPONSORED_LINE_MAX} onChange={e => setLine(e.target.value)}
              placeholder="למשל: טיפולי פנים עם קוסמטיקאית מוסמכת, תורים גם בערב"
              data-state={flags.length ? 'warn' : tried && !lineOk ? 'bad' : undefined}
              aria-describedby="sp-line-count"
            />
            <span id="sp-line-count" className={`${s.count} ltr`} data-near={[...line].length > SPONSORED_LINE_MAX - 8 || undefined}>{[...line].length} / {SPONSORED_LINE_MAX}</span>
          </label>
          {flags.length > 0 && (
            <div role="alert" className={s.flags}>
              <strong>לא יאושר בבדיקה:</strong> {flags.map(f => f.text).join(' · ')}. בפרסום טיפולים אסור להבטיח תוצאה או לטעון לעליונות.
            </div>
          )}
          <p className={s.tips}>מה עובד: מה מיוחד אצלכם (שעות, חניה, מומחיות), במילים פשוטות. בלי סימני קריאה ובלי אותיות גדולות.</p>

          <span className={s.label}>טיפול להבליט על התמונה <span className={s.labelSoft}>· רשות</span></span>
          <div className={s.chips}>
            <button type="button" className={s.chip} aria-pressed={featured === null && !customFeat} onClick={() => { setFeatured(null); setCustomFeat(''); }}>בלי</button>
            {branchSuggestions.map(t => (
              <button key={t} type="button" className={s.chip} aria-pressed={featured === t} onClick={() => { setFeatured(t); setCustomFeat(''); }}>{t}</button>
            ))}
          </div>
          <input className={`${s.input} ${s.inputSm}`} value={customFeat} maxLength={40} onChange={e => { setCustomFeat(e.target.value); setFeatured(null); }} placeholder="או כתבו שם טיפול אחר" aria-label="טיפול אחר להבלטה" />
        </section>
      </div>

      <aside className={s.side}>
        <div className={s.sideCard}>
          <span className={s.sideLabel}>כך זה ייראה{opt ? ` · ${opt.title}` : ''}</span>
          <div className={s.previewFrame} inert>
            {preview ? <SponsoredCard c={preview} onOpen={() => {}} /> : <p className={s.groupHint}>בחרו עמוד כדי לראות את הכרטיס</p>}
          </div>
        </div>
        <div className={s.sideCard}>
          <dl className={s.sum}>
            <dt>{opt ? PLACEMENT_NAME[opt.placement] : 'מקום ממומן'}</dt>
            <dd className="ltr">{opt ? nis(opt.monthlyNis) : '—'}</dd>
            {free && <><dt className={s.sumGood}>החודש הראשון עלינו</dt><dd className={`${s.sumGood} ltr`}>−{opt ? nis(opt.monthlyNis) : ''}</dd></>}
            <dt className={s.sumTotal}>לתשלום היום</dt><dd className={`${s.sumTotal} ltr`}>₪0</dd>
          </dl>
          <p className={s.sumNote}>
            {free ? `אחרי החודש החינמי ${opt ? nis(opt.monthlyNis) : ''} לחודש` : `${opt ? nis(opt.monthlyNis) : ''} לחודש מרגע האישור`}, ללא מע״מ ישראלי. בלי התחייבות: ביטול בלחיצה, והכרטיס ממשיך עד סוף החודש ששולם.
          </p>
          {err && <p role="alert" className={s.err}>{err}</p>}
          <button type="button" className={s.primary} onClick={submit} disabled={pending}>
            {pending ? 'שולחים…' : hasCard ? 'שליחה לבדיקה' : 'שליחה לבדיקה ושמירת כרטיס'}
          </button>
          <p className={s.sumNote}>{hasCard ? 'החיוב על הכרטיס שכבר שמור אצלנו, רק אחרי האישור.' : 'בשלב הבא שומרים כרטיס בדף מאובטח של Stripe. לא יבוצע חיוב עד האישור.'}</p>
        </div>
      </aside>
    </div>
  );
}

export function CampaignActions({ id, phase }: { id: string; phase: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string; url?: string }>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const r = await fn();
      if (r.ok && r.url) { window.location.href = r.url; return; }
      setMsg(r.ok ? { ok: true, text: r.message ?? 'עודכן' } : { ok: false, text: r.error ?? 'משהו השתבש' });
      if (r.ok) router.refresh();
    });
  };
  return (
    <div className={s.rowActions}>
      {phase === 'needs_card' && <button type="button" className={s.primarySm} disabled={pending} onClick={() => run(() => saveCardAction(id))}>שמירת כרטיס והפעלה</button>}
      {phase === 'ending' && <button type="button" className={s.ghostBtn} disabled={pending} onClick={() => run(() => resumePlacementAction(id))}>המשך החידוש</button>}
      {phase === 'review' && <button type="button" className={s.ghostBtn} disabled={pending} onClick={() => run(() => cancelPlacementAction(id), 'לבטל את הבקשה? לא בוצע חיוב.')}>ביטול הבקשה</button>}
      {(phase === 'live' || phase === 'free_month' || phase === 'scheduled' || phase === 'needs_card') && (
        <button type="button" className={s.linkBtn} disabled={pending} onClick={() => run(() => cancelPlacementAction(id), 'לבטל את המקום הממומן? אם הוא כבר באוויר, הוא ימשיך עד סוף החודש ששולם ולא יתחדש.')}>ביטול</button>
      )}
      {msg && <span className={msg.ok ? s.ok : s.err}>{msg.text}</span>}
    </div>
  );
}
