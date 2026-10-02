// Production routes (01-flows.md). Import these instead of hardcoding paths.

export const ROUTES = {
  home: '/',
  forBusiness: '/for-business',
  pricing: '/for-business#pricing',
  join: '/for-business/join',
  claim: '/for-business/claim',
  login: '/login',
  bizLogin: '/login?role=biz',
  dashboard: '/biz',
  account: '/account',
  listingStandards: '/listing-standards',
  sponsorship: '/listing-standards/sponsorship',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',
  accessibility: '/accessibility',
  help: '/help',
  search: '/search',
  treatments: '/treatments',
  methodology: '/about/methodology',
  saved: '/saved',
  giftCheck: '/gift/check',
  branches: '/biz/branches',
  sponsoredBuy: '/biz/sponsored',
} as const;

export const joinWithPlan = (plan: 'basic' | 'advanced') => `${ROUTES.join}?plan=${plan}`;

/** Account, saved, claim and the "more" tab are app screens, not pages to index: links to them carry rel="nofollow". */
export const NOFOLLOW_PATHS = ['/account', '/saved', '/for-business/claim', '/more'] as const;
export const relFor = (href: string): 'nofollow' | undefined =>
  NOFOLLOW_PATHS.some(p => href === p || href.startsWith(`${p}?`) || href.startsWith(`${p}/`) || href.startsWith(`${p}#`)) ? 'nofollow' : undefined;
