/** Plan checks (ADR 0026): the project owner's plan, found and fixed on Freedom and in the chat. */
import { expect, test, type Page } from './fixtures.ts';

test.use({ viewport: { width: 1400, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });

async function setField(page: Page, label: string, value: string) {
  const f = page.locator('freedom-page').getByLabel(label, { exact: true });
  await f.fill(value);
  await f.dispatchEvent('change');
}

test('plan checks: no pay before freedom and $700,000 kept in the bank are found, explained and fixed', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Freedom' }).click();
  const freedom = page.locator('freedom-page');
  await expect(page.getByRole('heading', { name: 'Freedom', level: 1 })).toBeVisible();

  // The default plan has nothing to flag as a problem.
  await expect(freedom.locator('.check-list li.problem')).toHaveCount(0);
  // The app's own exact amounts are valid input (no "nearest valid values" error).
  expect(
    await freedom
      .locator('input[type="number"]')
      .evaluateAll((xs) =>
        xs
          .filter((x) => !(x as HTMLInputElement).checkValidity())
          .map((x) => (x as HTMLInputElement).name)
      )
  ).toEqual([]);

  const start = freedom.getByLabel('Freedom starts');
  await start.fill('2042-07');
  await start.dispatchEvent('change');
  await setField(page, 'Take-home pay ($ a month)', '0');
  await setField(page, 'Cash kept in the bank ($)', '700000');

  const checks = freedom.locator('.checks');
  await expect(checks.locator('[data-check="no-pay"]')).toContainText(
    'No pay comes in before freedom starts in July 2042'
  );
  await expect(checks.locator('[data-check="idle-bank"]')).toContainText('$700,000');
  await expect(checks.locator('[data-check="all-cash"]')).toContainText('licensed adviser');
  if (process.env.SHOT) await checks.screenshot({ path: process.env.SHOT });

  // Fix one on the Freedom screen, then undo it.
  await checks.getByRole('button', { name: 'Start freedom now' }).click();
  // Freedom now starts at the data's latest month, well before 2042.
  await expect(start).toHaveValue(/^20(2|3)\d-\d\d$/);
  await checks.getByRole('button', { name: 'Undo' }).click();
  await expect(start).toHaveValue('2042-07');

  // The chat finds the same problems first, and offers the fixes as cards.
  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('Why is it low?');
  await panel.getByRole('button', { name: 'Send' }).click();
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 120_000 });
  await expect(reply.locator('.body')).toContainText('No pay comes in before freedom starts');
  const card = reply.locator('.proposal[data-kind="setup"]').filter({ hasText: 'Keep' });
  await expect(card).toContainText('moved from the bank buffer to a savings holding');
  await card.getByRole('button', { name: 'Change my plan' }).click();
  await expect(card.locator('.result')).toHaveText(
    'Your plan is changed. Run it on Freedom to see the difference.'
  );
  // The Freedom screen shows the change made from the chat.
  await expect(freedom.getByLabel('Cash kept in the bank ($)', { exact: true })).not.toHaveValue(
    '700000'
  );
  await expect(checks.locator('[data-check="idle-bank"]')).toHaveCount(0);
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(freedom.getByLabel('Cash kept in the bank ($)', { exact: true })).toHaveValue(
    '700000'
  );
});
