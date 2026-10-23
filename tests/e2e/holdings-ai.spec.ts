/** The AI sees each holding and every return model, and adds Bitcoin as its own holding (ADR 0048). Made-up data. */
import { expect, test, type Route } from './fixtures.ts';

test.use({ viewport: { width: 1400, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });

test('the AI reads holdings one by one, then offers Bitcoin as its own holding on a card', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
  const call = (id: string, name: string, args: unknown) =>
    chunk({
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
  const bodies: string[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    bodies.push(route.request().postData() ?? '');
    const n = bodies.length;
    const sse =
      n === 1
        ? call('c1', 'get_plan', {})
        : n === 2
          ? call('c2', 'propose_holding', {
              change: 'add',
              holding: null,
              kind: 'btc',
              valueDollars: 50_000,
              returnModel: 'btc',
              name: null,
            })
          : chunk({
              choices: [
                {
                  delta: { content: 'A card to add your Bitcoin is ready.' },
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

  const panel = page.locator('chat-panel');
  await panel
    .getByLabel('Your message')
    .fill('Ask the AI: how could we factor bitcoin into our assets?');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });

  // get_plan's result (in the second request) lists each holding by number and kind, and every
  // model, Bitcoin's included, never a holding's name.
  const plan = JSON.parse(bodies[1]!) as { messages: { role: string; content: string }[] };
  const result = JSON.parse(plan.messages.find((m) => m.role === 'tool')!.content) as {
    holdings: Record<string, unknown>[];
    returnModels: { id: string }[];
  };
  expect(result.holdings[0]).toMatchObject({ holding: 1 });
  expect(result.holdings.every((h) => !('name' in h))).toBe(true);
  expect(result.returnModels.map((m) => m.id)).toEqual(
    expect.arrayContaining(['btc', 'btc-bootstrap'])
  );

  // The card, applied: Bitcoin is its own holding on the Freedom screen.
  await expect(reply.locator('.proposal')).toContainText('Add Bitcoin');
  await reply
    .getByRole('button', { name: /^(Apply|Change my plan|Use)/ })
    .first()
    .click();
  await nav.getByRole('link', { name: 'Freedom' }).click();
  const kinds = page.locator('.holdings tbody select[aria-label^="Kind of"]');
  await expect(kinds.last()).toHaveValue('btc');
});
