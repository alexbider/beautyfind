// Invoicing provider interface. Clinics issue their own tax documents (חשבונית מס/קבלה, credit notes)
// through the provider they already use; BeautyFind only asks it to issue and stores the result.

export interface InvoiceLine {
  description: string;
  qty: number;
  unitAgorot: number; // before VAT
}

export interface IssueRequest {
  type: 'tax_invoice_receipt' | 'credit_note';
  customer: { name: string; phone?: string | null; email?: string | null };
  lines: InvoiceLine[];
  vatRate: number;
  payment?: { method: 'card'; last4?: string; installments?: number };
  referencesNumber?: string; // for credit notes
  sendTo?: string | null; // provider emails the document
}

export interface IssueResult {
  number: string;
  providerRef: string;
  pdfUrl: string | null;
}

export interface InvoiceAdapter {
  verify(credentials: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }>;
  issue(credentials: Record<string, string>, req: IssueRequest): Promise<IssueResult>;
}
