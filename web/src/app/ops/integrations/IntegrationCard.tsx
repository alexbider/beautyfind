'use client';

import { useState, useTransition } from 'react';
import { Chip, ui } from '@/components/ops/ui';
import type { Integration } from '@/lib/server/integrations';
import { checkIntegrationAction } from './actions';
import styles from './integrations.module.css';

const STATE: Record<Integration['state'], { name: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  connected: { name: 'מחובר', tone: 'ok' },
  attention: { name: 'דורש טיפול', tone: 'bad' },
  not_connected: { name: 'לא מחובר', tone: 'neutral' },
  unavailable: { name: 'לא זמין עדיין', tone: 'neutral' },
};

export function IntegrationCard({ item }: { item: Integration }) {
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const st = STATE[item.state];
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={styles.name}>{item.name}</div>
        <Chip tone={st.tone}>{st.name}</Chip>
      </div>
      <div className={styles.desc}>{item.desc}</div>
      <div className={styles.note}>{item.note}</div>
      <div className={styles.where}>הגדרה: <span dir="ltr">{item.where}</span></div>
      <div className={styles.actions}>
        {item.checkable ? (
          <button
            type="button" className={`${ui.btn} ${ui.small}`} disabled={pending}
            onClick={() => start(async () => {
              const r = await checkIntegrationAction({ key: item.key });
              setRes(r.ok ? { ok: r.result.ok, text: `${r.result.note}${r.result.ms !== null ? ` · ${r.result.ms}ms` : ''}` } : { ok: false, text: r.error });
            })}
          >
            {pending ? 'בודק…' : 'בדיקה'}
          </button>
        ) : null}
        {res ? <span className={res.ok ? ui.ok : ui.error}>{res.text}</span> : null}
      </div>
    </div>
  );
}
