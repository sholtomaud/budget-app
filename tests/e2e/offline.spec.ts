import { expect, test } from '@playwright/test';

test('works offline after first load, including the kernel (NFR-STO-005)', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('.kstate')).toHaveText(/verified/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })
      );
    }
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Freedom capital, measured' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Kernel' })
    .click();
  await expect(page.locator('.k-status')).toHaveText('SHA-256 matches the pin');
  await page.getByRole('button', { name: 'Run example' }).click();
  await expect(page.locator('.result')).toHaveAttribute('data-ready', 'true');

  // A deep link typed while offline is served the cached shell.
  await page.goto('/budget');
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible();
});
