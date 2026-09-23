import type { Area } from '@/lib/permissions';

export type DashView = Area | 'team';

export const DASH_VIEWS: Array<{ key: DashView; name: string; href: string }> = [
  { key: 'overview', name: 'סקירה', href: '/biz' },
  { key: 'analytics', name: 'אנליטיקת פרופיל', href: '/biz/analytics' },
  { key: 'profile', name: 'עריכת פרופיל', href: '/biz/profile' },
  { key: 'menu', name: 'תפריט מחירים', href: '/biz/menu' },
  { key: 'reviews', name: 'ביקורות', href: '/biz/reviews' },
  { key: 'leads', name: 'ניהול לקוחות · CRM', href: '/biz/leads' },
  { key: 'billing', name: 'מנוי וחשבונות', href: '/biz/billing' },
  { key: 'team', name: 'צוות והרשאות', href: '/biz/team' },
];
