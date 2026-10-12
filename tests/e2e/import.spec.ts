import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));

async function accountRows(page: Page) {
  return page.locator('table.accounts tbody tr');
}

test('try synthetic data: generate, import, reconcile, and persist across reloads (M1)', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await expect(page.locator('.persona-desc')).toContainText('2 years of bank data');
  await page.getByText('Advanced').click();
  await page.getByLabel('Seed').fill('42');
  await page.getByRole('button', { name: 'Load sample household' }).click();

  await expect(page).toHaveURL(/\/import$/);
  await expect(page.locator('.last-summary')).toContainText('Synthetic: default (seed 42)');
  await expect(page.locator('.last-summary .prov')).toHaveText('illustrative');
  const rows = await accountRows(page);
  await expect(rows).toHaveCount(3);
  for (const id of ['SYN-TXN', 'SYN-SAV', 'SYN-CC']) {
    await expect(page.locator(`tr[data-account="${id}"]`)).toContainText(
      'Reconciled over 24 periods'
    );
  }
  await expect(page.locator('tr[data-account="SYN-CC"]')).toContainText('credit');

  await page.reload();
  await expect(await accountRows(page)).toHaveCount(3);
  await expect(page.locator('table.history tbody tr')).toHaveCount(1);
});

test('import a folder of CDR files; re-import is a no-op; undo removes it (FR-ING-006)', async ({
  page,
}) => {
  await page.goto('import');
  await expect(page.locator('.empty')).toBeVisible();
  await page.locator('.pick-folder').setInputFiles(fixture('syn-frugal-renter-42'));
  await expect(page.locator('.last-summary')).toContainText('new');
  await expect(await accountRows(page)).toHaveCount(2);
  await expect(page.locator('tr[data-account="SYN-TXN"]')).toContainText(
    'Reconciled over 24 periods'
  );
  // The truth file, manifest and workbook CSVs are not CDR transaction data.
  await expect(page.locator('table.files tr[data-status="skipped"]')).toHaveCount(5);

  await page.locator('.pick-folder').setInputFiles(fixture('syn-frugal-renter-42'));
  await expect(page.locator('.last-summary')).toContainText(': 0 new');
  await expect(page.locator('table.history tbody tr')).toHaveCount(1);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /^Undo import/ }).click();
  await expect(page.locator('.empty')).toBeVisible();
  await expect(page.locator('table.history')).toBeHidden();
});

test('a missing page is reported as a reconciliation gap (FR-REC-001)', async ({ page }) => {
  await page.goto('import');
  const dir = fixture('syn-default-42');
  const files = [`${dir}/accounts.json`];
  for (const b of readdirSync(`${dir}/balances`)) files.push(`${dir}/balances/${b}`);
  for (const a of ['SYN-TXN', 'SYN-SAV', 'SYN-CC']) {
    for (const p of readdirSync(`${dir}/transactions/${a}`)) {
      if (!(a === 'SYN-CC' && p === 'page-4.json')) files.push(`${dir}/transactions/${a}/${p}`);
    }
  }
  await page.locator('.pick-files').setInputFiles(files);
  await expect(page.locator('tr[data-account="SYN-CC"] .warn')).toContainText('gap');
  await expect(page.locator('tr[data-account="SYN-TXN"]')).toContainText('Reconciled');
});

test('an invalid file is rejected with the failing path; the rest of the batch imports', async ({
  page,
}) => {
  await page.goto('import');
  const bad = {
    data: {
      transactions: [
        {
          accountId: 'SYN-X',
          isDetailAvailable: false,
          type: 'PAYMENT',
          status: 'POSTED',
          description: 'X',
          amount: 'ten',
          reference: '',
        },
      ],
    },
    links: { self: 'x' },
    meta: {},
  };
  await page.locator('.pick-files').setInputFiles([
    { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) },
    {
      name: 'accounts.json',
      mimeType: 'application/json',
      buffer: readFileSync(fixture('syn-default-42/accounts.json')),
    },
  ]);
  const rejected = page.locator('table.files tr[data-status="rejected"]');
  await expect(rejected).toContainText('$.data.transactions[0].amount is not a valid AmountString');
  await expect(page.locator('table.files tr[data-status="imported"]')).toHaveCount(1);
});
