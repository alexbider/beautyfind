import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { currentUser } from '@/lib/server/session';
import { loadDocument, ownsPayment, receiptForDocument } from '@/components/receipt/data';
import { ReceiptShell, ReceiptView } from '@/components/receipt/ReceiptView';
import { receiptSigValid } from '@/components/receipt/token';

// Design: project/BeautyFind Receipt.dc.html. /receipt/:doc shows ONE clinic document.
// Access: the signed-in client whose booking or payment it is, or a signed ?t= link (receiptUrl()).
// Anyone else gets a 404, never a hint that the document exists.

export const metadata: Metadata = {
  title: 'חשבונית',
  description: 'חשבונית מס / קבלה או חשבונית זיכוי מהקליניקה.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ReceiptDocPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ doc: docId }, sp] = await Promise.all([params, searchParams]);
  const found = await loadDocument(docId);
  if (!found) notFound();

  let allowed = receiptSigValid(found.doc.id, sp.t);
  let signedIn = false;
  if (!allowed) {
    const user = await currentUser();
    signedIn = !!user && user.kind === 'client';
    allowed = !!user && user.kind === 'client' && ownsPayment(found.payment, user);
  }
  if (!allowed) notFound();

  const data = await receiptForDocument(found.payment, found.doc.id);
  if (!data) notFound();

  return (
    <ReceiptShell back={signedIn ? { href: '/account', label: 'לחשבון שלי' } : { href: '/', label: 'ל־BeautyFind' }}>
      <ReceiptView data={data} />
    </ReceiptShell>
  );
}
