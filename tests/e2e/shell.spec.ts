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
    'Dashboards',
    'Saved charts',
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
  // The advisor is the chat panel now (ADR 0023): its old address opens the panel.
  await page.goto('advisor');
  await expect(page.locator('chat-panel').getByRole('heading', { name: 'Ask Crux' })).toBeVisible();
  await page.goBack();
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

test('the menu: wide with names or a rail of icons, remembered; on phones a drawer (ADR 0040)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('budget');
  const nav = page.getByRole('navigation', { name: 'Screens' });
  const link = nav.getByRole('link', { name: 'Forecast' });
  await expect(link.locator('.label')).toBeVisible();
  const pin = page.getByRole('button', { name: 'Keep the menu open' });
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await pin.click();
  await expect(page.locator('body')).toHaveAttribute('data-nav', 'rail');
  await page.mouse.move(900, 400);
  const side = page.locator('app-nav .side');
  await expect.poll(async () => (await side.boundingBox())!.width).toBeLessThan(80);
  // Hovering opens it over the page, with names.
  await side.hover();
  await expect.poll(async () => (await side.boundingBox())!.width).toBeGreaterThan(150);
  // Still a named link for screen readers and keyboards, and it still works.
  await link.click();
  await expect(page).toHaveURL(/\/forecast$/);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-nav', 'rail');
  await page.getByRole('button', { name: 'Keep the menu open' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-nav', 'wide');

  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await expect(nav).toBeHidden();
  const burger = page.getByRole('button', { name: 'Menu', exact: true });
  await burger.click();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await burger.click();
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(nav).toBeHidden();
});

test.describe('a screen that will not load', () => {
  test.use({
    // One pattern: Playwright would read a second array element as fixture options.
    allowErrors: [
      /scenarios-page|dynamically imported module|Could not load the Scenarios screen|Failed to load resource/,
    ],
  });
  test('one reload for the new version, then a way out, never a dead click', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();
    // As after a deploy: this screen's file is gone.
    await page.route(/scenarios-page[^/]*\.js$/, (r) => r.fulfill({ status: 404, body: '' }));
    const nav = page.getByRole('navigation', { name: 'Screens' });
    await nav.getByRole('link', { name: 'Scenarios' }).click();
    await expect(page).toHaveURL(/\/scenarios$/);
    await expect(page.getByRole('heading', { name: "Scenarios couldn't open" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    // Other screens still open.
    await nav.getByRole('link', { name: 'Budget' }).click();
    await expect(page.getByRole('heading', { name: 'Budget', level: 1 })).toBeVisible();
  });
});
