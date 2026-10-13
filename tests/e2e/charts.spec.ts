/** Charts in the chat, saved charts and AI-designed charts (FR-VIZ-001…006, ADR 0028). */
import { readFileSync } from 'node:fs';
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

async function ask(page: Page, q: string) {
  const panel = page.locator('chat-panel');
  const before = await panel.locator('.msg.reply').count();
  await panel.getByLabel('Your message').fill(q);
  await panel.getByRole('button', { name: 'Send' }).click();
  const reply = panel.locator('.msg.reply').nth(before);
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 120_000 });
  return reply;
}

test('a chart asked for in words is drawn on the device, saved, downloaded and reopened', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin && !r.url().startsWith('data:')) foreign.push(r.url());
  });
  await loadSample(page);

  const reply = await ask(page, 'Chart my spending on groceries by month against the budget');
  await expect(reply.locator('.who')).toHaveText('Crux · on this device');
  const chart = reply.locator('chat-chart');
  await expect(chart.locator('.title')).toHaveText(
    'Spending on groceries by month, against the budget'
  );
  await expect(chart.locator('svg path')).toHaveCount(1);
  await expect(chart.locator('.legend')).toContainText('actual');
  // The sample household has no budget: the budget series is left out and the chart says so.
  await expect(chart.locator('.legend')).not.toContainText('budgeted');
  await expect(chart.locator('figcaption')).toContainText('there is no budget for this yet');

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    chart.getByRole('button', { name: 'CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe('spending-on-groceries-by-month-against-the-budget.csv');
  const text = readFileSync(await csv.path(), 'utf8');
  expect(text.split('\n')[0]).toBe(',"Spending (AUD, actual)"');
  const [svg] = await Promise.all([
    page.waitForEvent('download'),
    chart.getByRole('button', { name: 'SVG' }).click(),
  ]);
  const svgText = readFileSync(await svg.path(), 'utf8');
  expect(svgText).toContain('<svg');
  expect(svgText).not.toContain('var(--');
  const [png] = await Promise.all([
    page.waitForEvent('download'),
    chart.getByRole('button', { name: 'PNG' }).click(),
  ]);
  expect(
    readFileSync(await png.path())
      .subarray(1, 4)
      .toString()
  ).toBe('PNG');

  await chart.getByRole('button', { name: 'Save chart' }).click();
  await expect(chart.locator('.note')).toHaveText('Saved. Find it under Saved charts.');

  // "Where does my money go?" comes with its chart.
  const where = await ask(page, 'Where does my money go?');
  await expect(where.locator('chat-chart .title')).toHaveText('Spending by group, last 12 months');
  await expect(where.locator('chat-chart svg rect').first()).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Saved charts' })
    .click();
  await page.reload();
  const saved = page.locator('charts-page .list > li');
  await expect(saved).toHaveCount(1);
  await expect(saved.locator('.title')).toHaveText(
    'Spending on groceries by month, against the budget'
  );
  await expect(saved.getByRole('button', { name: 'Save chart' })).toHaveCount(0);
  await saved.getByRole('button', { name: "Show with today's data" }).click();
  await expect(saved.locator('.meta [role="status"]')).toHaveText("Today's data.");
  await saved.getByRole('button', { name: 'Show as saved' }).click();
  await saved.getByRole('button', { name: 'Delete' }).click();
  await expect(saved).toHaveCount(0);
  await expect(page.locator('charts-page .empty')).toBeVisible();
  expect(foreign).toEqual([]);
});

