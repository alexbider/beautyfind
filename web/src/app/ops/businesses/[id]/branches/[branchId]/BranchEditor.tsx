'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { ImageDrop } from '@/components/dashboard/profile/ImageDrop';
import { Chip, ui } from '@/components/ops/ui';
import { CATEGORIES, CITIES, REGIONS } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME } from '@/lib/import/coverage';
import { STEP_NAME } from '@/lib/import/enrichPlan';
import type { BranchEdit, ContentForm, DetailsForm, FactsForm, MediaForm, TreatmentRow } from '../../../branchEdit';
import { enhanceBranchesAction, type EnhanceMode } from '../../../actions';
import { saveContentAction, saveDetailsAction, saveFactsAction, saveMediaAction, saveTreatmentsAction, type SaveResult } from './actions';
import s from './editor.module.css';

// The admin branch editor: every field of a listing in six sections, each saved on its own. Staff
// edits are the listing's truth from then on; the AI completion only fills what is still empty.

const TABS = [['details', 'פרטים'], ['content', 'תוכן'], ['media', 'מדיה'], ['facts', 'עובדות ורשתות'], ['treatments', 'טיפולים ומחירים'], ['ai', 'השלמה ב־AI']] as const;
type Tab = (typeof TABS)[number][0];
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const PROFESSION: Record<string, string> = { doctor: 'רופא/ה', nurse: 'אח/ות', cosmetician: 'קוסמטיקאי/ת', technician: 'טכנאי/ת', front: 'קבלה', management: 'ניהול' };
const PRICE_TYPE_NAME: Record<string, string> = { fixed: 'לטיפול', from: 'החל מ־', per_unit: 'למפגש', per_ml: 'למ״ל', per_area: 'לאזור', range: 'טווח', package: 'לחבילה', free: 'חינם', on_request: 'לפי הצעת מחיר' };
const FILLED: Record<string, string> = { phone: 'טלפון', whatsapp: 'וואטסאפ', email: 'דוא״ל', website: 'אתר', instagram: 'אינסטגרם', hours: 'שעות', description: 'תיאור', faqs: 'שאלות', accessible: 'נגישות', parking: 'חניה', waze: 'Waze', google_profile: 'פרופיל Google', rating: 'דירוג', logo: 'לוגו', cover: 'שער', gallery: 'גלריה', categories: 'תחומים', services: 'טיפולים', prices: 'מחירים', videos: 'סרטונים', languages: 'שפות', established: 'שנת הקמה', facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב', video_posters: 'תמונות סרטונים', images_waiting_for_storage: 'תמונות מחכות להעתקה' };

function useSave<T>(action: (v: T) => Promise<SaveResult>) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const save = (v: T) =>
    start(async () => {
      const r = await action(v);
      setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
      setFields(r.ok ? {} : r.fields ?? {});
      if (r.ok) router.refresh();
    });
  return { save, msg, fields, pending };
}

function Field({ label, error, children, hint, className }: { label: string; error?: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={`${ui.field} ${className ?? ''}`}>
      <label className={ui.label}>{label}</label>
      {children}
      {error ? <span className={ui.error}>{error}</span> : hint ? <span className={ui.hint}>{hint}</span> : null}
    </div>
  );
}

