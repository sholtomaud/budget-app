import { expect, test } from './fixtures.ts';

test('start screen loads with the privacy statement and a verified kernel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Crux', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your data stays with you' })).toBeVisible();
  await expect(page.locator('.kstate')).toHaveText(/GSSK 5\.3\.0, SHA-256 verified/);
  expect(errors).toEqual([]);
});

test('every asset the page links to loads: icons, manifest, scripts, styles', async ({ page }) => {
  // The browser fetches favicons outside the page, so the page guard cannot
  // see a missing one: request each linked URL directly.
  await page.goto('./');
  const urls = await page.evaluate(() =>
    [
      ...[...document.querySelectorAll<HTMLLinkElement>('link[href]')].map((l) => l.href),
      ...[...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => s.src),
    ].filter((u) => u.startsWith(location.origin))
  );
  expect(urls.length).toBeGreaterThan(2);
  for (const url of urls) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(200);
  }
});

test('every SPEC §12 screen is reachable from the nav', async ({ page }) => {
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Screens' });
  const labels = [
    'Import',
    'Transactions',
    'Budget',
    'Big purchases',
    'Forecast',
    'Freedom',
    'Scenarios',
    'Advisor',
    'Settings',
  ];
  for (const label of labels) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#router-outlet h1').first()).toBeVisible();
    // Screens still to come say which milestone delivers them.
    const placeholder = page.locator('placeholder-page .milestone');
    if (await placeholder.count()) await expect(placeholder).toHaveText(/^M\d/);
  }
  // The engine check is a technical screen: linked from Settings, not in the nav.
  await page.getByRole('link', { name: 'Simulation engine check' }).click();
  await expect(page.getByRole('heading', { name: 'Engine check' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
});

test('deep links render the right screen; unknown paths say not found', async ({ page }) => {
  await page.goto('ledger');
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await page.goto('no-such-screen');
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
});

test('theme toggle switches and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await page.getByRole('button', { name: 'Toggle colour theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
