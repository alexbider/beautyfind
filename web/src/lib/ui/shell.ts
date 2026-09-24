// App shell rules (docs: responsive spec §1, §2). Shared by server and client code.
//
// Breakpoints (CSS media queries only, never measured widths):
//   xs 0 · sm 480 · md 768 · lg 1024 · xl 1280
// The app shell (top bar, bottom tab bar, sticky action bar) shows below 768px, and below 1024px on
// touch devices. A narrow desktop window keeps the website layout. CSS repeats the same query:
//   @media (max-width: 767px), (max-width: 1023px) and (hover: none)
export const SHELL_MQ = '(max-width: 767px), (max-width: 1023px) and (hover: none)';
export const SHEET_MQ = '(max-width: 767px)'; // popovers become bottom sheets below md

export type ShellVariant = 'client' | 'business' | 'clinic' | 'staff';

export interface ShellTab {
  key: string;
  label: string;
  href: string;
  icon: 'home' | 'search' | 'heart' | 'calendar' | 'more' | 'chart' | 'inbox' | 'star' | 'store' | 'sun' | 'consult' | 'clock' | 'gift';
  /** Paths (prefixes) that belong to this tab's stack. */
  match: string[];
  badge?: 'waitlist' | 'leads' | 'consults';
}

export const TABS: Record<Exclude<ShellVariant, 'staff'>, ShellTab[]> = {
  client: [
    { key: 'home', label: 'בית', href: '/', icon: 'home', match: ['/'] },
    {
      key: 'search', label: 'חיפוש', href: '/search', icon: 'search',
      match: ['/search', '/treatments', '/dan', '/sharon', '/haifa', '/jerusalem', '/shfela', '/north', '/south', '/pro'],
    },
    { key: 'saved', label: 'מועדפים', href: '/saved', icon: 'heart', match: ['/saved'] },
    { key: 'appts', label: 'התורים שלי', href: '/account', icon: 'calendar', match: ['/account', '/b/', '/receipt', '/w/'], badge: 'waitlist' },
    {
      key: 'more', label: 'עוד', href: '/more', icon: 'more',
      match: ['/more', '/help', '/about', '/listing-standards', '/privacy', '/terms', '/accessibility', '/contact', '/gift/check', '/for-business', '/magazine', '/unsubscribe', '/offline'],
    },
  ],
  business: [
    { key: 'overview', label: 'סקירה', href: '/biz', icon: 'chart', match: ['/biz'] },
    { key: 'leads', label: 'פניות', href: '/biz/leads', icon: 'inbox', match: ['/biz/leads'], badge: 'leads' },
    { key: 'reviews', label: 'ביקורות', href: '/biz/reviews', icon: 'star', match: ['/biz/reviews'] },
    { key: 'profile', label: 'פרופיל', href: '/biz/profile', icon: 'store', match: ['/biz/profile', '/biz/menu'] },
    { key: 'more', label: 'עוד', href: '/biz/more', icon: 'more', match: ['/biz/more', '/biz/team', '/biz/analytics', '/biz/billing', '/biz/payments'] },
  ],
  // Interim set until the Noa Clinic back office (calendar, customers, messages) exists.
  clinic: [
    { key: 'today', label: 'היום', href: '/clinic', icon: 'sun', match: ['/clinic'] },
    { key: 'consults', label: 'ייעוצים', href: '/clinic/consults', icon: 'consult', match: ['/clinic/consults'], badge: 'consults' },
    { key: 'waitlist', label: 'המתנה', href: '/clinic/waitlist', icon: 'clock', match: ['/clinic/waitlist'] },
    { key: 'gifts', label: 'שוברים', href: '/clinic/gift-cards', icon: 'gift', match: ['/clinic/gift-cards'] },
    { key: 'more', label: 'עוד', href: '/clinic/more', icon: 'more', match: ['/clinic/more'] },
  ],
};

/** Focused flows own the screen: no tab bar, a close (×) in the top bar. */
const FOCUSED: RegExp[] = [
  /^\/book\//,
  /^\/consult\//,
  /^\/b\/[^/]+\/declaration/,
  /^\/pay\//,
  /^\/gift\/[^/]+$/, // buying a gift card (not /gift/check)
  /^\/for-business\/(join|claim)/,
  /^\/invite\//,
  /^\/login/,
  /^\/ops\/(login|setup)/,
  /^\/logout/,
  /^\/review\//,
  /^\/waitlist\//,
  /^\/w\//,
];

export function isFocused(path: string) {
  if (path === '/gift/check') return false;
  return FOCUSED.some(r => r.test(path));
}

export function variantFor(path: string): ShellVariant {
  if (path.startsWith('/ops')) return 'staff';
  if (path === '/biz' || path.startsWith('/biz/')) return 'business';
  if (path === '/clinic' || path.startsWith('/clinic/')) return 'clinic';
  return 'client';
}

/** Which tab a path belongs to: the longest matching prefix wins. */
export function tabFor(tabs: ShellTab[], path: string): ShellTab | undefined {
  let best: { tab: ShellTab; len: number } | undefined;
  for (const tab of tabs) {
    for (const m of tab.match) {
      const hit = m === '/' ? path === '/' : path === m || path.startsWith(m.endsWith('/') ? m : m + '/') || path === m.replace(/\/$/, '');
      if (hit && (!best || m.length > best.len)) best = { tab, len: m.length };
    }
  }
  // Region / directory / profile pages ("/sharon/raanana", "/sharon/biz/x") belong to search.
  if (!best && /^\/[a-z-]+(\/|$)/.test(path)) return tabs.find(t => t.key === 'search');
  return best?.tab;
}

/** A tab root shows the wordmark; anything deeper is a pushed screen with a back button. */
export function isTabRoot(tabs: ShellTab[], path: string) {
  return tabs.some(t => t.href === path);
}
