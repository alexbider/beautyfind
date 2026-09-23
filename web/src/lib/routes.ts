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
  listingStandards: '/listing-standards',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',
  accessibility: '/accessibility',
  help: '/help',
} as const;

export const joinWithPlan = (plan: 'basic' | 'advanced') => `${ROUTES.join}?plan=${plan}`;
