import type { ShellTab } from '@/lib/ui/shell';

// 24px outline icons for the bottom tab bar; the active tab gets the filled variant.
const PATHS: Record<ShellTab['icon'], { d: string[]; fill?: string[] }> = {
  home: { d: ['M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z'] },
  search: { d: ['M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'm20 20-4.8-4.8'] },
  heart: { d: ['M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z'] },
  calendar: { d: ['M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M4 10.5h16', 'M8.5 3.5v4', 'M15.5 3.5v4'] },
  more: { d: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'], fill: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'] },
  chart: { d: ['M4 20h16', 'M7 20v-6', 'M12 20V8', 'M17 20v-9'] },
  inbox: { d: ['M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20'] },
  star: { d: ['m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z'] },
  store: { d: ['M4.5 9 6 4.5h12L19.5 9', 'M4.5 9h15v1.5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0z', 'M6 12.5V20h12v-7.5', 'M10 20v-4.5h4V20'] },
  sun: { d: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M12 2.8v2', 'M12 19.2v2', 'M2.8 12h2', 'M19.2 12h2', 'm5.5 5.5 1.4 1.4', 'm17.1 17.1 1.4 1.4', 'm5.5 18.5 1.4-1.4', 'm17.1 6.9 1.4-1.4'] },
  consult: { d: ['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M8.5 10.5h7'] },
  clock: { d: ['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z', 'M12 8v4.5l3 1.8'] },
  gift: { d: ['M4.5 10h15v3h-15z', 'M6 13h12v7H6z', 'M12 10v10', 'M12 10C10 6 7 6.5 7.5 8.5 8 10 12 10 12 10zm0 0c2-4 5-3.5 4.5-1.5C16 10 12 10 12 10z'] },
};

export function TabIcon({ name, active }: { name: ShellTab['icon']; active: boolean }) {
  const p = PATHS[name];
  const filled = active && name !== 'search' && name !== 'more' && name !== 'chart' && name !== 'clock';
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      {p.d.map(d => <path key={d} d={d} />)}
    </svg>
  );
}
