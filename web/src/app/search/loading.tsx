import { Wordmark } from '@/components/Wordmark';
import s from '@/components/search/search.module.css';
import p from './page.module.css';

// Route-entry state (States "טעינה"): a skeleton in the shape of the results, no layout jump,
// the spinner only as a caption. In-page filter changes keep the old results, dimmed, instead.

const SKELETONS = [
  { w1: '72%', w2: '54%', w3: '38%' },
  { w1: '61%', w2: '48%', w3: '44%' },
  { w1: '80%', w2: '58%', w3: '33%' },
  { w1: '66%', w2: '42%', w3: '50%' },
];

export default function Loading() {
  return (
    <div className={p.root}>
      <div className={p.skelHeader}>
        <div className={p.skelHeaderBar}>
          <Wordmark size={27} />
          <span aria-hidden="true" className={p.skelSearch} />
        </div>
      </div>
      <main className={p.main} aria-busy="true">
        <span aria-hidden="true" className={p.skelTitle} />
        <div className={s.skelGrid} aria-hidden="true">
          {SKELETONS.map((sk, i) => (
            <div key={i} className={s.skelCard}>
              <div className={s.skelImg} />
              <div className={s.skelBody}>
                <span className={s.skelLine} data-first style={{ width: sk.w1 }} />
                <span className={s.skelLine} style={{ width: sk.w2 }} />
                <span className={s.skelLine} style={{ width: sk.w3 }} />
              </div>
            </div>
          ))}
        </div>
        <p role="status" className={s.skelStatus}>
          <span aria-hidden="true" className={s.spinner} />
          <span>טוען תוצאות…</span>
        </p>
      </main>
    </div>
  );
}
