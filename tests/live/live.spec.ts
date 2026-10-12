/**
 * Smoke test of the deployed site (run by CI after each deploy, against the
 * live URL). The page guard fails on any 4xx/5xx from the site, any uncaught
 * error and any console error; every test saves a screenshot.
 */
import { expect, test } from '../e2e/fixtures.ts';

test('the app loads: built bundle, verified kernel, nothing missing', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Crux', level: 1 })).toBeVisible();
  await expect(page.locator('.kstate')).toHaveText(/GSSK 5\.3\.0, SHA-256 verified/, {
    timeout: 30_000,
  });
  const html = await page.content();
  expect(html, 'the built page, not the source index.html').not.toContain('src/main.ts');
  // Favicons are fetched outside the page, so request every linked asset directly.
  const urls = await page.evaluate(() =>
    [
      ...[...document.querySelectorAll<HTMLLinkElement>('link[href]')].map((l) => l.href),
      ...[...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => s.src),
    ].filter((u) => u.startsWith(location.origin))
  );
  for (const url of urls) expect((await page.request.get(url)).status(), url).toBe(200);
  await info.attach('start screen', { body: await page.screenshot(), contentType: 'image/png' });
});

test('a deep link loads its screen', async ({ page }, info) => {
  await page.goto('settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await info.attach('settings', { body: await page.screenshot(), contentType: 'image/png' });
});

test('the docs load', async ({ page }, info) => {
  await page.goto('docs/');
  await expect(page.getByRole('link', { name: 'Open the app' }).first()).toBeVisible();
  await info.attach('docs', { body: await page.screenshot(), contentType: 'image/png' });
});
