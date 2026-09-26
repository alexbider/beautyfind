// Visual check of a Business Profile at the three template widths (feature request, acceptance 12):
// 390px (phone), 768px (tablet) and 1440px (desktop), with the services accordion open, the lightbox,
// the contact popup and the mobile sticky bar. Needs a running site (next dev or next start) and a
// listing URL. Writes PNGs to the given directory. Nothing is asserted beyond the page loading; the
// images are for a person to compare against the design files.
//
//   npm run import:screenshots -- --url http://localhost:3000/dan/nails/some-listing --out /tmp/shots

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const url = arg('url');
  const out = arg('out') ?? join(process.cwd(), '.data', 'screenshots');
  if (!url) throw new Error('--url is required');
  mkdirSync(out, { recursive: true });
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CRAWL_CHROMIUM_PATH || undefined });
  const shots: string[] = [];
  const consent = JSON.stringify({ essential: true, analytics: false, embeds: true });
  for (const [name, width, height] of [['phone-390', 390, 844], ['tablet-768', 768, 1024], ['desktop-1440', 1440, 900]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'he-IL', deviceScaleFactor: 1, hasTouch: width < 768, isMobile: width < 768 });
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['bf-cookie-consent', consent] as const);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(600);
    const file = (suffix: string) => join(out, `${name}-${suffix}.png`);
    await page.screenshot({ path: file('full'), fullPage: true });
    shots.push(file('full'));
    // Services accordion: open the second group when there is one, so both states are visible.
    const toggles = page.locator('section[aria-labelledby="h-services"] button[aria-expanded]');
    if ((await toggles.count()) > 1) {
      await toggles.nth(1).click();
      await page.waitForTimeout(300);
      await page.locator('#h-services').screenshot({ path: file('services-heading') }).catch(() => {});
      await page.screenshot({ path: file('services-open'), fullPage: false });
      shots.push(file('services-open'));
    }
    // Lightbox from the first gallery tile.
    const tile = page.locator('section[aria-label="תמונות העסק"] button').first();
    if (await tile.count()) {
      await tile.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: file('lightbox') });
      shots.push(file('lightbox'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    // Contact flow: the first quote or contact trigger.
    const trigger = page.locator('button[aria-haspopup="dialog"]').first();
    if (await trigger.count()) {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: file('contact') });
      shots.push(file('contact'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    // Mobile: sticky bar and section tabs after scrolling.
    if (width < 768) {
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(400);
      await page.screenshot({ path: file('sticky-bar') });
      shots.push(file('sticky-bar'));
    }
    await ctx.close();
  }
  await browser.close();
  console.log(shots.join('\n'));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
