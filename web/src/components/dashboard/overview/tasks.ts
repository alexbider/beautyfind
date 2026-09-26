import type { Area } from '@/lib/permissions';

// Profile-completion checklist (design TASKS), computed from the branch's real data.
// Pure: the overview uses it for the current branch and analytics uses it for the regional benchmark.

export type TaskInput = {
  treatments: Array<{ priceAgorot: number | null; isPublished: boolean }>;
  hours: unknown;
  gallery: unknown;
  wazeUrl: string | null;
  medicalResponsibleId: string | null;
  hasMedicalCategory: boolean;
  openReviews: number;
};

export type TaskKey = 'menu' | 'hours' | 'photos' | 'waze' | 'medical' | 'reviews';

export type Task = {
  key: TaskKey;
  name: string;
  done: boolean;
  /** The tab that fixes it. */
  area: Area;
  href: string;
  /** Present when the design's static note is replaced by a count. */
  missing?: number;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Day = { open?: unknown; close?: unknown; closed?: unknown };

/** Sunday to Friday set (open with valid times, or explicitly closed), at least one open day, Shabbat closed. */
export function hoursComplete(hours: unknown) {
  if (!Array.isArray(hours) || hours.length !== 7) return false;
  const days = hours as Day[];
  if (days[6]?.closed !== true) return false;
  const week = days.slice(0, 6);
  const valid = (d: Day) =>
    d?.closed === true || (typeof d?.open === 'string' && typeof d?.close === 'string' && TIME_RE.test(d.open) && TIME_RE.test(d.close) && d.open < d.close);
  return week.every(valid) && week.some(d => d?.closed !== true);
}

export const galleryCount = (gallery: unknown) =>
  Array.isArray(gallery) ? gallery.filter(g => g && typeof g === 'object' && typeof (g as { url?: unknown }).url === 'string').length : 0;

export function profileTasks(b: TaskInput): Task[] {
  const published = b.treatments.filter(t => t.isPublished);
  const unpriced = published.filter(t => !((t.priceAgorot ?? 0) > 0)).length;
  const photos = galleryCount(b.gallery);
  const tasks: Task[] = [
    { key: 'menu', name: 'תפריט מחירים מלא', done: published.length > 0 && unpriced === 0, area: 'menu', href: '/biz/menu', missing: published.length === 0 ? undefined : unpriced },
    { key: 'hours', name: 'שעות פעילות ראשון–שישי', done: hoursComplete(b.hours), area: 'profile', href: '/biz/profile' },
    { key: 'photos', name: 'שלוש תמונות של המקום', done: photos >= 3, area: 'profile', href: '/biz/profile', missing: Math.max(0, 3 - photos) },
    { key: 'waze', name: 'קישור Waze', done: !!b.wazeUrl?.trim(), area: 'profile', href: '/biz/profile' },
  ];
  if (b.hasMedicalCategory) {
    tasks.push({ key: 'medical', name: 'אחראי רפואי מוצהר', done: !!b.medicalResponsibleId, area: 'profile', href: '/biz/profile' });
  }
  tasks.push({ key: 'reviews', name: 'תגובה לביקורות פתוחות', done: b.openReviews === 0, area: 'reviews', href: '/biz/reviews', missing: b.openReviews });
  return tasks;
}

export const completionPct = (tasks: Task[]) => (tasks.length ? Math.round((tasks.filter(t => t.done).length / tasks.length) * 100) : 0);
