'use client';

import { useRef, useState } from 'react';
import { haptic } from './haptics';
import styles from './Lists.module.css';

// List row with swipe actions (spec §3.1). RTL: swiping left-to-right reveals the trailing actions on
// the left. The actions stay reachable without swiping: they are real buttons, shown when the row
// has keyboard focus inside it and always on devices with a fine pointer.

export interface SwipeAction {
  label: string;
  onAction: () => void;
  tone?: 'danger' | 'primary' | 'neutral';
}

export function SwipeRow({ children, actions }: { children: React.ReactNode; actions: SwipeAction[] }) {
  const width = actions.length * 84;
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY, base: x };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!dragging && Math.abs(e.clientY - s.y) > Math.abs(dx)) {
      start.current = null; // vertical scroll wins
      return;
    }
    if (Math.abs(dx) > 6) setDragging(true);
    setX(Math.max(0, Math.min(width + 24, s.base + dx)));
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    const open = x > width / 2;
    if (open && x < width) haptic('light');
    setX(open ? width : 0);
  };

  return (
    <div className={styles.swipe} style={{ '--w': `${width}px` } as React.CSSProperties}>
      <div className={styles.swipeActions} style={{ width }} data-open={x > 0 || undefined}>
        {actions.map(a => (
          <button
            key={a.label}
            type="button"
            className={styles.swipeBtn}
            data-tone={a.tone ?? 'neutral'}
            onClick={() => {
              setX(0);
              a.onAction();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div
        className={styles.swipeFront}
        data-dragging={dragging || undefined}
        style={{ transform: x ? `translateX(${x}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  );
}
