import { expect, test, type Page } from '@playwright/test';

async function loadSynthetic(page: Page, persona = 'default') {
  await page.goto('/');
  await page.getByLabel('Household').selectOption(persona);
  await page.getByRole('button', { name: 'Generate and load' }).click();
  await expect(page).toHaveURL(/\/import$/);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Ledger' })
    .click();
  await expect(page.locator('table.txns tbody tr').first()).toBeVisible();
}

const reviewCount = async (page: Page) =>
  Number(
    (await page.getByRole('tab', { name: /Review queue/ }).textContent())!
      .match(/\(([\d,]+)\)/)![1]!
      .replace(/,/g, '')
  );

test('correct one transaction and apply it to similar ones (FR-CLS-001); it persists', async ({
  page,
}) => {
  await loadSynthetic(page);
  await page.getByRole('tab', { name: /Review queue/ }).click();
  const before = await reviewCount(page);
  expect(before).toBeGreaterThan(50);

  // The largest group comes first: the weekly rent direct debit.
  const first = page.locator('table.txns tbody tr').first();
  await expect(first).toContainText('HARBOURSIDE REALTY');
  await first.locator('td.cat select').selectOption('housing.rent');
  const dialog = page.locator('dialog.correct-dialog');
  await expect(dialog).toContainText('similar transactions from this merchant can follow');
  await dialog.locator('button.apply-similar').click();

  await expect.poll(() => reviewCount(page)).toBeLessThan(before - 100);
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByLabel('Search').fill('harbourside');
  const rows = page.locator('table.txns tbody tr');
  await expect(rows.first().locator('td.cat select')).toHaveValue('housing.rent');
  await expect(rows.first().locator('td.src')).toContainText(/you|remembered/);

  await page.reload();
  await page.getByLabel('Search').fill('harbourside');
  await expect(page.locator('table.txns tbody tr').first().locator('td.cat select')).toHaveValue(
    'housing.rent'
  );
  await expect(page.locator('.memory li')).toContainText(['HARBOURSIDE REALTY']);
});

test('confirm a CAPEX proposal as an asset, reject another (FR-CLS-002)', async ({ page }) => {
  await loadSynthetic(page, 'high-capex-crypto');
  await page.getByRole('tab', { name: /CAPEX proposals/ }).click();
  const rows = page.locator('table.txns tbody tr');
  const n = await rows.count();
  expect(n).toBeGreaterThan(2);
  const laptop = rows.filter({ hasText: 'Bytewise' }).first();
  await laptop.getByRole('button', { name: 'Confirm asset' }).click();
  await expect(rows).toHaveCount(n - 1);
  await rows.first().getByRole('button', { name: 'Not capital' }).click();
  await expect(rows).toHaveCount(n - 2);

  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByLabel('Search').fill('bytewise');
  await expect(page.locator('table.txns tbody tr', { hasText: 'Asset:' }).first()).toBeVisible();
});

test('bulk re-categorise and a rule (FR-CLS-004 keeps user labels)', async ({ page }) => {
  await loadSynthetic(page);
  await page.getByLabel('Search').fill('syn-broker');
  const rows = page.locator('table.txns tbody tr');
  await expect(rows.first()).toBeVisible();
  await page.getByLabel('Select all shown').check();
  await expect(page.locator('.bulk')).toBeVisible();
  await page.locator('.bulk-category').selectOption('investment.broker');
  await page.locator('.bulk-apply').click();
  await expect(rows.first().locator('td.cat select')).toHaveValue('investment.broker');
  await expect(rows.first().locator('td [data-kind]').first()).toHaveText('investment');

  // A rule cannot override what the user set.
  await page.getByLabel('Search').fill('telcoast');
  const tel = page.locator('table.txns tbody tr').first();
  await tel.locator('td.cat select').selectOption('comms.internet');
  await page.locator('dialog.correct-dialog').getByRole('button', { name: 'Make a rule…' }).click();
  const ruleDialog = page.locator('dialog.rule-dialog');
  await expect(ruleDialog.getByLabel('Merchant contains')).toHaveValue(/TELCOAST/);
  await ruleDialog.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.locator('.rules li')).toHaveCount(1);
  await expect(tel.locator('td.src')).toContainText('rule');
  await expect(tel.locator('td.cat select')).toHaveValue('comms.internet');
});
