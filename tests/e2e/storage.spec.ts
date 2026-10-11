import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** Every row of the app's IndexedDB, as text (to check what is stored at rest). */
const rawDb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('budget-app');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['imports', 'kv']);
          const a = tx.objectStore('imports').getAll();
          const b = tx.objectStore('kv').getAll();
          tx.oncomplete = () => {
            resolve(
              JSON.stringify([a.result, b.result], (_k, v) =>
                typeof v === 'bigint' ? String(v) : v
              )
            );
            db.close();
          };
        };
      })
  );

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name }).click();

test('storage: encrypt at rest, lock, export, delete all, import (NFR-STO-002…004)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  expect(await rawDb(page)).toContain('SYN-TXN');

  // Turn encryption on.
  await nav(page, 'Settings');
  const enable = page.getByRole('form', { name: 'Turn on encryption' });
  await enable.getByLabel('Passphrase').fill('correct horse battery');
  await enable.getByLabel('Again').fill('correct horse battery');
  await enable.getByRole('button', { name: 'Turn on encryption' }).click();
  await expect(page.locator('.encryption .msg')).toContainText('Encryption is on', {
    timeout: 30_000,
  });
  const stored = await rawDb(page);
  expect(stored).not.toContain('SYN-TXN');
  expect(stored).toContain('$sealed');

  // A reload locks it; a wrong passphrase is refused.
  await page.reload();
  const lock = page.locator('lock-screen');
  await expect(lock.getByRole('heading', { name: 'Your data is locked' })).toBeVisible();
  await lock.getByLabel('Passphrase', { exact: true }).fill('wrong passphrase');
  await lock.getByRole('button', { name: 'Unlock' }).click();
  await expect(lock.locator('.error')).toContainText('not right', { timeout: 30_000 });
  await lock.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
  await lock.getByRole('button', { name: 'Unlock' }).click();
  await expect(lock.getByRole('heading', { name: 'Your data is locked' })).toBeHidden({
    timeout: 30_000,
  });
  await nav(page, 'Transactions');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  const rowsBefore = await page.locator('.count, .summary').first().textContent();

  // Export.
  await nav(page, 'Settings');
  const exp = page.getByRole('form', { name: 'Export', exact: true });
  await exp.getByLabel('File passphrase').fill('export passphrase');
  await exp.getByLabel('Again').fill('export passphrase');
  const download = page.waitForEvent('download');
  await exp.getByRole('button', { name: 'Export' }).click();
  const file = await (await download).path();
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.toString('latin1')).not.toContain('SYN-TXN');

  // Delete everything.
  const del = page.getByRole('form', { name: 'Delete all data' });
  await del.getByLabel(/Type/).fill('DELETE');
  await del.getByRole('button', { name: 'Delete all data' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  expect(await rawDb(page)).not.toContain('SYN-TXN');
  await expect(page.locator('lock-screen .backdrop')).toBeHidden();

  // Import the export into the fresh (unencrypted) app.
  await nav(page, 'Settings');
  const imp = page.getByRole('form', { name: 'Import an export' });
  await imp.getByLabel('File', { exact: true }).setInputFiles(file);
  await imp.getByLabel('File passphrase').fill('export passphrase');
  await imp.getByLabel('Replace everything on this device').check();
  await imp.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.import .msg')).toContainText('Restored', { timeout: 30_000 });
  await page.waitForLoadState('load');
  await nav(page, 'Transactions');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  if (rowsBefore) await expect(page.locator('.count, .summary').first()).toHaveText(rowsBefore);
  expect(await rawDb(page)).toContain('SYN-TXN');
});

test('storage: change passphrase, lock now, turn encryption off', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/settings');
  const enable = page.getByRole('form', { name: 'Turn on encryption' });
  await enable.getByLabel('Passphrase').fill('first passphrase');
  await enable.getByLabel('Again').fill('first passphrase');
  await enable.getByRole('button', { name: 'Turn on encryption' }).click();
  await expect(page.locator('.encryption .msg')).toContainText('Encryption is on', {
    timeout: 30_000,
  });

  const change = page.getByRole('form', { name: 'Change passphrase' });
  await change.getByLabel('Current').fill('first passphrase');
  await change.getByLabel('New').fill('second passphrase');
  await change.getByLabel('Again').fill('second passphrase');
  await change.getByRole('button', { name: 'Change passphrase' }).click();
  await expect(page.locator('.encryption .msg')).toContainText('Passphrase changed', {
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Lock now' }).click();
  const lock = page.locator('lock-screen');
  await expect(lock.getByRole('heading', { name: 'Your data is locked' })).toBeVisible();
  await lock.getByLabel('Passphrase', { exact: true }).fill('second passphrase');
  await lock.getByRole('button', { name: 'Unlock' }).click();
  await expect(lock.getByRole('heading', { name: 'Your data is locked' })).toBeHidden({
    timeout: 30_000,
  });

  const disable = page.getByRole('form', { name: 'Turn off encryption' });
  await disable.getByLabel('Passphrase').fill('second passphrase');
  await disable.getByRole('button', { name: 'Turn off encryption' }).click();
  await expect(page.locator('.encryption .msg')).toContainText('Encryption is off', {
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.locator('lock-screen .backdrop')).toBeHidden();
  await expect(page.locator('.encryption .status')).toContainText('Off');
});
