import { expect, test, type Page } from '@playwright/test';

async function loadDefault(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
}

async function importSheets(page: Page) {
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Budget' })
    .click();
  await page
    .locator('.pick-csv')
    .setInputFiles([
      'fixtures/syn-default-42/workbook/opex-budget.csv',
      'fixtures/syn-default-42/workbook/capex-register.csv',
    ]);
  const opex = page.locator('.wizard .sheet[data-file="opex-budget.csv"]');
  await expect(opex.getByLabel('Sheet type')).toHaveValue('opex');
  // FR-ING-014: the preview checks totals against the sheet's own totals row.
  await expect(opex.locator('tr[data-tier="secure"]')).toContainText('within 0.5 %');
  await expect(opex.locator('tr[data-tier="luxury"]')).toContainText('within 0.5 %');
  await opex.getByRole('button', { name: /^Import \d+ rows/ }).click();
  const capex = page.locator('.wizard .sheet[data-file="capex-register.csv"]');
  await expect(capex.getByLabel('Sheet type')).toHaveValue('capex');
  await capex.getByRole('button', { name: /^Import/ }).click();
  await expect(page.locator('.sheets li')).toHaveCount(2);
}

test('import the budget workbook and see actual vs budget by tier (FR-ING-010…014, FR-BUD-001)', async ({
  page,
}) => {
  await loadDefault(page);
  await importSheets(page);
  await expect(page.locator('.opex-budget')).not.toHaveText('–');
  const secure = await page.locator('.opex-budget').textContent();
  await page.getByLabel('Luxury', { exact: true }).check();
  await expect(page.locator('.opex-budget')).not.toHaveText(secure!);
  await expect(page.locator('table.vs tbody tr[data-category="food.groceries"]')).toBeVisible();
  // Drill down to the category's transactions.
  await page.getByLabel('Year', { exact: true }).check();
  await page.locator('tr[data-category="food.groceries"] a').click();
  await expect(page).toHaveURL(/\/ledger\?category=food\.groceries$/);
  await expect(page.locator('.filters select[name="category"]')).toHaveValue('food.groceries');
  await expect(page.locator('table.txns tbody tr').first()).toContainText(/grocer|fresh|corner/i);

  // Re-importing the same sheet replaces its lines rather than duplicating them.
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Budget' })
    .click();
  await page.locator('.pick-csv').setInputFiles('fixtures/syn-default-42/workbook/opex-budget.csv');
  await page
    .locator('.wizard .sheet')
    .getByRole('button', { name: /^Import/ })
    .click();
  await expect(page.locator('.sheets li')).toHaveCount(2);
  await page.locator('.lines-card summary').click();
  await expect(page.locator('table.lines tbody tr')).toHaveCount(7);
});

test('CAPEX register: replacement windows, sinking fund, tiers, wish-list decisions (FR-CAP-001…005)', async ({
  page,
}) => {
  await loadDefault(page);
  await importSheets(page);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Big purchases' })
    .click();
  await expect(page.locator('.sinking')).toHaveText(/\$[\d,.]+ a week/);
  const laptop = page.locator('table.register tr[data-asset="Laptop"]');
  await expect(laptop).toContainText('years left on average');
  await expect(page.locator('.timeline svg rect.bar').first()).toBeVisible();

  // Moving the laptop to the luxury tier removes it from the secure tier's CAPEX.
  const secureCapex = page.locator('.tier-totals tr[data-tier="secure"] td').nth(1);
  const before = await secureCapex.textContent();
  await laptop.getByLabel('Lowest tier that includes Laptop').selectOption('luxury');
  await expect(secureCapex).not.toHaveText(before!);

  // A wish-list decision: drop the watch.
  const watch = page.locator('table.register tr[data-asset="Watch"]');
  await watch.getByLabel('Decision for Watch').selectOption('drop');
  await expect(watch.getByLabel('Decision for Watch')).toHaveValue('drop');

  // A new item without a life gets the category default, marked assumed (FR-CAP-005).
  await page.locator('details', { hasText: 'Add an item' }).locator('summary').click();
  const form = page.locator('form.add-asset');
  await form.getByLabel('Name').fill('Camera');
  await form.getByLabel('Category').selectOption('capex.photography');
  await form.getByLabel('Bought on').fill('2025-01-15');
  await form.getByLabel('Cost').fill('2400');
  await form.getByRole('button', { name: 'Add' }).click();
  const camera = page.locator('table.register tr[data-asset="Camera"]');
  await expect(camera).toContainText('assumed');
  await expect(camera.getByLabel('Expected life of Camera')).toHaveValue('6');
  await page.reload();
  await expect(page.locator('table.register tr[data-asset="Camera"]')).toBeVisible();
});
