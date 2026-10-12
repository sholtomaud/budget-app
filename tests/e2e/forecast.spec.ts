import { expect, test } from './fixtures.ts';

test('forecast fans per category and for capital spend, on the ml-core kernels (FR-FC-001, FR-FC-010)', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Household').selectOption('high-capex-crypto');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);

  // Put the confirmed CAPEX proposals into the register so capital spend has something to forecast.
  await page.goto('ledger?tab=capex');
  const confirm = page.getByRole('button', { name: 'Confirm asset' });
  await expect(confirm.first()).toBeVisible();
  const n = await confirm.count();
  for (let i = 0; i < Math.min(n, 3); i++) await confirm.first().click();

  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Forecast' })
    .click();
  await expect(page.locator('forecast-page .status')).toContainText(
    'kernels: ml-core, WebAssembly',
    {
      timeout: 30_000,
    }
  );
  await expect(page.locator('table.methods tbody tr').first()).toBeVisible();
  await expect(page.locator('fan-chart.total svg polygon.outer')).toBeVisible();
  await expect(page.locator('fan-chart.total .prov')).toHaveText('forecast');
  await expect(page.locator('.capex-note')).toContainText('items in the CAPEX register');
  await expect(page.locator('.fans fan-chart').first()).toBeVisible();
  // With long histories and no budget, the tier changes nothing, and the screen says so.
  await expect(page.locator('forecast-page .tier-note')).toContainText(
    'The tier makes no difference here'
  );

  // A history that dips below zero (a month that took in more than it spent)
  // stays inside the chart: the axis extends below $0.
  const inside = await page.locator('fan-chart.total').evaluate((el) => {
    const chart = el as HTMLElement & { data: unknown };
    chart.data = {
      history: { months: ['2026-01', '2026-02', '2026-03'], values: [300000, -250000, 150000] },
      months: ['2026-04', '2026-05'],
      quantiles: {
        p5: [100000, 100000],
        p25: [200000, 200000],
        p50: [300000, 300000],
        p75: [400000, 400000],
        p95: [500000, 500000],
      },
      provenance: 'forecast',
      label: 'Test',
    };
    const svg = el.querySelector('svg')!;
    const [, , , h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const ys = [...svg.querySelectorAll('polyline, polygon')].flatMap((p) =>
      p
        .getAttribute('points')!
        .trim()
        .split(/\s+/)
        .map((xy) => Number(xy.split(',')[1]))
    );
    return ys.every((y) => y >= 0 && y <= h!);
  });
  expect(inside).toBe(true);

  // The Bayesian model (ADR 0022): it converges on the sample household and
  // shows its checks; the total's range allows for categories moving together.
  const model = page.locator('.model-card');
  await expect(model.getByRole('heading', { name: 'How sure is this?' })).toBeVisible();
  await expect(model.locator('.model-summary')).toContainText('Checked and in use');
  await expect(page.locator('.total-note')).toContainText('categories moving together');
  await expect(model.locator('.model-checks')).toContainText('Sampler checks');
  await expect(model.locator('.model-checks')).toContainText('Tested on the last months', {
    timeout: 60_000,
  });
  await expect(model.locator('.model-checks')).toContainText('Depends on assumptions?');
  await expect(model.locator('.model-checks')).toContainText('Sense check');
  await model.screenshot({ path: test.info().outputPath('model-panel.png') });

  // Nominal dollars are larger than real ones further out.
  const real = await page.locator('.total-note').textContent();
  await page.getByLabel(/Of the day/).check();
  await expect(page.locator('.total-note')).not.toHaveText(real!);
  await expect(page.locator('.total-note')).toContainText('dollars of the day');

  await page.getByLabel('Horizon').selectOption('60');
  await expect(page.locator('fan-chart.total svg')).toHaveAttribute(
    'aria-label',
    /60-month forecast/
  );
});
