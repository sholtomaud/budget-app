/** Schedules: set by hand or by the AI, run while open, AI only when allowed (ADR 0041). Made-up data. */
import type { Route } from '@playwright/test';
import { expect, test, type Page } from './fixtures.ts';

async function sample(page: Page) {
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Screens' });
const item = (page: Page, name: string) =>
  page.locator('schedules-page .list > li').filter({ hasText: name });

const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
const toolCall = (id: string, name: string, args: unknown) =>
  chunk({
    model: 'gemini-3.8-flash',
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  });
const text = (t: string) => chunk({ choices: [{ delta: { content: t }, finish_reason: 'stop' }] });

async function gemini(page: Page) {
  await nav(page).getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();
}

test('set by hand: a ready-made schedule, run now, its result kept; paused and deleted', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await sample(page);
  await nav(page).getByRole('link', { name: 'Schedules' }).click();
  await expect(page.getByRole('heading', { name: 'Schedules', level: 1 })).toBeVisible();
  await expect(page.locator('schedules-page .empty')).toBeVisible();
  await page.getByRole('button', { name: 'Morning budget check' }).click();
  const s = item(page, 'Morning budget check');
  await expect(s).toContainText('Every day at 08:00');
  await expect(s).toContainText('Asks the chat: “Review my budget”');

  await s.getByRole('button', { name: 'Run now: “Morning budget check”' }).click();
  const panel = page.locator('chat-panel');
  await expect(panel.locator('.msg.user.scheduled').last()).toContainText(
    'Scheduled · Morning budget check'
  );
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  // The sample household has no budget yet: the review says so.
  await expect(reply).toContainText('There is no budget to review yet');
  await expect(s).toContainText('Ran in the chat.');

  // A reminder of your own, from the form.
  const form = page.getByRole('form', { name: 'Schedule' });
  await form.getByLabel('Name').fill('Pay the rates');
  await form.getByLabel('What it does').selectOption('reminder');
  await form.getByLabel('How often').selectOption('month');
  await form.getByLabel('Day of the month').fill('15');
  await form.getByLabel('Remind me to').fill('pay the council rates');
  await form.getByRole('button', { name: 'Add schedule' }).click();
  const r = item(page, 'Pay the rates');
  await expect(r).toContainText('Every month on the 15th at 08:00');
  await r.getByRole('button', { name: 'Run now: “Pay the rates”' }).click();
  await expect(panel.locator('.msg.notice').last()).toContainText('pay the council rates');

  await r.getByLabel('On').uncheck();
  await expect(r).toContainText('Paused.');
  await r.getByRole('button', { name: 'Delete “Pay the rates”' }).click();
  await expect(item(page, 'Pay the rates')).toHaveCount(0);
  await page.reload();
  await expect(item(page, 'Morning budget check')).toBeVisible();
});

test('the AI only when allowed: skipped while off; on, it runs without asking and is logged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let calls = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    calls++;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `${text('Your week: spending is steady.')}data: [DONE]\n\n`,
    });
  });
  await sample(page);
  await gemini(page);
  await nav(page).getByRole('link', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: 'Weekly AI review' }).click();
  const s = item(page, 'Weekly AI review');
  await expect(s).toContainText('uses the AI');
  await s.getByRole('button', { name: 'Run now: “Weekly AI review”' }).click();
  await expect(s).toContainText(
    'Skipped: schedules may not call the AI on their own (turn it on in Schedules).'
  );
  expect(calls).toBe(0);

  await page.getByLabel('Let schedules call the AI on their own').check();
  await s.getByRole('button', { name: 'Run now: “Weekly AI review”' }).click();
  const reply = page.locator('chat-panel .msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply).toContainText('Your week: spending is steady.');
  // No consent dialog: the person allowed it; the call is in the log.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls).toBe(1);
  await nav(page).getByRole('link', { name: 'Settings' }).click();
  await page.getByText('Calls made (log)').click();
  await expect(page.locator('settings-page')).toContainText('scheduled');
});

test('a time missed while away runs once, on its own', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date(2026, 9, 14, 7, 0) });
  await sample(page);
  await nav(page).getByRole('link', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: 'Morning budget check' }).click();
  await expect(item(page, 'Morning budget check')).toContainText('Not run yet.');
  // A day and a bit later, the minute check finds it due.
  await page.clock.fastForward('25:00:00');
  const panel = page.locator('chat-panel');
  await expect(panel.locator('.msg.user.scheduled')).toHaveCount(1, { timeout: 30_000 });
  await expect(item(page, 'Morning budget check')).toContainText('Ran in the chat.');
});

test('the AI sets up a schedule: a card to save, shown on Schedules', async ({ page }) => {
  test.setTimeout(120_000);
  let n = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    n++;
    const sse =
      n === 1
        ? toolCall('c1', 'list_schedules', {})
        : n === 2
          ? toolCall('c2', 'propose_schedule', {
              scheduleId: null,
              remove: false,
              name: 'Monday plan check',
              action: 'plan-run',
              every: 'week',
              at: '07:30',
              weekday: 1,
              monthday: null,
              note: null,
            })
          : text('A weekly plan run is ready for you to save.');
    await route.fulfill({ contentType: 'text/event-stream', body: `${sse}data: [DONE]\n\n` });
  });
  await sample(page);
  await gemini(page);
  const panel = page.locator('chat-panel');
  await panel
    .getByLabel('Your message')
    .fill('Set up a weekly check-in for Monday mornings at 7:30');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply).toContainText(
    'Add the schedule “Monday plan check”: every monday at 07:30, run my plan.'
  );
  await reply.getByRole('button', { name: 'Save schedule' }).click();
  await expect(reply.locator('.result')).toHaveText('Saved. See it on the Schedules screen.');
  await nav(page).getByRole('link', { name: 'Schedules' }).click();
  const s = item(page, 'Monday plan check');
  await expect(s).toContainText('Every Monday at 07:30');
  await expect(s).toContainText('set up by the AI');
});
