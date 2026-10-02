'use client';

import { Toggle } from '@/components/ops/Toggle';
import { setIndexingAction } from './actions';

// The switches of the indexing tab. Each one saves on change through the server action; a refused save
// (no permission) flips back and shows the reason.

export function IndexingToggle({ name, checked, title, sub, canEdit }: { name: string; checked: boolean; title: string; sub?: string; canEdit: boolean }) {
  return <Toggle name={name} checked={checked} title={title} sub={sub} onChange={setIndexingAction} disabled={!canEdit} />;
}
