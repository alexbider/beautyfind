import type { Metadata } from 'next';
import { OpsHeader } from '@/components/ops/OpsHeader';
import { OPS_ROLE_NAMES, requireVerifier } from '@/components/ops/guard';
import { loadQueue } from './data';
import { VerificationConsole } from './VerificationConsole';
import styles from './verification.module.css';

export const metadata: Metadata = {
  title: 'תור אימות',
  robots: { index: false, follow: false },
};

export default async function VerificationPage() {
  const user = await requireVerifier('/ops/verification');
  const items = await loadQueue();
  const reviewer = user.fullName ?? user.email ?? 'צוות BeautyFind';

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <OpsHeader current="verification" who={`${reviewer} · ${OPS_ROLE_NAMES[user.opsRole!]}`} />
      <VerificationConsole items={items} />
    </div>
  );
}
