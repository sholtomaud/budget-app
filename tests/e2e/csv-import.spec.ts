/**
 * Bank and accounting CSVs (SPEC §6.3, FR-ING-019…022, FR-SETUP-004, ADR
 * 0030). Every file is made up and carries the synthetic marker.
 */
import { expect, test, type Page } from './fixtures.ts';

const MARK = '# x-synthetic: generator=csv-import.spec';
const csv = (rows: string[][]) => [MARK, ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n';
const file = (name: string, text: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
});

/** CommBank's layout: no header; date, signed amount, description, balance. */
const CBA = csv([
  ['01/03/2026', '+2500.00', 'SALARY EMPLOYER PTY LTD', '+3500.00'],
  ['02/03/2026', '-45.10', 'GROCER LANE NORTHTOWN', '+3454.90'],
  ['02/03/2026', '-4.50', 'HARBOUR CAFE', '+3450.40'],
  ['02/03/2026', '-4.50', 'HARBOUR CAFE', '+3445.90'],
  ['05/03/2026', '-1200.00', 'TRANSFER TO SAVINGS', '+2245.90'],
]);

/** A layout no preset knows, headers in another language. */
const HEAD = ['Datum', 'Betrag', 'Text', 'Rubrik', 'Art', 'Beleg'];
const ROWS = [
  ['03/02/2026', '-45.10', 'GROCER LANE NORTHTOWN', 'Lebensmittel', 'Karte', 'K-1001'],
  ['04/02/2026', '2500.00', 'SALARY EMPLOYER', 'Einkommen', 'Gutschrift', 'K-1002'],
  ['05/02/2026', '-60.00', 'CORNER FUEL EASTVALE', 'Auto', 'Karte', 'K-1003'],
  ['06/02/2026', '-12.50', 'BOOK NOOK BAYVIEW', 'Freizeit', 'Lastschrift', 'K-1004'],
  ['07/02/2026', '-80.00', 'CITY POWER', 'Wohnen', 'Lastschrift', 'K-1005'],
];
const TRUTH = ['date', 'amount', 'description', 'category', 'type', 'reference'];
const layout = (order: number[]) =>
  csv([order.map((i) => HEAD[i]!), ...ROWS.map((r) => order.map((i) => r[i]!))]);

const card = (page: Page) => page.locator('.csv-map');
const column = (page: Page, j: number) => card(page).locator(`select[data-column="${j}"]`);

test('a CommBank CSV: preset columns, preview, import, reconcile; re-import is a no-op', async ({
  page,
}) => {
  await page.goto('import');
  await page.locator('.pick-files').setInputFiles(file('CSVData.csv', CBA));
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.csv-source')).toContainText('CommBank');
  await expect(column(page, 1)).toHaveValue('amount');
  await expect(column(page, 3)).toHaveValue('balance');
  await expect(card(page).locator('th .by').first()).toHaveText('preset');
  await expect(card(page).locator('.csv-table tbody tr')).toHaveCount(5);

  await card(page).getByLabel('Account').fill('Everyday');
  await card(page).getByLabel('Account').blur();
  const summary = card(page).locator('.csv-summary');
  await expect(summary).toContainText('5 transactions in Everyday');
  await expect(summary).toContainText('can be reconciled');
  await expect(summary.locator('.prov')).toHaveText('illustrative');

  await card(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(card(page)).toBeHidden();
  await expect(page.locator('.last-summary')).toContainText('CSVData.csv: 5 new');
  await expect(page.locator('tr[data-account="CSV-EVERYDAY"]')).toContainText(
    'Reconciled over 1 period'
  );

  await page.locator('.pick-files').setInputFiles(file('CSVData.csv', CBA));
  await card(page).getByLabel('Account').fill('Everyday');
  await card(page).getByLabel('Account').blur();
  await card(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.last-summary')).toContainText(': 0 new, 5 duplicate');
  await expect(page.locator('table.history tbody tr')).toHaveCount(1);

  await page.goto('ledger');
  await expect(page.getByText('GROCER LANE NORTHTOWN')).toBeVisible();
});

test('an unknown layout: the mapper suggests, the user corrects, and it learns (FR-ING-021)', async ({
  page,
}) => {
  await page.goto('import');
  await page.locator('.pick-files').setInputFiles(file('konto.csv', layout([0, 1, 2, 3, 4, 5])));
  await expect(card(page).locator('.csv-source')).toContainText('the column mapper');
  await expect(column(page, 0)).toHaveValue('date');
  await expect(card(page).locator('th .by').first()).toContainText('suggested (');
  await expect(card(page).getByLabel('Column 1 (Datum)')).toBeVisible();

  for (const [j, f] of TRUTH.entries()) await column(page, j).selectOption(f);
  await expect(card(page).locator('th .by', { hasText: 'changed by you' }).first()).toBeVisible();
  await expect(card(page).locator('.csv-summary')).toContainText('5 transactions in konto');
  await card(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.last-summary')).toContainText('konto.csv: 5 new');

  // The same columns in another order: the retrained mapper gets them right.
  const order = [5, 4, 3, 2, 1, 0];
  await page.locator('.pick-files').setInputFiles(file('konto-2.csv', layout(order)));
  await expect(card(page).locator('.csv-source')).toContainText('the column mapper');
  for (const [j, i] of order.entries()) await expect(column(page, j)).toHaveValue(TRUTH[i]!);
  await card(page).getByRole('button', { name: 'Skip this file' }).click();
  await expect(card(page)).toBeHidden();

  // The first layout is remembered, also after a reload.
  await page.reload();
  await page.locator('.pick-files').setInputFiles(file('konto-3.csv', layout([0, 1, 2, 3, 4, 5])));
  await expect(card(page).locator('.csv-source')).toContainText('a layout you used before');
  await expect(card(page).locator('th .by').first()).toHaveText('remembered');
  for (const [j, f] of TRUTH.entries()) await expect(column(page, j)).toHaveValue(f);
});

test('a CSV without dates or amounts says so and cannot be imported', async ({ page }) => {
  await page.goto('import');
  await page.locator('.pick-files').setInputFiles(
    file(
      'notes.csv',
      csv([
        ['Item', 'Notes'],
        ['Rent', 'monthly'],
      ])
    )
  );
  await expect(card(page).locator('.csv-summary')).toContainText('budget sheet');
  await expect(card(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('setup by chatting: a bank CSV with buttons only (FR-SETUP-002, FR-SETUP-004)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const chat = page.locator('chat-page');
  const lastReply = chat.locator('.msg.reply').last();
  await page.goto('chat');
  await expect(lastReply).toContainText('What do you have?');
  await chat.locator('.suggestions').getByRole('button', { name: 'A bank CSV' }).click();
  await expect(lastReply).toContainText('Choose the CSV files your bank gave you');
  await chat.getByLabel('Choose CSV files').setInputFiles(file('CSVData.csv', CBA));
  await expect(lastReply).toContainText('Import these?', { timeout: 30_000 });
  const found = chat.locator('.msg.reply', { hasText: 'Here is what I found' });
  await expect(found).toContainText('5 transactions in CSVData');
  await expect(found).toContainText('columns from CommBank');

  await chat.locator('.suggestions').getByRole('button', { name: 'Import them' }).click();
  await expect(chat.locator('.msg.reply', { hasText: 'Imported 5 new transactions' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(lastReply).toContainText('Do you have a budget spreadsheet?');
});
