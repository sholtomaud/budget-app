/** "Run my plan" from the chat, built in and as the AI's tool (FR-OPT-002, FR-OPT-007, ADR 0032). */
import type { Route } from '@playwright/test';
import { expect, test, type Page } from './fixtures.ts';

test.use({
  viewport: { width: 1400, height: 900 },
  contextOptions: { reducedMotion: 'reduce' },
});

async function loadSample(page: Page) {
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
}

const freedomHistory = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Freedom' })
    .click();
  return page.locator('.run-list li');
};

test('the chat runs the whole plan on the device and keeps it in History', async ({ page }) => {
  test.setTimeout(300_000);
  await loadSample(page);
  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('Run my plan');
  await panel.getByRole('button', { name: 'Send' }).click();
  const reply = panel.locator('.msg.reply').first();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 240_000 });
  await expect(reply.locator('.who')).toHaveText('Crux · on this device');
  await expect(reply.locator('.body')).toContainText('Your plan works');
  await expect(reply.locator('.body')).toContainText('History');
  await expect(reply.locator('.meter')).toBeVisible();
  await expect(panel.locator('.msg.activity').first()).toContainText('Ran every step');

  // Savings over time, from that run: a fan with the floor.
  await panel.getByLabel('Your message').fill('Chart my savings over time');
  await panel.getByRole('button', { name: 'Send' }).click();
  const fan = panel.locator('.msg.reply').nth(1);
  await expect(fan).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(fan.locator('.body')).toContainText('In the typical future your savings go from');
  await expect(fan.locator('chat-chart svg polygon.band')).toHaveCount(2);
  await expect(fan.locator('chat-chart .legend')).toContainText('9 in 10 futures');
  await expect(fan.locator('chat-chart figcaption')).toContainText('From your run of');

  const runs = await freedomHistory(page);
  await expect(runs).toHaveCount(1);
  await expect(page.locator('.last-run')).toContainText('Run ');
  await expect(page.locator('.priors-text')).not.toContainText('Worked out when');
  await expect(page.locator('table.drivers tbody tr').first()).toBeVisible();
});

test('the AI calls run_my_plan and reads the results, including the spending model’s checks', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const bodies: Record<string, unknown>[] = [];
  const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const sse =
      bodies.length === 1
        ? chunk({
            model: 'gemini-3.8-flash',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'run_my_plan', arguments: JSON.stringify({ runs: 200 }) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
        : chunk({
            choices: [{ delta: { content: 'I ran your whole plan.' }, finish_reason: 'stop' }],
          });
    await route.fulfill({ contentType: 'text/event-stream', body: `${sse}data: [DONE]\n\n` });
  });

  await loadSample(page);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();

  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('Give my finances a full health check please');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 240_000 });
  await expect(reply.locator('.who')).toHaveText('Crux + Google Gemini');
  await expect(reply.locator('.meter')).toBeVisible();

  // The model was told about the tools, and got rounded results back.
  expect(JSON.stringify(bodies[0])).toContain('run_my_plan');
  expect(JSON.stringify(bodies[0])).toContain('get_plan_history');
  const result = (bodies[1]!.messages as { role: string; content: string }[]).find(
    (m) => m.role === 'tool'
  )!.content;
  const facts = JSON.parse(result) as Record<string, unknown>;
  expect(facts.chanceOfSuccess).toMatch(/^\d+ %$/);
  expect(facts).toHaveProperty('shortfallDrivers');
  expect(facts).toHaveProperty('earliest');
  expect(facts).toHaveProperty('spendingForecast');
  expect(facts.finished).toBe('every step');

  const runs = await freedomHistory(page);
  await expect(runs).toHaveCount(1);
});
