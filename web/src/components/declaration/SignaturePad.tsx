'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import styles from './Declaration.module.css';

export interface SignaturePadHandle {
  clear(): void;
  /** PNG of the strokes on a transparent background, at most 900px wide. */
  toPng(): Promise<Blob | null>;
}

const MAX_EXPORT_W = 900;

/**
 * Finger / mouse signature on a canvas. Reports the number of ink points drawn (the server
 * re-checks that the exported PNG is not blank). Keyboard users sign by typed name instead.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { onInk: (points: number) => void; invalid?: boolean; hasInk: boolean; labelId: string }>(
  function SignaturePad({ onInk, invalid, hasInk, labelId }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ink = useRef(0);
    const onInkRef = useRef(onInk);
    useEffect(() => {
      onInkRef.current = onInk;
    }, [onInk]);

    useEffect(() => {
      const el = canvasRef.current;
      if (!el) return;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      let w = 0, h = 0;
      const fit = () => {
        const r = el.getBoundingClientRect();
        if (Math.round(r.width) === w && Math.round(r.height) === h) return;
        w = Math.round(r.width);
        h = Math.round(r.height);
        const d = window.devicePixelRatio || 1;
        el.width = Math.max(1, Math.round(r.width * d));
        el.height = Math.max(1, Math.round(r.height * d));
        ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0C243E';
        // Resizing wipes the bitmap, so the ink count starts over too.
        if (ink.current) {
          ink.current = 0;
          onInkRef.current(0);
        }
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      let down = false;
      const pt = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
      };
      const onDown = (e: PointerEvent) => {
        down = true;
        el.setPointerCapture(e.pointerId);
        const [x, y] = pt(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
      };
      const onMove = (e: PointerEvent) => {
        if (!down) return;
        const [x, y] = pt(e);
        ctx.lineTo(x, y);
        ctx.stroke();
        ink.current += 1;
        onInkRef.current(ink.current);
      };
      const onUp = () => {
        down = false;
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      return () => {
        ro.disconnect();
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      clear() {
        const el = canvasRef.current;
        const ctx = el?.getContext('2d');
        if (!el || !ctx) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.restore();
        ink.current = 0;
        onInkRef.current(0);
      },
      toPng() {
        const el = canvasRef.current;
        if (!el) return Promise.resolve(null);
        const scale = Math.min(1, MAX_EXPORT_W / el.width);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(el.width * scale));
        out.height = Math.max(1, Math.round(el.height * scale));
        out.getContext('2d')?.drawImage(el, 0, 0, out.width, out.height);
        return new Promise(resolve => out.toBlob(b => resolve(b), 'image/png'));
      },
    }));

    return (
      <div className={styles.pad} data-invalid={invalid || undefined} data-ink={hasInk || undefined}>
        <canvas ref={canvasRef} role="img" aria-labelledby={labelId} className={styles.canvas} />
        {!hasInk && <span aria-hidden="true" className={styles.padLine} />}
      </div>
    );
  },
);

/** Renders a typed name as a signature image (the keyboard / assistive alternative). */
export async function typedSignaturePng(name: string): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 220;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-frank').trim() || "'Frank Ruhl Libre'";
  ctx.font = `500 72px ${family}, serif`;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0C243E';
  ctx.fillText(name.trim(), c.width / 2, c.height / 2, c.width - 60);
  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}
