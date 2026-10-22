/** Several changes from one answer on one card: tick, Select all, Apply selected, Undo all (ADR 0042). */
import { expect, test, type Route } from './fixtures.ts';

test.use({ viewport: { width: 1400, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });

test('the AI proposes several changes; the person picks some, applies them together and undoes them all', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
  const call = (id: string, name: string, args: unknown) =>
    chunk({
      model: 'gemini-3.8-flash',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
  let n = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    n++;
    const sse =
      n === 1
        ? call('c1', 'propose_budget_line', {
            item: 'Swimming lessons',
            amountDollars: 30,
            period: 'w',
            categoryHint: null,
            lastMonth: null,
          })
        : n === 2
          ? call('c2', 'propose_budget_line', {
              item: 'Streaming service',
              amountDollars: 18,
              period: 'm',
              categoryHint: null,
              lastMonth: null,
            })
          : n === 3
            ? call('c3', 'propose_big_purchase', {
                name: 'washing machine',
                costDollars: 900,
                ageYears: 4,
              })
            : chunk({
                choices: [
                  {
                    delta: { content: 'Three changes are ready for you to apply.' },
                    finish_reason: 'stop',
                  },
                ],
              });
    await route.fulfill({ contentType: 'text/event-stream', body: `${sse}data: [DONE]\n\n` });
  });

  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();
  await nav.getByRole('link', { name: 'Budget' }).click();
  await page.locator('.lines-card summary').click();
  const lines = page.locator('table.lines tbody tr');
  const before = await lines.count();

  const panel = page.locator('chat-panel');
  await panel
    .getByLabel('Your message')
    .fill('Set up my swimming, streaming and the washing machine');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  const batch = reply.locator('.proposal-batch');
  await expect(batch.locator('.proposal')).toHaveCount(3);
  const all = batch.getByLabel('Select all');
  await expect(all).toBeChecked();
  await expect(batch.locator('.count')).toHaveText('3 of 3 selected');

  // Untick the big purchase: Select all shows it's partly ticked.
  await batch.getByLabel('Include change 3').uncheck();
  await expect(all).not.toBeChecked();
  await expect(batch.locator('.count')).toHaveText('2 of 3 selected');
  // Select all from partly ticked ticks everything; again clears everything.
  await all.check();
  await expect(batch.locator('.count')).toHaveText('3 of 3 selected');
  await all.uncheck();
  await expect(batch.locator('.count')).toHaveText('0 of 3 selected');
  await expect(batch.getByRole('button', { name: 'Apply selected' })).toBeDisabled();
  await all.check();
  await batch.getByLabel('Include change 3').uncheck();

  await batch.getByRole('button', { name: 'Apply selected' }).click();
  await expect(batch.locator('.result')).toHaveText('Applied 2 changes.');
  await expect(lines).toHaveCount(before + 2);
  await expect(page.locator('table.lines')).toContainText('Swimming lessons');

  await batch.getByRole('button', { name: 'Undo all' }).click();
  await expect(batch.locator('.result')).toHaveText('All undone.');
  await expect(lines).toHaveCount(before);
});