test('the AI designs a chart: it sends a spec, the app fills in the values', async ({ page }) => {
  test.setTimeout(180_000);
  const bodies: Record<string, unknown>[] = [];
  const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const spec = {
      kind: 'bar',
      title: '<b>Cafe visits</b> by month',
      caption: null,
      groupBy: 'month',
      series: [
        {
          label: 'Cafes',
          dataset: 'spending',
          measure: null,
          filter: {
            categories: ['cafes'],
            text: null,
            from: null,
            to: null,
            lastMonths: 6,
            nextMonths: null,
          },
        },
      ],
    };
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
                      function: { name: 'make_chart', arguments: JSON.stringify(spec) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
        : chunk({
            choices: [
              {
                delta: { content: 'Here is your cafe spending. You spent $9,999 on lattes.' },
                finish_reason: 'stop',
              },
            ],
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
  await panel
    .getByLabel('Your message')
    .fill('Can you draw how my coffee habit has changed lately?');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply.locator('.who')).toHaveText('Crux + Google Gemini');
  const chart = reply.locator('chat-chart');
  // Markup in the AI's title is shown as text, never parsed.
  await expect(chart.locator('.title')).toHaveText('<b>Cafe visits</b> by month');
  await expect(chart.locator('.title b')).toHaveCount(0);
  await expect(chart.locator('svg rect')).toHaveCount(6);
  // A figure the AI made up is flagged.
  await expect(reply.locator('.unverified')).toContainText('$9,999');

  // The AI saw the catalogue, never values; the tool result it got back is rounded facts.
  const first = JSON.stringify(bodies[0]);
  expect(first).toContain('make_chart');
  expect(first).not.toMatch(/SYN-[A-Z]/);
  const toolResult = (bodies[1]!.messages as { role: string; content: string }[]).find(
    (m) => m.role === 'tool'
  )!.content;
  expect(toolResult).toContain('"valuesAre":"totals per period"');
  expect(toolResult).toMatch(/"total":"~\$/);
});

/** The sample household's big purchases (its CAPEX register), from the Budget screen. */
async function importBigPurchases(page: Page) {
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Budget' })
    .click();
  await page
    .locator('.pick-csv')
    .setInputFiles('fixtures/syn-default-42/workbook/capex-register.csv');
  const capex = page.locator('.wizard .sheet[data-file="capex-register.csv"]');
  await expect(capex.getByLabel('Sheet type')).toHaveValue('capex');
  await capex.getByRole('button', { name: /^Import/ }).click();
  await expect(page.locator('.sheets li')).toHaveCount(1);
}

/** Settings → AI provider: Google Gemini with a test key. */
async function useGemini(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();
}

async function send(page: Page, q: string) {
  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill(q);
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
}

test('when can I make my big purchases: a timeline drawn on the device, ahead of today', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loadSample(page);
  await importBigPurchases(page);
  const reply = await ask(
    page,
    'Can you generate a chart which shows when I can make my big purchases into the future?'
  );
  await expect(reply.locator('.who')).toHaveText('Crux · on this device');
  const chart = reply.locator('chat-chart');
  await expect(chart.locator('.title')).toHaveText('Big purchases coming up by year');
  await expect(chart.locator('[data-prov="forecast"]')).toBeVisible();
  await expect(chart.locator('svg rect').first()).toBeVisible();
  const year = String(new Date().getFullYear());
  await expect(chart.locator('svg')).toContainText(year);
});

test('the AI charts big purchases: it asks for the dataset, the app fills in when and what', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const bodies: Record<string, unknown>[] = [];
  const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const spec = {
      kind: 'bar',
      title: 'What is coming up',
      caption: null,
      groupBy: 'year',
      series: [
        {
          label: 'Big purchases',
          dataset: 'big-purchases',
          measure: null,
          filter: {
            categories: null,
            text: null,
            from: null,
            to: null,
            lastMonths: null,
            nextMonths: 60,
          },
        },
      ],
    };
    const delta =
      bodies.length === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'make_chart', arguments: JSON.stringify(spec) },
              },
            ],
          }
        : { content: 'Here is what falls due over the next five years.' };
    const sse = chunk({
      model: 'gemini-3.8-flash',
      choices: [{ delta, finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop' }],
    });
    await route.fulfill({ contentType: 'text/event-stream', body: `${sse}data: [DONE]\n\n` });
  });

  await loadSample(page);
  await importBigPurchases(page);
  await useGemini(page);
  await send(page, 'Draw a timeline of the things I need to save up for.');

  const reply = page.locator('chat-panel .msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply.locator('.who')).toHaveText('Crux + Google Gemini');
  const chart = reply.locator('chat-chart');
  await expect(chart.locator('.title')).toHaveText('What is coming up');
  await expect(chart.locator('[data-prov="forecast"]')).toBeVisible();

  // The catalogue offered big purchases; the tool result says what falls due, rounded.
  const first = JSON.stringify(bodies[0]);
  expect(first).toContain('big-purchases');
  expect(first).toContain('always try make_chart');
  const toolResult = (bodies[1]!.messages as { role: string; content: string }[]).find(
    (m) => m.role === 'tool'
  )!.content;
  expect(toolResult).toContain('"provenance":"forecast"');
  expect(toolResult).toMatch(/"fallsDue":\[\{"when":"\d{4}-\d{2}","item":"[^"]+","cost":"~\$/);
});

test('a provider that goes quiet is given up on with a reason, not left waiting', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.clock.install();
  // The provider accepts the request and never answers.
  await page.route('https://generativelanguage.googleapis.com/**', () => new Promise(() => {}));
  await loadSample(page);
  await useGemini(page);
  await send(page, 'What do I need to save up for? Draw it for me.');

  const panel = page.locator('chat-panel');
  await expect(panel.getByText(/Waiting for its reply|Sending your question/)).toBeVisible();
  await page.clock.fastForward('01:31');
  await expect(panel.locator('.status')).toContainText(
    'Google Gemini stopped replying: nothing arrived for 90 s.'
  );
  await expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled();
});
