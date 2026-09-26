'use client';

import { useState } from 'react';
import { EmbedGate } from './EmbedGate';
import styles from './VideoEmbed.module.css';

export interface VideoView {
  id: string;
  title: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  status: 'ok' | 'private' | 'not_found' | 'not_embeddable' | 'unknown';
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Official YouTube videos (design h-video): a 16:9 card per video, click to load the player
 * (youtube-nocookie, no autoplay), consent-gated. Nothing is downloaded or rehosted; the title and
 * channel come from YouTube as attribution. Unavailable videos are not shown as players.
 */
export function VideoGrid({ videos }: { videos: VideoView[] }) {
  return (
    <div className={styles.grid}>
      {videos.map(v => <VideoCard key={v.id} v={v} />)}
    </div>
  );
}

function VideoCard({ v }: { v: VideoView }) {
  const [play, setPlay] = useState(false);
  const title = v.title ?? 'סרטון של העסק';
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0&modestbranding=1&hl=he&autoplay=1`;
  return (
    <article className={styles.card}>
      <div className={styles.frame}>
        {play ? (
          <EmbedGate label="הפעלת הסרטון" note="הנגן נטען מ־YouTube רק אחרי אישור." height={200} className={styles.gate}>
            <iframe className={styles.player} src={src} title={title} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          </EmbedGate>
        ) : (
          <button type="button" className={styles.poster} onClick={() => setPlay(true)} aria-label={`הפעלת הסרטון: ${title}`}>
            {/* The thumbnail is a YouTube-hosted image, requested only when the visitor allowed embeds; until then a neutral poster. */}
            <span aria-hidden="true" className={styles.play}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M6 3.6 14 9l-8 5.4z" /></svg>
            </span>
          </button>
        )}
      </div>
      <span className={styles.title}>{title}</span>
      <span className={styles.source}>
        YouTube{v.channelTitle ? ` · ${v.channelTitle}` : ''}{v.durationSec ? ` · ${mmss(v.durationSec)}` : ''}
      </span>
    </article>
  );
}
