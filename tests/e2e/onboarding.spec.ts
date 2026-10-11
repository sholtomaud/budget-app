import { expect, test } from '@playwright/test';

test('landing page explains the app in plain words, and the guide walks through the screens', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Crux/);
  await expect(page.getByRole('heading', { name: 'Crux', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What Crux does' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your data stays with you' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add my data' })).toBeVisible();

  // Before any data, the guide's first step is to add some.
  const guide = page.getByRole('complementary', { name: 'Getting started' });
  await expect(guide).toContainText('step 1 of 7');
  await expect(guide).toContainText('Add your data');

  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(guide).toContainText('Check your transactions');
  await guide.getByRole('link', { name: 'Show me' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeVisible();

  // On a step's own screen the guide explains it and offers the next one.
  await expect(guide).toContainText('step 2 of 7');
  await guide.getByRole('link', { name: 'Next: Compare with your budget' }).click();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(guide).toContainText('step 3 of 7');

  // Progress survives a reload; hiding the guide hides it until it is shown again.
  await page.reload();
  await expect(guide).toContainText('step 3 of 7');
  await guide.getByRole('button', { name: 'Hide guide' }).click();
  await expect(guide).toBeHidden();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Start the guide again' }).click();
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('step 2 of 7');
});
