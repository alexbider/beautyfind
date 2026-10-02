import 'server-only';
import { cache } from 'react';
import { INDEX_SECTION_KEYS, type IndexingPolicy, type IndexSectionKey } from '@/lib/indexing';
import { platformSettings } from './platformSettings';

// The saved indexing policy (src/lib/indexing.ts explains the layers). Read once per request.

export const indexingPolicy = cache(async (): Promise<IndexingPolicy> => {
  const s = await platformSettings();
  const sections = Object.fromEntries(INDEX_SECTION_KEYS.map(k => [k, s.indexSections[k] !== false])) as Record<IndexSectionKey, boolean>;
  return { staging: process.env.STAGING === '1', site: s.indexSite, sections };
});
