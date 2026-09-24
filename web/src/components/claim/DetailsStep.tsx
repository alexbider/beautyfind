import type { InputHTMLAttributes, RefObject } from 'react';
import { DAY_NAMES, detailsErrors, hasMedical, hoursLabel, type ClaimDetails } from '@/app/for-business/claim/shared';
import { categoryBySlug } from '@/lib/catalog';
import styles from './Claim.module.css';

// Chip order as designed.
const CAT_ORDER = [
  'medical-aesthetics', 'facials', 'hair-removal', 'hair-salons', 'nails', 'brows-lashes', 'makeup',
  'permanent-makeup', 'spa-massage', 'body-contouring', 'tanning', 'plastic-surgery', 'hair-restoration', 'dental-aesthetics',
].map(slug => categoryBySlug(slug)!);

export type DetailsForm = Omit<ClaimDetails, 'branchId'>;

interface Props {
  headingRef: RefObject<HTMLHeadingElement | null>;
  form: DetailsForm;
  touched: boolean;
  onChange: (patch: Partial<DetailsForm>) => void;
}

function Req() {
  return <span aria-hidden="true" className={styles.req}>*</span>;
}

export function DetailsStep({ headingRef, form, touched, onChange }: Props) {
  const errs = detailsErrors(form);
  const bad = (k: keyof typeof errs) => touched && errs[k];
  const medical = hasMedical(form.cats);
  const n = form.cats.length;

  const text = (key: 'bizName' | 'address' | 'phone' | 'whatsapp' | 'doctor', extra: InputHTMLAttributes<HTMLInputElement>) => (
    <input
      className={styles.input}
      value={form[key]}
      onChange={e => onChange({ [key]: e.target.value })}
      aria-invalid={bad(key)}
      {...extra}
    />
  );

  return (
    <section aria-labelledby="h-details" className={styles.section}>
      <h2 id="h-details" ref={headingRef} tabIndex={-1} className={styles.h2}>
        פרטי העסק<span className={styles.dot}>.</span>
      </h2>
      <p className={styles.lede}>אימתנו שהעסק שלכם. עכשיו נשלים את מה שלקוחות רואים ראשון, ואת הכול אפשר לערוך גם אחר כך.</p>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>שם העסק <Req /></span>
          {text('bizName', { type: 'text', required: true, autoComplete: 'organization' })}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>כתובת ועיר <Req /></span>
          {text('address', { type: 'text', required: true, placeholder: 'רחוב ומספר, עיר', autoComplete: 'street-address' })}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>טלפון לפניות <Req /></span>
          {text('phone', { type: 'tel', dir: 'ltr', required: true, inputMode: 'tel', placeholder: '03-0000000', autoComplete: 'tel' })}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            WhatsApp <span className={styles.opt}>(לא חובה)</span>
          </span>
          {text('whatsapp', { type: 'tel', dir: 'ltr', inputMode: 'tel', placeholder: '050-0000000' })}
        </label>
      </div>

      <fieldset className={styles.fieldset}>
        <legend>תחומי הטיפול שאתם מציעים <Req /></legend>
        <div className={styles.chips}>
          {CAT_ORDER.map(c => {
            const on = form.cats.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                className={styles.chip}
                aria-pressed={on}
                onClick={() => onChange({ cats: on ? form.cats.filter(x => x !== c.slug) : [...form.cats, c.slug] })}
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <p className={styles.catsLine} data-bad={bad('cats') || undefined} aria-live="polite">
          {n === 0 ? 'בחרו לפחות תחום אחד' : n === 1 ? 'נבחר תחום אחד' : <>נבחרו <span className="ltr">{n}</span> תחומים</>}
        </p>
      </fieldset>

      {medical && (
        <div className={styles.medical}>
          <p>
            <strong>בחרתם תחום רפואי.</strong> הזרקות ופעולות חודרניות מחייבות רופא או רופאה מוסמכים, או אחות בהסמכה ובאחריות רופא שנמצא בקליניקה. נדרש שם מלא של האחראי הרפואי כדי לפרסם את התחום.
          </p>
          <label className={styles.field}>
            <span className={styles.label}>שם האחראי הרפואי <Req /></span>
            {text('doctor', { type: 'text', required: true, placeholder: 'ד״ר שם מלא, מספר רישיון' })}
          </label>
        </div>
      )}

      <div className={styles.hoursWrap}>
        <div className={styles.hoursHead}>
          <span className={styles.label} id="hours-label">שעות פעילות</span>
          <span className={styles.hoursNote}>ראשון–שישי · שבת סגור כברירת מחדל</span>
        </div>
        <ul className={styles.days} aria-labelledby="hours-label">
          {form.days.map((d, i) => (
            <li key={DAY_NAMES[i]} className={styles.day} data-closed={!d.open || undefined}>
              <span className={styles.dayName}>{DAY_NAMES[i]}</span>
              <span className={styles.dayRow}>
                <button
                  type="button"
                  className={styles.dayToggle}
                  aria-pressed={d.open}
                  aria-label={`${DAY_NAMES[i]}: פתוח`}
                  onClick={() => onChange({ days: form.days.map((x, j) => (j === i ? { ...x, open: !x.open } : x)) })}
                >
                  {d.open ? 'פתוח' : 'סגור'}
                </button>
                {d.open && <span dir="ltr" className={`${styles.dayHours} ltr`}>{hoursLabel(d)}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
