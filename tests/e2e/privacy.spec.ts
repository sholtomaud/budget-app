import { expect, test } from '@playwright/test';

/** NFR-PRIV-003: with all APIs off, nothing leaves the app origin. */
test('no request goes outside the app origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin) foreign.push(req.url());
  });

  await page.goto('/');
  await expect(page.locator('.kstate')).toHaveText(/verified/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  for (const link of await nav.getByRole('link').all()) await link.click();
  // The engine check is linked from Settings, not the nav.
  await page.getByRole('link', { name: 'Simulation engine check' }).click();
  await page.getByRole('button', { name: 'Run example' }).click();
  await expect(page.locator('.result')).toHaveAttribute('data-ready', 'true');

  expect(foreign).toEqual([]);
});
