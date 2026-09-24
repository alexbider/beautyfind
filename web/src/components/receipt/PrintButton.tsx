'use client';

/** Opens the browser print dialog (print view, or "save as PDF"). */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      הדפסה או PDF
    </button>
  );
}
