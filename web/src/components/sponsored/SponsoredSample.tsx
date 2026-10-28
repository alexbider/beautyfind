'use client';

import type { SponsoredCardData } from '@/lib/sponsored';
import { SponsoredCard } from './SponsoredSlider';

/** A sponsored card shown as an example (marketing pages): the real card, inert, with sample content. */
export function SponsoredSample({ c }: { c: SponsoredCardData }) {
  return (
    <div inert style={{ display: 'flex' }}>
      <SponsoredCard c={c} onOpen={() => {}} />
    </div>
  );
}
