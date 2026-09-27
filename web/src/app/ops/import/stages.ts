// Plain-language stages of a run, as the worker reports them (stats.stage) and the run card shows them.

export const IMPORT_STAGES: Array<{ id: string; name: string }> = [
  { id: 'discover', name: 'איתור עסקים' },
  { id: 'sites', name: 'קריאת האתרים' },
  { id: 'sources', name: 'Google Maps ורשתות' },
  { id: 'photos', name: 'תמונות' },
  { id: 'writing', name: 'כתיבת תיאורים' },
  { id: 'checks', name: 'בדיקות' },
  { id: 'done', name: 'מוכן לבדיקה' },
];

export const ENHANCE_STAGES: Array<{ id: string; name: string }> = [
  { id: 'refresh', name: 'רענון נתונים' },
  { id: 'sources', name: 'Google Maps ורשתות' },
  { id: 'photos', name: 'תמונות' },
  { id: 'fill', name: 'השלמת השדות' },
  { id: 'done', name: 'הסתיים' },
];

export const stagesFor = (provider: string) => (provider === 'enhance' ? ENHANCE_STAGES : IMPORT_STAGES);

/** Index of the current stage; a finished run is at the end, a queued one before the start. */
export function stageIndex(provider: string, stage: string | undefined, status: string): number {
  const list = stagesFor(provider);
  if (status === 'done') return list.length - 1;
  if (!stage) return status === 'queued' ? -1 : 0;
  const i = list.findIndex(s => s.id === stage);
  if (i >= 0) return i;
  if (stage === 'publish') return list.length - 1;
  return 0;
}
