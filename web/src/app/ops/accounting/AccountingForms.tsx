'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { createExpenseAction, deleteExpenseAction, issueDocumentAction, reconcileBankAction, updateSubscriptionAction, type ReconcileResult } from './actions';

const nis = (agorot: number) => `${agorot < 0 ? '−' : ''}₪${(Math.abs(agorot) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ExpenseForm({ categories }: { categories: Array<{ key: string; name: string }> }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={ui.stack} style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        start(async () => {
          const r = await createExpenseAction(data);
          setMsg(r.ok ? { ok: true, text: 'ההוצאה נרשמה' } : { ok: false, text: r.error });
          if (r.ok) { form.reset(); router.refresh(); }
        });
      }}
    >
      <div className={ui.formGrid}>
        <div className={ui.field}><label className={ui.label} htmlFor="ex-date">תאריך</label><input id="ex-date" name="date" type="date" className={ui.input} required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div className={ui.field}><label className={ui.label} htmlFor="ex-vendor">ספק</label><input id="ex-vendor" name="vendor" className={ui.input} required maxLength={120} placeholder="Vercel, Neon, DataForSEO…" /></div>
        <div className={ui.field}><label className={ui.label} htmlFor="ex-cat">קטגוריה</label><select id="ex-cat" name="category" className={ui.select} required defaultValue="hosting">{categories.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
        <div className={ui.field}><label className={ui.label} htmlFor="ex-net">סכום לפני מע״מ (₪)</label><input id="ex-net" name="netNis" type="number" step="0.01" min="0" className={ui.input} required /></div>
        <div className={ui.field}><label className={ui.label} htmlFor="ex-vat">מע״מ ששולם (₪)</label><input id="ex-vat" name="vatNis" type="number" step="0.01" min="0" className={ui.input} defaultValue={0} /><span className={ui.hint}>ספק זר ללא מע״מ: 0</span></div>
        <div className={ui.field}><label className={ui.label} htmlFor="ex-file">קבלה או חשבונית (PDF או תמונה)</label><input id="ex-file" name="receipt" type="file" accept="application/pdf,image/*" className={ui.input} /></div>
      </div>
      <div className={ui.field}><label className={ui.label} htmlFor="ex-desc">תיאור (רשות)</label><input id="ex-desc" name="description" className={ui.input} maxLength={300} /></div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>רישום הוצאה</button>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={pending} onClick={() => { if (window.confirm('למחוק את ההוצאה?')) start(async () => { const r = await deleteExpenseAction(id); if (r.ok) router.refresh(); }); }}>מחיקה</button>
  );
}

export function SubscriptionActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (input: { status?: 'active' | 'past_due' | 'hidden' | 'cancelled'; retryInDays?: number }, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const r = await updateSubscriptionAction({ id, ...input });
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  };
  return (
    <div className={ui.actions}>
      {status === 'past_due' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run({ retryInDays: 3 })}>ניסיון חוזר בעוד 3 ימים</button> : null}
      {status === 'past_due' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} disabled={pending} onClick={() => run({ status: 'active' }, 'לסמן כשולם ולהחזיר את העסק לאוויר?')}>הוסדר · הפעלה</button> : null}
      {status === 'past_due' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={pending} onClick={() => run({ status: 'hidden' }, 'להסתיר את הפרופיל עד להסדרת החוב?')}>הסתרה בחוב</button> : null}
      {status === 'active' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run({ status: 'past_due' }, 'לסמן חוב פתוח? העסק יסומן בחוב ויקבל הודעה M23.')}>סימון חיוב שנכשל</button> : null}
      {status === 'hidden' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} disabled={pending} onClick={() => run({ status: 'active' })}>הוסדר · הפעלה</button> : null}
      {status !== 'cancelled' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run({ status: 'cancelled' }, 'לבטל את המנוי? הפרופיל יישאר עד סוף התקופה.')}>ביטול מנוי</button> : null}
      {err ? <span className={ui.error}>{err}</span> : null}
    </div>
  );
}

type LineDraft = { description: string; qty: number; unitNis: number };

export function InvoiceForm({ businesses }: { businesses: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [type, setType] = useState<'platform_invoice' | 'credit_note'>('platform_invoice');
  const [q, setQ] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [refNo, setRefNo] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ description: '', qty: 1, unitNis: 0 }]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const matches = useMemo(() => (q.trim().length < 2 ? [] : businesses.filter(b => b.name.includes(q.trim())).slice(0, 8)), [q, businesses]);
  const chosen = businesses.find(b => b.id === businessId);
  const total = lines.reduce((a, l) => a + l.qty * l.unitNis, 0);
  return (
    <form
      className={ui.stack} style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await issueDocumentAction({ type, businessId: businessId || undefined, referencesNumber: refNo || undefined, sentTo, lines });
          setMsg(r.ok ? { ok: true, text: `הופק מסמך ${r.number}` } : { ok: false, text: r.error });
          if (r.ok) { setLines([{ description: '', qty: 1, unitNis: 0 }]); router.refresh(); }
        });
      }}
    >
      <div className={ui.pills} role="radiogroup" aria-label="סוג המסמך">
        <button type="button" className={ui.pill} data-on={type === 'platform_invoice'} onClick={() => setType('platform_invoice')}>חשבונית</button>
        <button type="button" className={ui.pill} data-on={type === 'credit_note'} onClick={() => setType('credit_note')}>חשבונית זיכוי</button>
      </div>
      <div className={ui.formGrid}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="inv-biz">לקוח (עסק)</label>
          <input id="inv-biz" className={ui.input} value={chosen ? chosen.name : q} onChange={e => { setBusinessId(''); setQ(e.target.value); }} placeholder="הקלידו שם עסק, או השאירו ריק ללקוח חיצוני" />
          {!chosen && matches.length ? <div className={ui.pills} style={{ marginTop: 6 }}>{matches.map(b => <button key={b.id} type="button" className={ui.pill} onClick={() => setBusinessId(b.id)}>{b.name}</button>)}</div> : null}
        </div>
        <div className={ui.field}><label className={ui.label} htmlFor="inv-to">נשלח אל (דוא״ל)</label><input id="inv-to" type="email" className={ui.input} value={sentTo} onChange={e => setSentTo(e.target.value)} placeholder="ריק = דוא״ל החשבוניות של העסק" dir="ltr" /></div>
        {type === 'credit_note' ? <div className={ui.field}><label className={ui.label} htmlFor="inv-ref">מזכה את חשבונית מספר</label><input id="inv-ref" className={ui.input} value={refNo} onChange={e => setRefNo(e.target.value)} dir="ltr" required /></div> : null}
      </div>
      <div className={ui.stack} style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) 70px 110px auto', gap: 6, alignItems: 'center' }}>
            <input className={ui.input} value={l.description} onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="תיאור השורה" required maxLength={200} />
            <input className={ui.input} type="number" step="0.01" min="0.01" value={l.qty} onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="כמות" />
            <input className={ui.input} type="number" step="0.01" value={l.unitNis} onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, unitNis: Number(e.target.value) } : x)))} aria-label="מחיר ליחידה בש״ח" />
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setLines(ls => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label="הסרת שורה">×</button>
          </div>
        ))}
        <div><button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setLines(ls => [...ls, { description: '', qty: 1, unitNis: 0 }])}>+ שורה</button></div>
      </div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>{type === 'credit_note' ? 'הפקת חשבונית זיכוי' : 'הפקת חשבונית'}</button>
        <span className={ui.note}>סה״כ {nis(Math.round(total * 100) * (type === 'credit_note' ? -1 : 1))} · ללא מע״מ ישראלי (Israfind Group)</span>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function BankUpload() {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <label className={ui.label} htmlFor="bank-file">דף בנק (CSV עם תאריך, סכום ותיאור)</label>
      <input
        id="bank-file" type="file" accept=".csv,text/csv,text/plain" className={ui.input} disabled={pending}
        onChange={e => {
          const f = e.target.files?.[0];
          if (!f) return;
          f.text().then(csv => start(async () => setResult(await reconcileBankAction(csv))));
        }}
      />
      {result && !result.ok ? <p className={ui.error}>{result.error}</p> : null}
      {result && result.ok ? (
        <div className={ui.stack} style={{ gap: 8 }}>
          <p className={ui.ok}>{result.matched.length} שורות הותאמו · {result.unmatchedLines.length} שורות בנק ללא תשלום תואם · {result.unmatchedPayments.length} תשלומים שלא נמצאו בדף הבנק</p>
          {result.unmatchedLines.length ? <ul className={ui.list}>{result.unmatchedLines.map((l, i) => <li key={i} className={ui.note}>{l.date.slice(0, 10)} · {nis(l.amountAgorot)} · {l.text}</li>)}</ul> : null}
          {result.unmatchedPayments.length ? <ul className={ui.list}>{result.unmatchedPayments.map((p, i) => <li key={i} className={ui.note}>תשלום {p.ref} · {p.payer} · {nis(p.amountAgorot)} · {p.at ? p.at.slice(0, 10) : ''}</li>)}</ul> : null}
        </div>
      ) : null}
      <p className={ui.hint}>ההתאמה לפי סכום זהה ותאריך בטווח ארבעה ימים. שום דבר לא נשמר: הקובץ נבדק ומוצג בלבד.</p>
    </div>
  );
}
