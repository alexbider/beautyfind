import assert from 'node:assert/strict';
import test from 'node:test';
import { emailBody, renderMessage } from '../../src/lib/messages/render';
import { nextSendable } from '../../src/lib/sendWindow';

const il = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

test('service messages wait for 08:00 and stop at 21:00', () => {
  assert.equal(il(nextSendable(new Date('2026-11-03T03:00:00Z'), 'service')), 'Tue 08:00'); // 05:00 Israel
  assert.equal(il(nextSendable(new Date('2026-11-03T10:00:00Z'), 'service')), 'Tue 12:00');
  assert.equal(il(nextSendable(new Date('2026-11-03T19:30:00Z'), 'service')), 'Wed 08:00'); // 21:30 Israel
  assert.equal(il(nextSendable(new Date('2026-11-07T10:00:00Z'), 'service')), 'Sat 12:00'); // service still goes on Saturday
});

test('marketing skips Shabbat, holidays and their eves', () => {
  assert.equal(il(nextSendable(new Date('2026-11-06T13:00:00Z'), 'marketing')), 'Sun 08:00'); // Friday 15:00
  assert.equal(il(nextSendable(new Date('2026-11-06T09:00:00Z'), 'marketing')), 'Fri 11:00'); // Friday morning is fine
  assert.equal(il(nextSendable(new Date('2027-04-21T13:00:00Z'), 'marketing')), 'Fri 08:00'); // Pesach eve afternoon, then Pesach
});

test('new templates render with links and the claim invite carries an unsubscribe link', () => {
  const site = 'https://beautyfind.co.il';
  for (const t of ['M6_review_request', 'M15_gift_expiry', 'M23_payment_failed', 'M22_sponsored_approved', 'M22_sponsored_rejected', 'M22_sponsored_started', 'M22_sponsored_ended', 'M_onboard_welcome', 'M_onboard_profile', 'M_onboard_card']) {
    const r = renderMessage(t, { name: 'נועה', business: 'סטודיו', link: `${site}/x`, days: '30', amount: '200 ₪', expires: '01/01/2027', step: '0' }, site);
    assert.ok(r, t);
    assert.ok(r!.sms.includes(`${site}/x`) || t === 'M22_sponsored_started', `${t} sms has link`);
    assert.ok(!r!.sms.includes('undefined') && !r!.lines.join(' ').includes('undefined'), t);
    assert.ok(!emailBody(r!).html.includes('להסרה'), `${t} is a service message`);
  }
  const inv = renderMessage('M_claim_invite', { business: 'סטודיו', link: `${site}/for-business/claim?branch=1`, unsubscribe: `${site}/unsubscribe/abc` }, site)!;
  assert.ok(inv.sms.includes('/unsubscribe/abc'));
  assert.ok(emailBody(inv).html.includes('/unsubscribe/abc'));
  assert.ok(emailBody(inv).text.includes('/unsubscribe/abc'));
});
