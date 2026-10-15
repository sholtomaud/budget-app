import { expect, test } from './fixtures.ts';

test('scenarios: save, compare side by side, and optimise (FR-OPT-001)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);

  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Freedom' }).click();
  await expect(page.locator('table.holdings tbody tr').first()).toBeVisible();
  const set = async (label: string, value: string) => {
    // Most settings sit under More settings (ADR 0043).
    if (!(await page.getByLabel(label).isVisible()))
      await page.locator('freedom-page details.more summary').click();
    await page.getByLabel(label).fill(value);
    await page.getByLabel(label).dispatchEvent('change');
  };
  await set('Years of freedom', '20');
  await page.getByLabel('Scenario name').fill('Base');
  await page.getByRole('button', { name: 'Save as scenario' }).click();
  await expect(page.locator('.run .status')).toContainText('Saved "Base"');
  await set('Spending after freedom (% of tier)', '80');
  await page.getByLabel('Scenario name').fill('Leaner');
  await page.getByRole('button', { name: 'Save as scenario' }).click();
  await expect(page.locator('.run .status')).toContainText('Saved "Leaner"');

  await nav.getByRole('link', { name: 'Scenarios' }).click();
  await expect(page.locator('.list tbody tr')).toHaveCount(2);
  await page.locator('.compare-form').getByLabel('Runs').selectOption('200');
  await page.getByRole('button', { name: 'Compare selected' }).click();
  await expect(page.locator('.cmp-status')).toContainText('2 scenarios', { timeout: 120_000 });
  const spendRow = page.locator('.compare-table tr', { hasText: 'Spending after freedom' });
  await expect(spendRow).toHaveClass(/differs/);
  await expect(spendRow).toContainText('80 %');
  await expect(page.locator('.compare-table tr', { hasText: 'Chance of success' })).toContainText(
    '%'
  );
  await expect(page.locator('.compare-table tr', { hasText: 'Runs' })).toContainText('seed 42');

  // The optimiser on two levers (grid search) with a small budget.
  await page.locator('.opt-form').getByLabel('Runs per candidate').selectOption('40');
  await page.locator('.opt-form').getByLabel('Simulations').selectOption('20');
  await page.getByRole('button', { name: 'Optimise' }).click();
  await expect(page.locator('.opt-status')).toContainText('plans simulated by grid search', {
    timeout: 180_000,
  });
  await expect(page.locator('.answer')).toHaveText(
    /Smallest change|No plan within these bounds|already reaches/
  );
  await expect(page.locator('.answer .runid')).toContainText('seed 42');
  await expect(page.locator('.pareto tbody tr').first()).toBeVisible();

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // Keep a trade-off as a scenario; it joins the saved list.
  await page.locator('.pareto tbody tr').first().getByRole('button', { name: 'Keep' }).click();
  await expect(page.locator('.list tbody tr')).toHaveCount(3);
  await expect(page.locator('.list tbody tr').last()).toContainText('Optimiser');

  // Open a scenario in the Freedom screen.
  await page
    .locator('.list tbody tr')
    .nth(1)
    .getByRole('button', { name: 'Open in Freedom' })
    .click();
  await expect(page).toHaveURL(/\/freedom$/);
  await expect(page.getByLabel('Spending after freedom (% of tier)')).toHaveValue('80');
});
