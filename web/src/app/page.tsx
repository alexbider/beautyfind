import { redirect } from 'next/navigation';

// The public homepage is a later phase. Until then the root sends visitors to the business funnel.
export default function Home() {
  redirect('/for-business');
}