function SaveBar({ pending, msg, canEdit, label = 'שמירה' }: { pending: boolean; msg: { ok: boolean; text: string } | null; canEdit: boolean; label?: string }) {
  if (!canEdit) return <p className={ui.hint}>צפייה בלבד: לתפקיד שלך אין הרשאת עריכה בעסקים.</p>;
  return (
    <div className={s.saveBar}>
      <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>{pending ? 'שומר…' : label}</button>
      {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
    </div>
  );
}

export function BranchEditor({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>('details');
  return (
    <div>
      <div className={ui.tabs} role="tablist" aria-label="חלקי הפרופיל">
        {TABS.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={tab === k} aria-current={tab === k ? 'page' : undefined} className={ui.tab} onClick={() => setTab(k)} style={{ border: 0, background: tab === k ? '#fff' : 'transparent', cursor: 'pointer' }}>{name}</button>)}
      </div>
      {tab === 'details' ? <DetailsSection data={data} canEdit={canEdit} /> : null}
      {tab === 'content' ? <ContentSection data={data} canEdit={canEdit} /> : null}
      {tab === 'media' ? <MediaSection data={data} canEdit={canEdit} /> : null}
      {tab === 'facts' ? <FactsSection data={data} canEdit={canEdit} /> : null}
      {tab === 'treatments' ? <TreatmentsSection data={data} canEdit={canEdit} /> : null}
      {tab === 'ai' ? <AiSection data={data} canEdit={canEdit} /> : null}
    </div>
  );
}

// ---------- details ----------

function DetailsSection({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  const [f, setF] = useState<DetailsForm>(data.details);
  const { save, msg, fields, pending } = useSave((v: DetailsForm) => saveDetailsAction(data.id, v));
  const set = (p: Partial<DetailsForm>) => setF(prev => ({ ...prev, ...p }));
  const ro = !canEdit;
  const setHour = (i: number, p: Partial<DetailsForm['hours'][number]>) => set({ hours: f.hours.map((h, n) => (n === i ? { ...h, ...p } : h)) });
  const cities = CITIES.filter(c => c.region === f.regionSlug);
  return (
    <form className={`${ui.card} ${ui.cardPad}`} onSubmit={e => { e.preventDefault(); save(f); }}>
      <div className={`${s.grid} ${s.grid3}`}>
        <Field label="שם הסניף" error={fields.name}><input className={ui.input} value={f.name} disabled={ro} maxLength={120} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="כתובת URL (slug)" error={fields.slug} hint={data.publicHref ? <a href={data.publicHref} target="_blank" rel="noreferrer" className={ui.rowLink}>{data.publicHref}</a> : 'הפרופיל יהיה ב־/אזור/קטגוריה/slug'}><input className={ui.input} dir="ltr" value={f.slug} disabled={ro} maxLength={120} onChange={e => set({ slug: e.target.value })} /></Field>
        <Field label="מצב הסניף">
          <select className={ui.select} value={f.status} disabled={ro} onChange={e => set({ status: e.target.value as DetailsForm['status'] })}>
            <option value="draft">טיוטה</option><option value="live">חי (מפורסם)</option><option value="unpublished">לא מפורסם</option>
          </select>
        </Field>
        <Field label="אזור"><select className={ui.select} value={f.regionSlug} disabled={ro} onChange={e => set({ regionSlug: e.target.value })}>{REGIONS.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select></Field>
        <Field label="עיר" error={fields.cityName} hint="עיר מהקטלוג מקבלת עמוד עיר; טקסט חופשי נשמר כפי שהוא">
          <input className={ui.input} list="city-list" value={f.cityName} disabled={ro} maxLength={80} onChange={e => set({ cityName: e.target.value })} />
          <datalist id="city-list">{cities.map(c => <option key={c.slug} value={c.name} />)}</datalist>
        </Field>
        <Field label="כתובת" error={fields.address}><input className={ui.input} value={f.address} disabled={ro} maxLength={200} onChange={e => set({ address: e.target.value })} /></Field>
        <Field label="קו רוחב (lat)" error={fields.lat}><input className={ui.input} dir="ltr" inputMode="decimal" value={f.lat} disabled={ro} onChange={e => set({ lat: e.target.value })} placeholder="32.0853" /></Field>
        <Field label="קו אורך (lng)"><input className={ui.input} dir="ltr" inputMode="decimal" value={f.lng} disabled={ro} onChange={e => set({ lng: e.target.value })} placeholder="34.7818" /></Field>
        <Field label="מזהה Google Place"><input className={ui.input} dir="ltr" value={f.googlePlaceId} disabled={ro} maxLength={200} onChange={e => set({ googlePlaceId: e.target.value })} /></Field>
        <Field label="טלפון" error={fields.phone}><input className={ui.input} dir="ltr" type="tel" value={f.phone} disabled={ro} onChange={e => set({ phone: e.target.value })} /></Field>
        <Field label="WhatsApp" error={fields.whatsapp}><input className={ui.input} dir="ltr" type="tel" value={f.whatsapp} disabled={ro} onChange={e => set({ whatsapp: e.target.value })} /></Field>
        <Field label="דוא״ל" error={fields.email}><input className={ui.input} dir="ltr" type="email" value={f.email} disabled={ro} onChange={e => set({ email: e.target.value })} /></Field>
        <Field label="אתר" error={fields.websiteUrl}><input className={ui.input} dir="ltr" value={f.websiteUrl} disabled={ro} maxLength={500} onChange={e => set({ websiteUrl: e.target.value })} placeholder="https://" /></Field>
        <Field label="קישור Waze" error={fields.wazeUrl}><input className={ui.input} dir="ltr" value={f.wazeUrl} disabled={ro} maxLength={500} onChange={e => set({ wazeUrl: e.target.value })} /></Field>
        <Field label="פרופיל Google (קישור)" error={fields.googlePlaceUrl}><input className={ui.input} dir="ltr" value={f.googlePlaceUrl} disabled={ro} maxLength={500} onChange={e => set({ googlePlaceUrl: e.target.value })} /></Field>
        <Field label="אחראי/ת רפואי/ת" error={fields.medicalResponsibleId} hint="מתוך צוות העסק; רישיון מאומת נדרש לקטגוריה רפואית">
          <select className={ui.select} value={f.medicalResponsibleId} disabled={ro} onChange={e => set({ medicalResponsibleId: e.target.value })}>
            <option value="">ללא</option>
            {data.staff.map(st => <option key={st.id} value={st.id}>{st.name} · {PROFESSION[st.profession] ?? st.profession}{st.verified ? ' · מאומת' : ''}</option>)}
          </select>
        </Field>
        <div className={`${ui.field} ${s.span}`}>
          <span className={ui.label}>קטגוריות (לחיצה כפולה קובעת ראשית)</span>
          <div className={s.chips}>
            {CATEGORIES.map(c => {
              const on = f.cats.includes(c.slug);
              return <button key={c.slug} type="button" className={s.chip} data-on={on} data-primary={f.primaryCat === c.slug} disabled={ro} aria-pressed={on} onClick={() => set({ cats: on ? f.cats.filter(x => x !== c.slug) : [...f.cats, c.slug], primaryCat: on && f.primaryCat === c.slug ? '' : f.primaryCat || c.slug })} onDoubleClick={() => on && set({ primaryCat: c.slug })}>{c.name}</button>;
            })}
          </div>
          {fields.cats ? <span className={ui.error}>{fields.cats}</span> : <span className={ui.hint}>ראשית: {CATEGORIES.find(c => c.slug === f.primaryCat)?.name ?? 'הראשונה שנבחרה'}</span>}
        </div>
        <div className={`${ui.field} ${s.span}`}>
          <span className={ui.label}>שעות פעילות</span>
          {fields.hours ? <span className={ui.error}>{fields.hours}</span> : null}
          <div className={s.hours}>
            {f.hours.map((h, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <span className={ui.strong}>{DAYS[i]}</span>
                <div className={s.hourRow}>
                  <label className={s.check}><input type="checkbox" checked={h.unknown} disabled={ro} onChange={e => setHour(i, { unknown: e.target.checked, closed: false })} /> לא ידוע</label>
                  <label className={s.check}><input type="checkbox" checked={h.closed} disabled={ro || h.unknown} onChange={e => setHour(i, { closed: e.target.checked })} /> סגור</label>
                  <input className={ui.input} type="time" value={h.open} disabled={ro || h.unknown || h.closed} onChange={e => setHour(i, { open: e.target.value })} aria-label={`פתיחה ${DAYS[i]}`} />
                  <input className={ui.input} type="time" value={h.close} disabled={ro || h.unknown || h.closed} onChange={e => setHour(i, { close: e.target.value })} aria-label={`סגירה ${DAYS[i]}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={`${s.span} ${s.chips}`}>
          <label className={s.check}><input type="checkbox" checked={f.accessible} disabled={ro} onChange={e => set({ accessible: e.target.checked })} /> נגיש לכיסא גלגלים</label>
          <label className={s.check}><input type="checkbox" checked={f.freeParking} disabled={ro} onChange={e => set({ freeParking: e.target.checked })} /> חניה חינם</label>
          <label className={s.check}><input type="checkbox" checked={f.onlineBooking} disabled={ro} onChange={e => set({ onlineBooking: e.target.checked })} /> קביעת תור אונליין</label>
          <label className={s.check}><input type="checkbox" checked={f.isClaimed} disabled={ro} onChange={e => set({ isClaimed: e.target.checked })} /> בבעלות מאומתת (ההשלמה האוטומטית לא נוגעת)</label>
        </div>
      </div>
      <SaveBar pending={pending} msg={msg} canEdit={canEdit} />
    </form>
  );
}

// ---------- content ----------

function ContentSection({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  const [f, setF] = useState<ContentForm>(data.content);
  const { save, msg, fields, pending } = useSave((v: ContentForm) => saveContentAction(data.id, v));
  const set = (p: Partial<ContentForm>) => setF(prev => ({ ...prev, ...p }));
  const ro = !canEdit;
  const words = f.description.trim() ? f.description.trim().split(/\s+/).length : 0;
  return (
    <form className={`${ui.card} ${ui.cardPad}`} onSubmit={e => { e.preventDefault(); save(f); }}>
      <div className={s.grid}>
        <Field label="כותרת הסעיף" hint="למשל ״על הקליניקה״; ריק = ״על העסק״"><input className={ui.input} value={f.editorialHeading} disabled={ro} maxLength={40} onChange={e => set({ editorialHeading: e.target.value })} /></Field>
        <div className={ui.field}>
          <label className={s.check} style={{ marginTop: 28 }}><input type="checkbox" checked={f.ownerApproved} disabled={ro} onChange={e => set({ ownerApproved: e.target.checked })} /> טקסט מאושר: הכותב האוטומטי לא יחליף אותו</label>
          {data.editorialInfo ? <span className={ui.hint}>הטיוטה האחרונה: {data.editorialInfo.words} מילים · {data.editorialInfo.model} · {new Date(data.editorialInfo.generatedAt).toLocaleDateString('he-IL')}</span> : null}
        </div>
        <Field label={`תיאור (${words} מילים)`} className={s.span} hint="450 עד 550 מילים בפרופיל מלא; ריק = הסעיף לא מוצג"><textarea className={ui.textarea} style={{ minHeight: 220 }} value={f.description} disabled={ro} maxLength={6000} onChange={e => set({ description: e.target.value })} /></Field>
        <Field label="כותרת SEO (meta title)" hint={`${f.metaTitle.length}/70`}><input className={ui.input} value={f.metaTitle} disabled={ro} maxLength={120} onChange={e => set({ metaTitle: e.target.value })} /></Field>
        <Field label="תיאור SEO (meta description)" hint={`${f.metaDescription.length}/170`}><input className={ui.input} value={f.metaDescription} disabled={ro} maxLength={320} onChange={e => set({ metaDescription: e.target.value })} /></Field>
        <div className={`${ui.field} ${s.span}`}>
          <span className={ui.label}>שאלות נפוצות ({f.faqs.length})</span>
          {fields.faqs ? <span className={ui.error}>{fields.faqs}</span> : null}
          {f.faqs.map((q, i) => (
            <div key={i} className={`${s.row} ${s.rowFaq}`}>
              <input className={ui.input} value={q.q} disabled={ro} maxLength={300} placeholder="שאלה" onChange={e => set({ faqs: f.faqs.map((x, n) => (n === i ? { ...x, q: e.target.value } : x)) })} />
              <textarea className={ui.textarea} style={{ minHeight: 60 }} value={q.a} disabled={ro} maxLength={2000} placeholder="תשובה" onChange={e => set({ faqs: f.faqs.map((x, n) => (n === i ? { ...x, a: e.target.value } : x)) })} />
              {!ro ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} onClick={() => set({ faqs: f.faqs.filter((_, n) => n !== i) })}>הסרה</button> : null}
            </div>
          ))}
          {!ro && f.faqs.length < 12 ? <div><button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => set({ faqs: [...f.faqs, { q: '', a: '' }] })}>הוספת שאלה</button></div> : null}
        </div>
      </div>
      <SaveBar pending={pending} msg={msg} canEdit={canEdit} />
    </form>
  );
}

// ---------- media ----------

function MediaSection({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  const [f, setF] = useState<MediaForm>(data.media);
  const [busy, setBusy] = useState(0);
  const [ytInput, setYt] = useState('');
  const { save, msg, fields, pending } = useSave((v: MediaForm) => saveMediaAction(data.id, v));
  const set = (p: Partial<MediaForm>) => setF(prev => ({ ...prev, ...p }));
  const ro = !canEdit;
  const up = { uploadUrl: '/ops/businesses/upload', uploadFields: { businessId: data.businessId }, onBusy: (b: boolean) => setBusy(n => Math.max(0, n + (b ? 1 : -1))) };
  const addVideo = () => {
    const m = ytInput.trim().match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/) ?? ytInput.trim().match(/^([A-Za-z0-9_-]{11})$/);
    if (!m) return;
    if (!f.videos.some(v => v.id === m[1])) set({ videos: [...f.videos, { id: m[1], title: '', status: 'ok', source: 'owner' }] });
    setYt('');
  };
  return (
    <form className={`${ui.card} ${ui.cardPad}`} onSubmit={e => { e.preventDefault(); save(f); }}>
      <div className={s.media}>
        <div className={ui.stack}>
          <ImageDrop label="תמונת שער" placeholder="תמונת שער (16:9)" url={f.coverUrl} alt={f.coverAlt} frameClass={s.frameCover} disabled={ro} onUploaded={url => set({ coverUrl: url })} onRemove={() => set({ coverUrl: '', coverAlt: '' })} {...up} />
          <Field label="תיאור נגישות לשער" error={fields.coverAlt}><input className={ui.input} value={f.coverAlt} disabled={ro || !f.coverUrl} maxLength={200} onChange={e => set({ coverAlt: e.target.value })} /></Field>
        </div>
        <div className={ui.stack}>
          <ImageDrop label="לוגו" placeholder="לוגו" url={f.logoUrl} alt="לוגו" fit="contain" frameClass={s.frameLogo} disabled={ro} onUploaded={url => set({ logoUrl: url })} onRemove={() => set({ logoUrl: '' })} {...up} />
        </div>
      </div>
      <div className={ui.field} style={{ marginTop: 16 }}>
        <span className={ui.label}>גלריה ({f.gallery.length})</span>
        {fields.gallery ? <span className={ui.error}>{fields.gallery}</span> : null}
        <div className={s.gallery}>
          {f.gallery.map((g, i) => (
            <div key={g.url} className={s.galItem}>
              <ImageDrop label={`תמונה ${i + 1}`} placeholder="" url={g.url} alt={g.alt} frameClass={s.frameGal} disabled={ro} onUploaded={url => set({ gallery: f.gallery.map((x, n) => (n === i ? { ...x, url } : x)) })} onRemove={() => set({ gallery: f.gallery.filter((_, n) => n !== i) })} {...up} />
              <input className={ui.input} value={g.alt} disabled={ro} maxLength={200} placeholder="תיאור התמונה" onChange={e => set({ gallery: f.gallery.map((x, n) => (n === i ? { ...x, alt: e.target.value } : x)) })} />
              <select className={ui.select} value={g.tag} disabled={ro} onChange={e => set({ gallery: f.gallery.map((x, n) => (n === i ? { ...x, tag: e.target.value } : x)) })}>
                <option value="">ללא תגית</option><option value="הקליניקה">הקליניקה</option><option value="צוות">צוות</option><option value="לפני/אחרי">לפני/אחרי</option>
              </select>
            </div>
          ))}
          {!ro && f.gallery.length < 24 ? (
            <div className={s.galItem}>
              <ImageDrop label="תמונה חדשה" placeholder="הוספת תמונה" url="" alt="" frameClass={s.frameGal} disabled={ro} onUploaded={url => set({ gallery: [...f.gallery, { url, alt: '', tag: '' }] })} {...up} />
            </div>
          ) : null}
        </div>
      </div>
      <div className={ui.field} style={{ marginTop: 16 }}>
        <span className={ui.label}>סרטוני YouTube ({f.videos.length})</span>
        {fields.videos ? <span className={ui.error}>{fields.videos}</span> : null}
        {f.videos.map((v, i) => (
          <div key={v.id} className={s.row} style={{ gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center' }}>
            <span className={ui.mono} dir="ltr">{v.id}</span>
            <input className={ui.input} value={v.title} disabled={ro} maxLength={200} placeholder="כותרת (לא חובה)" onChange={e => set({ videos: f.videos.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)) })} />
            <Chip tone={v.status === 'ok' ? 'ok' : 'warn'}>{v.status === 'ok' ? 'תקין' : v.status}</Chip>
            {!ro ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} onClick={() => set({ videos: f.videos.filter((_, n) => n !== i) })}>הסרה</button> : null}
          </div>
        ))}
        {!ro ? <div className={ui.inlineForm}><input className={ui.input} dir="ltr" value={ytInput} onChange={e => setYt(e.target.value)} placeholder="קישור או מזהה YouTube" style={{ maxWidth: 360 }} /><button type="button" className={`${ui.btn} ${ui.small}`} onClick={addVideo}>הוספה</button></div> : null}
      </div>
      <SaveBar pending={pending || busy > 0} msg={msg} canEdit={canEdit} label={busy > 0 ? 'ממתין להעלאה…' : 'שמירה'} />
    </form>
  );
}

// ---------- facts ----------

function FactsSection({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  const [f, setF] = useState<FactsForm>(data.facts);
  const { save, msg, fields, pending } = useSave((v: FactsForm) => saveFactsAction(data.id, v));
  const set = (p: Partial<FactsForm>) => setF(prev => ({ ...prev, ...p }));
  const ro = !canEdit;
  const tri = (k: 'accessibleKnown' | 'parkingKnown', label: string) => (
    <Field label={label}><select className={ui.select} value={f[k]} disabled={ro} onChange={e => set({ [k]: e.target.value } as Partial<FactsForm>)}><option value="unknown">לא ידוע (לא מוצג)</option><option value="yes">כן</option><option value="no">לא</option></select></Field>
  );
  return (
    <form className={`${ui.card} ${ui.cardPad}`} onSubmit={e => { e.preventDefault(); save(f); }}>
      <div className={`${s.grid} ${s.grid3}`}>
        <Field label="אינסטגרם (שם משתמש)" error={fields.instagram}><input className={ui.input} dir="ltr" value={f.instagram} disabled={ro} maxLength={60} onChange={e => set({ instagram: e.target.value })} /></Field>
        <Field label="פייסבוק (קישור)" error={fields.facebook}><input className={ui.input} dir="ltr" value={f.facebook} disabled={ro} maxLength={300} onChange={e => set({ facebook: e.target.value })} /></Field>
        <Field label="טיקטוק (קישור)" error={fields.tiktok}><input className={ui.input} dir="ltr" value={f.tiktok} disabled={ro} maxLength={300} onChange={e => set({ tiktok: e.target.value })} /></Field>
        <Field label="ערוץ YouTube (קישור)" error={fields.youtube}><input className={ui.input} dir="ltr" value={f.youtube} disabled={ro} maxLength={300} onChange={e => set({ youtube: e.target.value })} /></Field>
        <Field label="שנת הקמה" error={fields.establishedYear}><input className={ui.input} dir="ltr" inputMode="numeric" value={f.establishedYear} disabled={ro} maxLength={4} onChange={e => set({ establishedYear: e.target.value })} /></Field>
        <Field label="גודל צוות" error={fields.teamSize}><input className={ui.input} dir="ltr" inputMode="numeric" value={f.teamSize} disabled={ro} maxLength={4} onChange={e => set({ teamSize: e.target.value })} /></Field>
        <Field label="שפות (מופרדות בפסיק)"><input className={ui.input} value={f.languages} disabled={ro} maxLength={200} onChange={e => set({ languages: e.target.value })} placeholder="עברית, אנגלית, רוסית" /></Field>
        {tri('accessibleKnown', 'נגישות')}
        {tri('parkingKnown', 'חניה חינם')}
        <div className={`${ui.field} ${s.span}`}>
          <span className={ui.label}>אנשי צוות שצוינו באתר העסק ({f.team.length})</span>
          <span className={ui.hint}>מוצגים בפרופיל כעובדה מהאתר, בלי קישור או תג. צוות מאומת מתווסף על ידי הבעלים.</span>
          {f.team.map((t, i) => (
            <div key={i} className={`${s.row} ${s.rowTeam}`}>
              <input className={ui.input} value={t.name} disabled={ro} maxLength={80} placeholder="שם" onChange={e => set({ team: f.team.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)) })} />
              <input className={ui.input} value={t.role} disabled={ro} maxLength={80} placeholder="תפקיד" onChange={e => set({ team: f.team.map((x, n) => (n === i ? { ...x, role: e.target.value } : x)) })} />
              <input className={ui.input} value={t.bio} disabled={ro} maxLength={400} placeholder="שורה על האדם" onChange={e => set({ team: f.team.map((x, n) => (n === i ? { ...x, bio: e.target.value } : x)) })} />
              <input className={ui.input} dir="ltr" value={t.sourceUrl} disabled={ro} maxLength={400} placeholder="מקור (קישור)" onChange={e => set({ team: f.team.map((x, n) => (n === i ? { ...x, sourceUrl: e.target.value } : x)) })} />
              {!ro ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} onClick={() => set({ team: f.team.filter((_, n) => n !== i) })}>הסרה</button> : null}
            </div>
          ))}
          {!ro && f.team.length < 30 ? <div><button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => set({ team: [...f.team, { name: '', role: '', bio: '', sourceUrl: '' }] })}>הוספת איש צוות</button></div> : null}
        </div>
      </div>
      <SaveBar pending={pending} msg={msg} canEdit={canEdit} />
    </form>
  );
}

// ---------- treatments ----------

function TreatmentsSection({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  const [rows, setRows] = useState<TreatmentRow[]>(data.treatments);
  const [deleted, setDeleted] = useState<string[]>([]);
  const { save, msg, fields, pending } = useSave((v: { rows: TreatmentRow[]; deleted: string[] }) => saveTreatmentsAction(data.id, v));
  const ro = !canEdit;
  const upd = (key: string, p: Partial<TreatmentRow>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));
  const remove = (r: TreatmentRow) => { setRows(rs => rs.filter(x => x.key !== r.key)); if (r.id) setDeleted(d => [...d, r.id!]); };
  const add = () => setRows(rs => [...rs, { key: `new-${Date.now()}-${rs.length}`, id: null, name: '', description: '', categorySlug: data.details.cats[0] ?? '', priceType: 'fixed', price: '', priceMax: '', priceNote: '', duration: '', isPublished: true, isMedical: false, requiresDeclaration: false, onlineBookable: true, taxIncluded: 'unknown', source: '' }]);
  const move = (i: number, d: -1 | 1) => setRows(rs => { const n = [...rs]; const j = i + d; if (j < 0 || j >= n.length) return rs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <form className={`${ui.card} ${ui.cardPad}`} onSubmit={e => { e.preventDefault(); save({ rows, deleted }); }}>
      <p className={ui.hint} style={{ marginBottom: 10 }}>מחיר בשקלים שלמים. ״לפי הצעת מחיר״ ו״חינם״ בלי מחיר. טיפול רפואי לא נקבע אונליין (עובר דרך ייעוץ). מקור ״owner״ = הוזן ידנית; ״website״ = נקרא מאתר העסק.</p>
      <div className={s.tblWrap}>
        <table className={s.tbl}>
          <thead><tr><th>#</th><th>שם</th><th>קטגוריה</th><th>סוג מחיר</th><th>מחיר</th><th>עד</th><th>הערת מחיר</th><th>דקות</th><th>מפורסם</th><th>רפואי</th><th>הצהרה</th><th>אונליין</th><th>כולל מע״מ</th><th>מקור</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={fields[r.key] ? s.rowErr : undefined} title={fields[r.key]}>
                <td className={ui.num}>{i + 1}{!ro ? <><br /><button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => move(i, -1)} aria-label="למעלה" style={{ minHeight: 24, padding: '0 6px' }}>↑</button><button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => move(i, 1)} aria-label="למטה" style={{ minHeight: 24, padding: '0 6px' }}>↓</button></> : null}</td>
                <td style={{ minWidth: 200 }}><input className={ui.input} value={r.name} disabled={ro} maxLength={120} onChange={e => upd(r.key, { name: e.target.value })} /><input className={ui.input} value={r.description} disabled={ro} maxLength={1000} placeholder="תיאור קצר (לא חובה)" style={{ marginTop: 4 }} onChange={e => upd(r.key, { description: e.target.value })} /></td>
                <td><select className={ui.select} value={r.categorySlug} disabled={ro} onChange={e => upd(r.key, { categorySlug: e.target.value })}><option value="">ללא</option>{CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></td>
                <td><select className={ui.select} value={r.priceType} disabled={ro} onChange={e => upd(r.key, { priceType: e.target.value as TreatmentRow['priceType'] })}>{Object.entries(PRICE_TYPE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                <td className={s.num}><input className={ui.input} dir="ltr" inputMode="numeric" value={r.price} disabled={ro || ['on_request', 'free'].includes(r.priceType)} onChange={e => upd(r.key, { price: e.target.value })} /></td>
                <td className={s.num}><input className={ui.input} dir="ltr" inputMode="numeric" value={r.priceMax} disabled={ro || r.priceType !== 'range'} onChange={e => upd(r.key, { priceMax: e.target.value })} /></td>
                <td><input className={ui.input} value={r.priceNote} disabled={ro} maxLength={80} placeholder="6 מפגשים" onChange={e => upd(r.key, { priceNote: e.target.value })} /></td>
                <td className={s.num}><input className={ui.input} dir="ltr" inputMode="numeric" value={r.duration} disabled={ro} maxLength={4} onChange={e => upd(r.key, { duration: e.target.value })} /></td>
                <td><input type="checkbox" checked={r.isPublished} disabled={ro} onChange={e => upd(r.key, { isPublished: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.isMedical} disabled={ro} onChange={e => upd(r.key, { isMedical: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.requiresDeclaration || r.isMedical} disabled={ro || r.isMedical} onChange={e => upd(r.key, { requiresDeclaration: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.onlineBookable && !r.isMedical} disabled={ro || r.isMedical} onChange={e => upd(r.key, { onlineBookable: e.target.checked })} /></td>
                <td><select className={ui.select} value={r.taxIncluded} disabled={ro} onChange={e => upd(r.key, { taxIncluded: e.target.value as TreatmentRow['taxIncluded'] })}><option value="unknown">לא ידוע</option><option value="yes">כולל</option><option value="no">לפני</option></select></td>
                <td className={s.small}>{r.source || (r.id ? '—' : 'חדש')}</td>
                <td>{!ro ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} onClick={() => remove(r)}>מחיקה</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ro && rows.length < 200 ? <div style={{ marginTop: 10 }}><button type="button" className={`${ui.btn} ${ui.small}`} onClick={add}>הוספת טיפול</button></div> : null}
      {Object.keys(fields).length ? <p className={ui.error} style={{ marginTop: 8 }}>{[...new Set(Object.values(fields))].join(' · ')}</p> : null}
      <SaveBar pending={pending} msg={msg} canEdit={canEdit} label={`שמירת ${rows.length} טיפולים${deleted.length ? ` ומחיקת ${deleted.length}` : ''}`} />
    </form>
  );
}

// ---------- AI ----------

export function AiPanel({ branchIds, gap, canEdit, compact }: { branchIds: string[]; gap: BranchEdit['gap']; canEdit: boolean; compact?: boolean }) {
  const router = useRouter();
  const [res, setRes] = useState<{ ok: boolean; text: string; runId?: string | null } | null>(null);
  const [pending, start] = useTransition();
  const run = (mode: EnhanceMode) =>
    start(async () => {
      const r = await enhanceBranchesAction(branchIds, mode);
      if (!r.ok) { setRes({ ok: false, text: r.error }); return; }
      const parts = [r.count ? `הריצה נוצרה ל־${r.count} רישומים${r.dispatched === false ? ' (העובד לא הופעל אוטומטית: חסר GITHUB_DISPATCH_TOKEN, הריצה מחכה בתור)' : ''}` : 'לא נוצרה ריצה: אין רישום שעומד בתנאים'];
      if (r.seeded) parts.push(`${r.seeded} רשומות ייבוא נוצרו מהרישום`);
      if (r.skipped.length) parts.push(`דולג: ${r.skipped.map(x => x.reason).join(', ')}`);
      if (r.count) parts.push(`תוכנית: ${Object.entries(r.plan).map(([k, v]) => `${STEP_NAME[k as keyof typeof STEP_NAME] ?? k} (${v})`).join(', ') || 'ללא צעדים'} · תקרה $${r.budgetUsd.toFixed(2)}`);
      setRes({ ok: true, text: parts.join('. '), runId: r.runId });
      router.refresh();
    });
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      {gap ? (
        <>
          {!compact ? <div className={s.readiness}>{gap.readiness}%<span className={ui.sub}>מוכנות הפרופיל · {STATUS_NAME[gap.status as keyof typeof STATUS_NAME] ?? gap.status}</span></div> : null}
          <div className={s.aiPlan}>{gap.missing.length ? gap.missing.map(m => <Chip key={m} tone={gap.ownerOnly.includes(m) ? 'warn' : 'neutral'}>{SECTION_NAME[m] ?? m}</Chip>) : <Chip tone="ok">כל הסעיפים מלאים</Chip>}</div>
          <p className={ui.note}>{gap.why ? gap.why : gap.plan.length ? <>תוכנית אוטומטית: {gap.plan.map(p => STEP_NAME[p]).join(' ← ')}.</> : 'אין צעד שיכול למלא את החסרים.'}{!gap.hasPlace && gap.canEnhance ? ' הרישום לא הגיע מהייבוא: רשומת ייבוא תיווצר מהנתונים הקיימים בהפעלה הראשונה.' : ''}</p>
          {gap.lastRun ? <p className={ui.hint}>ריצה אחרונה {new Date(gap.lastRun.at).toLocaleDateString('he-IL')}: {gap.lastRun.skipped ? `דולג (${gap.lastRun.skipped})` : gap.lastRun.filled.length ? `מולא: ${gap.lastRun.filled.map(x => FILLED[x] ?? x).join(', ')}` : 'לא היה מה להוסיף'}{gap.lastRun.editorial ? ` · כותב: ${gap.lastRun.editorial}` : ''}</p> : null}
        </>
      ) : null}
      {canEdit ? (
        <div className={ui.actions}>
          <button type="button" className={`${ui.btn} ${ui.teal}`} disabled={pending || (gap ? !gap.canEnhance : false)} onClick={() => run('auto')}>השלמה אוטומטית לפי החסרים</button>
          <button type="button" className={ui.btn} disabled={pending || (gap ? !gap.canEnhance : false)} onClick={() => run('site')}>קריאה חוזרת של האתר + השלמה</button>
          <button type="button" className={ui.btn} disabled={pending || (gap ? !gap.canEnhance : false)} onClick={() => { if (confirm('לכתוב מחדש את התיאור והשאלות? טקסט שסומן כמאושר לא יוחלף.')) run('rewrite'); }}>כתיבה מחדש של התיאור</button>
          <button type="button" className={ui.btn} disabled={pending || (gap ? !gap.canEnhance : false)} onClick={() => run('images')}>העתקת תמונות שנמצאו</button>
        </div>
      ) : null}
      {pending ? <p className={ui.note}>יוצר ריצה…</p> : null}
      {res ? <p className={res.ok ? ui.ok : ui.error}>{res.text}{res.ok && res.runId ? <> · <Link href="/ops/import" className={ui.rowLink}>מעקב בריצות הייבוא</Link></> : null}</p> : null}
    </div>
  );
}

function AiSection({ data, canEdit }: { data: BranchEdit; canEdit: boolean }) {
  return (
    <div className={`${ui.card} ${ui.cardPad}`}>
      <h2 className={ui.cardTitle} style={{ marginBottom: 6 }}>השלמה ב־AI</h2>
      <p className={ui.hint} style={{ marginBottom: 12 }}>הריצה קוראת את אתר העסק, מחפשת ברשת את מה שחסר (ChatGPT, כל עובדה עם העמוד שממנו נקראה), כותבת תיאור ושאלות מהראיות ומעתיקה תמונות, וממלאת רק שדות ריקים. מה שנערך כאן נשאר. הריצה מתבצעת בעובד הייבוא ונמדדת בתקציב.</p>
      <AiPanel branchIds={[data.id]} gap={data.gap} canEdit={canEdit} />
    </div>
  );
}
