'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { saveMenu } from '@/app/biz/menu/actions';
import { CATEGORIES, categoryBySlug } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { ActionBar } from '../../shell/ActionBar';
import { BottomSheet } from '../../shell/BottomSheet';
import { haptic } from '../../shell/haptics';
import { revealFirstInvalid, useShell } from '../media';
import { UNITS, unitLabel, validateMenu, type MenuRow, type RowErrors } from './shared';
import s from './MenuEditor.module.css';

const UNSORTED = 'טרם סווג';

/** 14.9.2026, in Israel time on server and client alike. */
function fmtDate(iso: string) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

function shownLine(live: number, total: number) {
  const head = live === 0 ? 'אין טיפולים מוצגים' : live === 1 ? 'טיפול אחד מוצג' : live === 2 ? 'שני טיפולים מוצגים' : null;
  return { head, live, total };
}

export function MenuEditor({
  initialRows,
  initialUpdatedAt,
  branchCats,
  canEdit,
}: {
  initialRows: MenuRow[];
  initialUpdatedAt: string;
  branchCats: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [base, setBase] = useState(initialRows);
  const [rows, setRows] = useState(initialRows);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // App shell: the menu is a list of rows; a row opens in an edit sheet (spec §6 Dashboard).
  const shell = useShell();
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [serverByKey, setServerByKey] = useState<Record<string, RowErrors>>({});
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const savedCats = useMemo(() => Object.fromEntries(base.flatMap(r => (r.id ? [[r.id, r.categorySlug]] : []))), [base]);
  const v = useMemo(() => validateMenu(rows, branchCats, savedCats), [rows, branchCats, savedCats]);
  const dirty = deleted.length > 0 || JSON.stringify(rows) !== JSON.stringify(base);
  const rowErr = (key: string): RowErrors => (tried ? { ...serverByKey[key], ...v.byKey[key] } : {});
  const ro = !canEdit;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Category chips: the branch's categories, plus any a saved treatment still carries.
  const catOptions = useMemo(() => {
    const slugs = new Set([...branchCats, ...rows.map(r => r.categorySlug).filter((c): c is string => !!c)]);
    return CATEGORIES.filter(c => slugs.has(c.slug));
  }, [branchCats, rows]);

  const touch = () => { setSaved(false); setServerErr(''); };
  const patchRow = (key: string, p: Partial<MenuRow>) => {
    if (ro) return;
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...p } : r)));
    touch();
  };
  const addRow = () => {
    if (ro) return;
    const key = `new-${++seq.current}`;
    setRows(prev => [...prev, {
      key, id: null, name: '', categorySlug: branchCats.length === 1 ? branchCats[0] : null,
      priceType: 'fixed', price: '', duration: '', isPublished: false,
    }]);
    if (shell) setSheetKey(key);
    else setOpenKey(key);
    setConfirmKey(null);
    touch();
    requestAnimationFrame(() => document.getElementById(`menu-name-${shell ? 'sheet-' : ''}${key}`)?.focus());
  };
  const removeRow = (r: MenuRow) => {
    if (ro) return;
    setRows(prev => prev.filter(x => x.key !== r.key));
    if (r.id) setDeleted(prev => [...prev, r.id!]);
    setOpenKey(null);
    setSheetKey(null);
    setConfirmKey(null);
    touch();
  };

  const focusFirstBad = (byKey: Record<string, RowErrors>) => {
    const first = rows.find(r => byKey[r.key]);
    if (!first) return;
    const e = byKey[first.key];
    haptic('warning');
    if (shell) {
      // The sheet holds every field of the row, the price included.
      setSheetKey(first.key);
      setTimeout(() => revealFirstInvalid(document.querySelector('[role="dialog"]')), 60);
      return;
    }
    if (e.name || e.duration || e.category) setOpenKey(first.key);
    requestAnimationFrame(() => revealFirstInvalid(listRef.current?.querySelector(`[data-row="${first.key}"]`)));
  };

  const save = () => {
    if (ro || pending) return;
    setTried(true);
    if (!v.ok) return focusFirstBad(v.byKey);
    const payload = { rows, deleted };
    startTransition(async () => {
      const res = await saveMenu(payload);
      if (res.ok) {
        setBase(res.rows);
        setRows(res.rows);
        setDeleted([]);
        setUpdatedAt(res.updatedAt);
        setOpenKey(null);
        setSheetKey(null);
        setTried(false);
        haptic('success');
        setServerByKey({});
        setSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 4000);
        router.refresh();
      } else {
        setServerErr(res.error);
        setServerByKey(res.byKey ?? {});
        if (res.byKey) focusFirstBad(res.byKey);
      }
    });
  };


  /** Row editor fields: inline under the row on desktop, inside the edit sheet in the app shell. */
  const editor = (r: MenuRow, at: 'list' | 'sheet') => {
    const cat = r.categorySlug ? categoryBySlug(r.categorySlug) : undefined;
    const e = rowErr(r.key);
    const editorId = `menu-${at}-${r.key}`;
    const close = () => (at === 'sheet' ? setSheetKey(null) : setOpenKey(null));
    return (
      <>
              <div className={s.editGrid}>
                <label className={s.field}>
                  <span className={s.label}>שם הטיפול</span>
                  <input
                    id={`menu-name-${at === 'sheet' ? 'sheet-' : ''}${r.key}`}
                    type="text"
                    value={r.name}
                    maxLength={120}
                    placeholder="למשל: הזרקת בוטוקס, אזור אחד"
                    aria-invalid={!!e.name || undefined}
                    onChange={ev => patchRow(r.key, { name: ev.target.value })}
                    className={s.input}
                  />
                  {e.name && <span className={s.err}>{e.name}</span>}
                </label>
                <label className={`${s.field} ${s.durField}`}>
                  <span className={s.label}>משך בדקות</span>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={3}
                    value={r.duration}
                    placeholder="45"
                    aria-invalid={!!e.duration || undefined}
                    onChange={ev => patchRow(r.key, { duration: ev.target.value.replace(/[^0-9]/g, '') })}
                    className={`${s.input} ${s.inputLtr}`}
                  />
                  {e.duration && <span className={s.err}>{e.duration}</span>}
                </label>
              </div>

              <div className={s.field} role="group" aria-labelledby={`${editorId}-cat`}>
                <span id={`${editorId}-cat`} className={s.label}>קטגוריה</span>
                <div className={s.chips}>
                  {catOptions.map(c => (
                    <button key={c.slug} type="button" aria-pressed={r.categorySlug === c.slug} onClick={() => patchRow(r.key, { categorySlug: c.slug })} className={s.chip} data-on={r.categorySlug === c.slug || undefined} aria-invalid={(r.categorySlug === c.slug && !!e.category) || undefined}>
                      {c.name}
                    </button>
                  ))}
                  <button type="button" aria-pressed={!r.categorySlug} onClick={() => patchRow(r.key, { categorySlug: null })} className={s.chip} data-on={!r.categorySlug || undefined}>
                    {UNSORTED}
                  </button>
                </div>
                {e.category && <span className={s.err}>{e.category}</span>}
                {catOptions.length === 0 && <span className={s.hint}>אין עדיין קטגוריות לעסק. בחרו אותן בעריכת הפרופיל.</span>}
              </div>

              <div className={s.field} role="group" aria-labelledby={`${editorId}-unit`}>
                <span id={`${editorId}-unit`} className={s.label}>המחיר הוא</span>
                <div className={s.chips}>
                  {UNITS.map(u => (
                    <button key={u.type} type="button" aria-pressed={r.priceType === u.type} onClick={() => patchRow(r.key, { priceType: u.type })} className={s.chip} data-on={r.priceType === u.type || undefined}>
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              {cat?.isMedical && (
                <p className={s.medNote}>
                  <strong>טיפול רפואי.</strong> מבוצע על ידי רופא/ה או אחות בפיקוח רופא/ה. לקוחות קובעים פגישת ייעוץ לפני הטיפול, ולכן אין לטיפול הזה קביעת תור אונליין ישירה.
                </p>
              )}

              <div className={s.editActions}>
                <button type="button" onClick={close} className={s.outlineBtn}>{at === 'sheet' ? 'סיום' : 'סגירה'}</button>
                {confirmKey === r.key ? (
                  <span className={s.confirm} role="group" aria-label="אישור הסרה">
                    <span className={s.confirmText}>להסיר את הטיפול מהתפריט? ההסרה תחול עם שמירת השינויים.</span>
                    <button type="button" onClick={() => removeRow(r)} className={s.dangerBtn}>הסרה</button>
                    <button type="button" onClick={() => setConfirmKey(null)} className={s.ghostBtn}>ביטול</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmKey(r.key)} className={s.ghostDanger}>הסרת הטיפול</button>
                )}
              </div>
    
      </>
    );
  };

  const live = rows.filter(r => r.isPublished).length;
  const sheetRow = sheetKey ? rows.find(r => r.key === sheetKey) ?? null : null;
  const line = shownLine(live, rows.length);

  return (
    <section aria-labelledby="h-menu" className={s.section}>
      <div className={s.head}>
        <div className={s.headText}>
          <h1 id="h-menu" className={s.h1}>תפריט מחירים<span>.</span></h1>
          <p className={s.sub}>מחירים בשקלים, לא כולל מע״מ, כפי שהם נגבים בפועל מלקוח חדש.</p>
        </div>
        {canEdit && dirty && (
          <div className={`${s.saveBar} bf-desk-only`}>
            <span role={serverErr || (tried && !v.ok) ? 'alert' : undefined} className={s.unsaved}>
              {serverErr || (tried && !v.ok ? 'יש טיפולים שדורשים תיקון' : 'יש שינויים שלא נשמרו')}
            </span>
            <button type="button" onClick={save} disabled={pending} aria-busy={pending || undefined} className={s.primaryBtn}>
              {pending ? 'שומר…' : 'שמירת השינויים'}
            </button>
          </div>
        )}
        {!dirty && saved && (
          <span role="status" className={s.savedChip}>
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#0B7A87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.8 7.6 6.6 11.4 15 3" />
            </svg>
            נשמר · עודכן היום
          </span>
        )}
      </div>

      <div className={`${s.table} bf-desk-only`} ref={listRef}>
        <div className={s.colsHead} aria-hidden="true">
          <span>טיפול</span><span>מחיר ₪</span><span>יחידה</span><span>מוצג</span>
        </div>

        {rows.length === 0 && (
          <p className={s.empty}>עדיין אין טיפולים בתפריט. הוסיפו טיפול ראשון עם מחיר, כדי שיופיע בפרופיל.</p>
        )}

        {rows.map(r => {
          const cat = r.categorySlug ? categoryBySlug(r.categorySlug) : undefined;
          const open = openKey === r.key && canEdit;
          const e = rowErr(r.key);
          const priceBad = (r.priceType !== 'on_request' && !r.price.trim()) || !!e.price;
          const label = r.name.trim() || 'טיפול חדש';
          const editorId = `menu-edit-${r.key}`;
          return (
            <div key={r.key} data-row={r.key} className={s.rowWrap} data-open={open || undefined}>
              <div className={s.row}>
                {canEdit ? (
                  <button
                    type="button"
                    className={s.nameBtn}
                    aria-expanded={open}
                    aria-controls={editorId}
                    onClick={() => { setOpenKey(open ? null : r.key); setConfirmKey(null); }}
                  >
                    <NameCell name={r.name} catName={cat?.name} medical={!!cat?.isMedical} bad={!!(e.name || e.category || e.duration)} edit />
                  </button>
                ) : (
                  <div className={s.nameStatic}>
                    <NameCell name={r.name} catName={cat?.name} medical={!!cat?.isMedical} />
                  </div>
                )}
                <label className={s.priceCell}>
                  <span className="sr-only">מחיר בשקלים עבור {label}, לא כולל מע״מ</span>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={7}
                    value={r.price}
                    disabled={ro}
                    aria-invalid={(tried && priceBad) || undefined}
                    data-empty={!r.price.trim() || undefined}
                    onChange={ev => patchRow(r.key, { price: ev.target.value.replace(/[^0-9]/g, '') })}
                    className={s.price}
                  />
                </label>
                <span className={s.unit}>{unitLabel(r.priceType)}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.isPublished}
                  aria-label={`הצגה בפרופיל: ${label}`}
                  disabled={ro}
                  onClick={() => patchRow(r.key, { isPublished: !r.isPublished })}
                  className={s.live}
                  data-on={r.isPublished || undefined}
                >
                  {r.isPublished ? 'מוצג' : 'מוסתר'}
                </button>
              </div>
              {tried && e.price && <p className={s.rowErr}>{e.price}</p>}

              {open && (
                <div id={editorId} className={s.editor}>
                  {editor(r, 'list')}
                </div>
              )}
            </div>
          );
        })}

        <div className={s.foot}>
          {canEdit && (
            <button type="button" onClick={addRow} className={s.addBtn}>
              <span aria-hidden="true" className={s.plus}>+</span>הוספת טיפול
            </button>
          )}
          <span className={s.footLine}>
            {line.head ?? <><span className="ltr">{line.live}</span> טיפולים מוצגים</>} מתוך <span className="ltr">{line.total}</span>
            {updatedAt && <> · עודכן לאחרונה <span className="ltr">{fmtDate(updatedAt)}</span></>}
            {' · '}המחירים לא כוללים מע״מ
          </span>
        </div>
      </div>

      <div className={`${s.mList} bf-shell-only`}>
        {rows.length === 0 ? (
          <p className={s.empty}>עדיין אין טיפולים בתפריט. הוסיפו טיפול ראשון עם מחיר, כדי שיופיע בפרופיל.</p>
        ) : (
          <ul className={s.rowList}>
            {rows.map(r => {
              const cat = r.categorySlug ? categoryBySlug(r.categorySlug) : undefined;
              const bad = Object.keys(rowErr(r.key)).length > 0;
              const inner = (
                <>
                  <span className={s.mText}>
                    <span className={s.name} data-placeholder={!r.name.trim() || undefined}>{r.name.trim() || 'טיפול חדש'}</span>
                    <span className={s.cat}>
                      {cat?.name ?? UNSORTED}
                      {bad && <span className={s.editHint} data-bad>דורש תיקון</span>}
                    </span>
                  </span>
                  <span className={s.mEnd}>
                    <span className={s.mPrice}>
                      {r.price.trim() ? <span className="ltr">{nis(Number(r.price))}</span> : <span className={s.mNoPrice}>אין מחיר</span>}
                      <span className={s.mUnit}>{unitLabel(r.priceType)}</span>
                    </span>
                    <span className={s.mLive} data-on={r.isPublished || undefined}>{r.isPublished ? 'מוצג' : 'מוסתר'}</span>
                  </span>
                </>
              );
              return (
                <li key={r.key}>
                  {canEdit ? (
                    <button type="button" className={s.mRow} onClick={() => { setSheetKey(r.key); setConfirmKey(null); }} data-bad={bad || undefined}>
                      {inner}
                    </button>
                  ) : (
                    <div className={s.mRow}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className={s.foot}>
          {canEdit && (
            <button type="button" onClick={addRow} className={s.addBtn}>
              <span aria-hidden="true" className={s.plus}>+</span>הוספת טיפול
            </button>
          )}
          <span className={s.footLine}>
            {line.head ?? <><span className="ltr">{line.live}</span> טיפולים מוצגים</>} מתוך <span className="ltr">{line.total}</span>
            {updatedAt && <> · עודכן <span className="ltr">{fmtDate(updatedAt)}</span></>}
          </span>
        </div>
      </div>

      {canEdit && (
        <BottomSheet open={shell && !!sheetRow} onClose={() => { setSheetKey(null); setConfirmKey(null); }} title={sheetRow?.name.trim() || 'טיפול חדש'} size="full">
          {sheetRow && (
            <div className={s.sheetEditor}>
              <div className={s.sheetTop}>
                <label className={`${s.field} ${s.sheetPrice}`}>
                  <span className={s.label}>מחיר בשקלים, לא כולל מע״מ</span>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={7}
                    value={sheetRow.price}
                    aria-invalid={(tried && ((sheetRow.priceType !== 'on_request' && !sheetRow.price.trim()) || !!rowErr(sheetRow.key).price)) || undefined}
                    onChange={ev => patchRow(sheetRow.key, { price: ev.target.value.replace(/[^0-9]/g, '') })}
                    className={`${s.input} ${s.inputLtr}`}
                  />
                  {tried && rowErr(sheetRow.key).price && <span className={s.err}>{rowErr(sheetRow.key).price}</span>}
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sheetRow.isPublished}
                  onClick={() => { haptic('light'); patchRow(sheetRow.key, { isPublished: !sheetRow.isPublished }); }}
                  className={s.live}
                  data-on={sheetRow.isPublished || undefined}
                >
                  {sheetRow.isPublished ? 'מוצג בפרופיל' : 'מוסתר'}
                </button>
              </div>
              {editor(sheetRow, 'sheet')}
            </div>
          )}
        </BottomSheet>
      )}

      {canEdit && dirty && (
        <ActionBar
          mobileOnly
          error={serverErr || (tried && !v.ok ? 'יש טיפולים שדורשים תיקון' : undefined)}
          hint={serverErr || (tried && !v.ok) ? undefined : 'יש שינויים שלא נשמרו'}
        >
          <button type="button" onClick={save} disabled={pending} aria-busy={pending || undefined} className={s.primaryBtn}>
            {pending ? 'שומר…' : 'שמירת השינויים'}
          </button>
        </ActionBar>
      )}

      <div className={s.note}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="10" r="7.6" />
          <path d="M10 6.2v.2M10 9v4.6" />
        </svg>
        <p>
          <strong>למה זה חשוב.</strong> לקוחות משווים מחירים לפני שהם פונים, ומחיר גלוי לכל טיפול חוסך שאלות ומגדיל את הסיכוי שיבחרו בכם. פער חוזר בין המחיר כאן למחיר בקליניקה הוא הסיבה השכיחה ביותר לאזהרה לפי תקן הרישום.
        </p>
      </div>
    </section>
  );
}

function NameCell({ name, catName, medical, bad, edit }: { name: string; catName?: string; medical: boolean; bad?: boolean; edit?: boolean }) {
  return (
    <>
      <span className={s.name} data-placeholder={!name.trim() || undefined}>{name.trim() || 'טיפול חדש'}</span>
      <span className={s.cat}>
        {catName ?? UNSORTED}
        {medical && <span className={s.medTag}>טיפול רפואי · בתיאום ייעוץ</span>}
        {edit && <span className={s.editHint} data-bad={bad || undefined}>{bad ? 'דורש תיקון' : 'עריכה'}</span>}
      </span>
    </>
  );
}
