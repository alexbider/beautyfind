import Link from 'next/link';
import { Wordmark } from '../Wordmark';
import { PrintButton } from './PrintButton';
import type { ReceiptData } from './data';
import styles from './receipt.module.css';

// Design: project/BeautyFind Receipt.dc.html (status: deposit | paid | refunding | refunded).
// Server component; only the print button runs on the client. Refund tracker and chrome hide in print.

export function ReceiptShell({ back, children }: { back: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header} data-noprint>
        <div className={styles.headerIn}>
          <Link href="/" aria-label="BeautyFind, לדף הבית" className={styles.logo}><Wordmark size={21} /></Link>
          <span className={styles.spacer} />
          <PrintButton className={styles.headBtn} />
          <Link href={back.href} className={styles.headLink}>{back.label}</Link>
        </div>
      </header>
      <main className={styles.wrap}>{children}</main>
    </div>
  );
}

export function ReceiptView({ data }: { data: ReceiptData }) {
  return (
    <>
      {data.tracks.map(t => (
        <section key={t.key} className={styles.track} aria-labelledby={`rf-${t.key}`} data-noprint>
          <h2 id={`rf-${t.key}`} className={styles.trackTitle}>{t.title}</h2>
          <p className={styles.trackIntro}>{t.intro}</p>
          {t.failed && <p className={styles.trackFail} role="alert">ההחזר לא עבר בחברת האשראי. הקליניקה מטפלת בזה ותעדכן אותך.</p>}
          <ol className={styles.steps}>
            {t.steps.map((s, i) => {
              const cur = !s.done && t.steps.findIndex(x => !x.done) === i;
              const last = i === t.steps.length - 1;
              return (
                <li key={s.name} className={styles.step} data-done={s.done || undefined} data-cur={cur || undefined} aria-current={cur ? 'step' : undefined}>
                  <span className={styles.rail} aria-hidden="true">
                    <span className={styles.dot}>{s.done ? '✓' : i + 1}</span>
                    {!last && <span className={styles.line} />}
                  </span>
                  <span className={styles.stepText}>
                    <span className={styles.stepName}>{s.name}{s.done && <span className="sr-only"> (הושלם)</span>}</span>
                    <span className={styles.stepNote}><Bidi text={s.note} /></span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {data.docs.map((d, idx) => {
        const H = idx === 0 ? 'h1' : 'h2';
        return (
        <article key={d.key} className={styles.doc} aria-labelledby={`dh-${d.key}`} data-kind={d.kind}>
          <div className={styles.docHead}>
            <div className={styles.docTitleBlock}>
              <span className={styles.kicker}>{d.kicker}</span>
              <H id={`dh-${d.key}`} className={styles.h1}>
                {d.title}
                {d.number && <> <span className="ltr tnum">{d.number}</span></>}
              </H>
              <span className={styles.issued}>
                {d.kind === 'confirmation' ? 'שולם' : 'מקור · הופקה'} <span className="ltr tnum">{d.date}</span>
              </span>
            </div>
            <div className={styles.issuer}>
              <span className={styles.issuerName}>{d.issuer.name}</span>
              {d.issuer.taxId && <span className={styles.issuerSub}>מספר עוסק <span className="ltr tnum">{d.issuer.taxId}</span></span>}
              {d.issuer.address && <span className={styles.issuerSub}>{d.issuer.address}</span>}
            </div>
          </div>

          <div className={styles.meta}>
            {d.meta.map(m => (
              <span key={m.label}>
                <span className={styles.metaLabel}>{m.label}: </span>
                <strong className={m.ltr ? 'ltr tnum' : undefined}>{m.value}</strong>
              </span>
            ))}
          </div>

          <table className={styles.lines}>
            <thead>
              <tr>
                <th scope="col">פריט</th>
                <th scope="col" className={styles.amtCol}>סכום</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i} data-strong={l.strong || undefined} data-soft={l.soft || undefined}>
                  <td>{l.name}</td>
                  <td className={`${styles.amtCol} ltr tnum`}>{l.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.docFoot}>
            {d.method && (
              <span>
                <span className={styles.metaLabel}>אמצעי תשלום: </span>
                <Bidi text={d.method} />
              </span>
            )}
            {d.notes.map(n => <span key={n} className={styles.note}><Bidi text={n} /></span>)}
            {d.pdfUrl && (
              <a href={d.pdfUrl} target="_blank" rel="noopener noreferrer" className={styles.pdf} data-noprint>
                הורדת המסמך המקורי (PDF)
              </a>
            )}
          </div>
        </article>
        );
      })}

      <p className={styles.fine} data-noprint>
        {data.docs.some(d => d.kind !== 'confirmation')
          ? `המסמכים הופקו על ידי ${data.clinic} במערכת החשבוניות שלה ונמסרים דרך BeautyFind.`
          : `${data.clinic} מנפיקה את מסמכי המס בעצמה.`}{' '}
        BeautyFind אינה גובה עמלה מהתשלום. טיפולים אסתטיים אינם בסל הבריאות. שאלות על החיוב: לקליניקה
        {data.phone ? (
          <>
            , <a href={data.phone.href} className="ltr">{data.phone.display}</a>.
          </>
        ) : (
          '.'
        )}
      </p>
    </>
  );
}

/** Wraps digits, prices, card masks, refs and date runs in LTR spans inside Hebrew text. */
function Bidi({ text }: { text: string }) {
  const parts = text.split(/((?:−?₪[\d,.]+)|(?:•••• ?\d{4})|(?:\d[\d/.:,–-]*\d|\d))/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="ltr tnum">{p}</span>
        ) : (
          p
        ),
      )}
    </>
  );
}
