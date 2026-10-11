import { expect, test } from '@playwright/test';

test('start screen loads with the privacy statement and a verified kernel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Freedom capital, measured' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.locator('.kstate')).toHaveText(/GSSK 5\.3\.0, SHA-256 verified/);
  expect(errors).toEqual([]);
});

test('every SPEC §12 screen is reachable from the nav', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Screens' });
  const labels = [
    'Import',
    'Ledger',
    'Budget',
    'CAPEX',
    'Forecast',
    'Freedom',
    'Scenarios',
    'Advisor',
    'Settings',
    'Kernel',
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
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
});

test('deep links render the right screen; unknown paths say not found', async ({ page }) => {
  await page.goto('/ledger');
  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible();
  await page.goto('/no-such-screen');
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
});

test('theme toggle switches and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle colour theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
