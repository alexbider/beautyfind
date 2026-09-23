import { appIcon } from '@/lib/ui/app-icon';

export const size = { width: 48, height: 48 };
export const contentType = 'image/png';

export default function Icon() {
  return appIcon(48, { radius: 10 });
}
