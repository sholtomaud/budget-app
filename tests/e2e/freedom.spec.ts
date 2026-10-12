import { expect, test } from './fixtures.ts';

test('freedom: Monte-Carlo on GSSK, metrics and a reproducibility record (FR-SIM-002…005, FR-GOAL)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);

  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Freedom' })
    .click();
  await expect(page.getByRole('heading', { name: 'Freedom', level: 1 })).toBeVisible();
  // Defaults come from the data: the savings account is a cash holding at its balance.
  await expect(page.locator('table.holdings tbody tr').first()).toBeVisible();
  await expect(page.locator('table.holdings .prov').first()).toHaveText('actual');
  await expect(page.locator('.tax-note .prov')).toHaveText('assumed');

  // A shorter horizon and 200 runs keep the test quick.
  await page.getByLabel('Years of freedom').fill('20');
  await page.getByLabel('Years of freedom').dispatchEvent('change');
  await page.getByLabel('Runs').selectOption('200');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.locator('.run .status')).toContainText('200 runs of', { timeout: 120_000 });

  await expect(page.locator('.psuccess')).toHaveText(/\d+ %/);
  await expect(page.locator('.fn-det')).toHaveText(/\$/);
  await expect(page.locator('.fn-det-note .prov')).toHaveText('assumed');
  await expect(page.locator('fan-chart.capital svg polygon.outer')).toBeVisible();
  await expect(page.locator('fan-chart.capital svg polyline.path')).toHaveCount(20);
  await expect(page.locator('fan-chart.capital svg line.floor')).toHaveCount(1);
  await expect(page.locator('.tiers tbody tr')).toHaveCount(3);
  await expect(page.locator('.tiers tbody td').last()).toHaveText(/%/, { timeout: 60_000 });

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // FR-SIM-004: the record names the pinned kernel and the inputs.
  await page.getByText('Reproducibility').click();
  await expect(page.locator('.record dl')).toContainText('5.3.0');
  await expect(page.locator('.record dl')).toContainText('Inputs hash');

  // The setup persists across a reload (IndexedDB).
  await page.reload();
  await expect(page.getByLabel('Years of freedom')).toHaveValue('20');
});
