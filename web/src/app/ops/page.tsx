import { redirect } from 'next/navigation';
import { isStaff, staffHome } from '@/components/ops/guard';
import { currentUser } from '@/lib/server/session';

// /ops is the admin's address: staff go to their first screen, everyone else to the staff login.
export default async function OpsHome() {
  const user = await currentUser();
  redirect(user && isStaff(user) ? staffHome(user) : '/ops/login');
}
