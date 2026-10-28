'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import styles from '@/app/for-business/marketing/marketing.module.css';

/**
 * The hero picture, or a short muted explainer loop over its poster. The video only loads on screens
 * wider than a phone and without reduced motion or data saver, and has a pause control (WCAG 2.2.2).
 */
export function HeroMedia({ image, video, priority = true }: { image: { src: string; alt: string }; video?: { src: string; poster: string; label: string }; priority?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [useVideo, setUseVideo] = useState(false);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!video) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!reduce && !saveData) setUseVideo(true);
  }, [video]);

  return (
    <span className={styles.heroMediaInner}>
      <Image src={image.src} alt={image.alt} fill sizes="(min-width:1024px) 560px, 100vw" priority={priority} style={{ objectFit: 'cover' }} />
      {useVideo && video && (
        <video
          ref={ref}
          src={video.src}
          poster={video.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={video.label}
          style={{ position: 'absolute', inset: 0 }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}
      <span aria-hidden="true" className={styles.heroShine} />
      {useVideo && video && (
        <button
          type="button"
          className={styles.playBadge}
          aria-label={playing ? 'עצירת הסרטון' : 'הפעלת הסרטון'}
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            if (el.paused) void el.play();
            else el.pause();
          }}
        >
          {playing && <span />}
          {playing ? 'הסבר קצר' : 'הפעלה'}
        </button>
      )}
    </span>
  );
}
