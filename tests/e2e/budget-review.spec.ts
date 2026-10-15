/** Review my budget: alerts, then cards that change the budget, with Undo (ADR 0038). Made-up data. */
import { expect, test } from './fixtures.ts';

test('the Budget screen asks the chat to review the budget; a change is a card with Undo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Budget' }).click();
  await page.locator('.pick-csv').setInputFiles('fixtures/syn-default-42/workbook/opex-budget.csv');
  await page
    .locator('.wizard .sheet')
    .getByRole('button', { name: /^Import \d+ rows/ })
    .click();
  await expect(page.locator('.wizard .sheet')).toHaveCount(0);

  await page.getByRole('button', { name: 'Review my budget' }).click();
  const panel = page.locator('chat-panel');
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply.locator('.who')).toHaveText('Crux · on this device');
  await expect(reply).toContainText('Budget review');
  // No full run yet: the plan alert says so.
  await expect(reply).toContainText('Plan: no full run yet');

  // The seeded household spends less on cafes than budgeted: lowered half way.
  await expect(reply).toContainText('Lower Cafes and coffee to $80 a month');
  // An essential under budget is said, never cut.
  await expect(reply).toContainText('An essential that has cost well under its budget');
  await reply.getByRole('button', { name: 'Change budget' }).click();
  await expect(reply.locator('.result')).toHaveText(
    'Budget changed. Run your plan to see what it does to your chance.'
  );
  await reply.getByRole('button', { name: 'Undo' }).click();
  await expect(reply.locator('.result')).toHaveText('Undone.');

  // Applied for real, the next review holds the category.
  await panel.getByLabel('Your message').fill('Review my budget');
  await panel.getByRole('button', { name: 'Send' }).click();
  const again = panel.locator('.msg.reply').last();
  await expect(again).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await again.getByRole('button', { name: 'Change budget' }).click();
  await panel.getByLabel('Your message').fill('Review my budget');
  await panel.getByRole('button', { name: 'Send' }).click();
  const third = panel.locator('.msg.reply').last();
  await expect(third).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(third).toContainText('Changed recently, so left for now: Cafes and coffee.');
});
