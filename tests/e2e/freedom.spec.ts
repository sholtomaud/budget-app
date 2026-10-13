import { expect, test } from './fixtures.ts';

test('freedom: one button runs everything, kept as a dated run (FR-SIM-002…005, FR-GOAL, FR-OPT-002, FR-OPT-007)', async ({
  page,
}) => {
  test.setTimeout(300_000);
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
  // One button: no separate Simulate, Find or Analyse.
  for (const name of ['Simulate', 'Find', 'Analyse'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run my plan' }).click();
  // The chance comes first, before the slower steps finish.
  await expect(page.locator('.psuccess')).toHaveText(/\d+ %/, { timeout: 60_000 });
  await expect(page.locator('.run .status')).toContainText('Done in', { timeout: 240_000 });
  await expect(page.locator('.steps li[data-state="done"]')).toHaveCount(6);

  await expect(page.locator('.psuccess')).toHaveText(/\d+ %/);
  await expect(page.locator('.fn-det')).toHaveText(/\$/);
  await expect(page.locator('.fn-det-note .prov')).toHaveText('assumed');
  await expect(page.locator('fan-chart.capital svg polygon.outer')).toBeVisible();
  await expect(page.locator('fan-chart.capital svg polyline.path')).toHaveCount(20);
  await expect(page.locator('fan-chart.capital svg line.floor')).toHaveCount(1);
  await expect(page.locator('.tiers tbody tr')).toHaveCount(3);
  await expect(page.locator('.tiers tbody td').last()).toHaveText(/%/);
  await expect(page.locator('table.drivers tbody tr').first()).toBeVisible();
  await expect(page.locator('.fn-p90')).toContainText('At 90 %');
  await expect(page.locator('.plans .plans-note')).toContainText('start dates');
  await expect(page.locator('.run-list li')).toHaveCount(1);

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // FR-SIM-004: the record names the pinned kernel and the inputs.
  await page.getByText('Reproducibility').click();
  await expect(page.locator('.record dl')).toContainText('5.3.0');
  await expect(page.locator('.record dl')).toContainText('Inputs hash');

  // The setup and the run persist across a reload (IndexedDB), and the run is shown again.
  await page.reload();
  await expect(page.getByLabel('Years of freedom')).toHaveValue('20');
  await expect(page.locator('.last-run')).toContainText('Run ');
  await expect(page.locator('.last-run')).toHaveAttribute('data-stale', 'false');
  await expect(page.locator('.psuccess')).toHaveText(/\d+ %/);
  await expect(page.locator('.run-list li')).toHaveCount(1);

  // Changing a setting marks the shown run as out of date.
  await page.getByLabel('Years of freedom').fill('25');
  await page.getByLabel('Years of freedom').dispatchEvent('change');
  await expect(page.locator('.last-run')).toHaveAttribute('data-stale', 'true');
  await expect(page.locator('.last-run')).toContainText('run your plan again');

  // Stop keeps what finished; the second run is compared with the first.
  await page.getByRole('button', { name: 'Run my plan' }).click();
  await expect(page.locator('.steps li[data-step="chance"]')).toHaveAttribute(
    'data-state',
    'done',
    {
      timeout: 60_000,
    }
  );
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.run .status')).toContainText('Stopped after', { timeout: 120_000 });
  await expect(page.locator('.run-list li')).toHaveCount(2);
  await expect(page.locator('.run-list li').first()).toContainText('stopped early');
  await expect(page.locator('.last-run')).toContainText('since the run before');
});
