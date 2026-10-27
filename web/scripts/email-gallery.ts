// Renders every email template with sample data into one review page. Usage: npx tsx scripts/email-gallery.ts <out.html>
import { writeFileSync } from 'node:fs';
import { emailBody, renderMessage } from '../src/lib/messages/render';
import { SAMPLES } from '../src/lib/messages/samples';

const out = process.argv[2] ?? 'email-gallery.html';
const items = SAMPLES.map(s => {
  const r = renderMessage(s.id, s.vars, 'https://beautyfind.co.il');
  if (!r) throw new Error(`no template ${s.id}`);
  return { ...s, subject: r.subject, preheader: r.preheader ?? '', sms: r.sms, html: emailBody(r).html };
});
writeFileSync(out, JSON.stringify(items));
console.log(items.length, 'templates');
