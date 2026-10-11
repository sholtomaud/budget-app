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
  for (const [label, milestone] of [
    ['Ledger', 'M2'],
    ['Budget', 'M3'],
    ['CAPEX', 'M3'],
    ['Forecast', 'M4'],
    ['Freedom', 'M5'],
    ['Scenarios', 'M6'],
    ['Advisor', 'M8'],
    ['Settings', 'M7'],
  ]) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(page.locator('placeholder-page .milestone')).toContainText(milestone!);
  }
  await nav.getByRole('link', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/advisor$/);
  await expect(page.getByRole('heading', { name: 'Advisor' })).toBeVisible();
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
