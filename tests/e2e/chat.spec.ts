/** The chat panel (ADR 0023). */
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

async function ask(page: Page, q: string, nth: number) {
  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill(q);
  await panel.getByRole('button', { name: 'Send' }).click();
  const reply = panel.locator('.msg.reply').nth(nth);
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 120_000 });
  return reply;
}

test('chat: open by default, answers common questions on this device, stays open across screens', async ({
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
  const panel = page.locator('chat-panel');
  await expect(panel.getByRole('heading', { name: 'Ask Crux' })).toBeVisible();
  await expect(panel.locator('.context')).toContainText('Looking at: Import');

  const chance = await ask(page, 'How likely is my plan to work?', 0);
  await expect(chance.locator('.who')).toHaveText('Crux · on this device');
  // What Crux did is in the log above the reply, ticked off with how long it took.
  const did = panel.locator('.msg.activity').first();
  await expect(did).toHaveAttribute('data-state', 'done');
  await expect(did).toContainText(/Ran 500 simulated futures · \d+\.\d s/);
  await expect(chance).toContainText('simulated futures');
  await expect(chance.locator('.meter')).toBeVisible();
  await expect(chance.locator('.footnotes')).toContainText('seed 42');
  await expect(chance.locator('.body')).not.toContainText('**');

  const term = await ask(page, 'What does P90 mean?', 1);
  await expect(term).toContainText('middle 80 %');

  // Move to another screen: the panel and its conversation stay; the context follows.
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Forecast' })
    .click();
  await expect(page.getByRole('heading', { name: 'Forecast', level: 1 })).toBeVisible();
  await expect(panel.locator('.msg.reply')).toHaveCount(2);
  await expect(panel.locator('.context')).toContainText('Looking at: Forecast');
  await panel.getByRole('button', { name: "Don't include this screen" }).click();
  await expect(panel.locator('.context')).toBeHidden();

  // The nav button and Ctrl+J close and reopen it.
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Ask Crux' })).toBeHidden();
  await page.keyboard.press('Control+j');
  await expect(panel.getByRole('heading', { name: 'Ask Crux' })).toBeVisible();

  // No AI provider is set up: nothing left the device.
  expect(foreign).toEqual([]);
});

test('chat: a cost becomes a budget-line card; Apply adds it, Undo removes it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loadSample(page);
  const reply = await ask(page, 'I pay $45 a month for the gym', 0);
  const card = reply.locator('.proposal');
  await expect(card).toContainText('Add a budget line: Gym, $45.00 a month');
  await expect(card.getByLabel('Category')).toHaveValue('health.gym');
  await card.getByLabel('Amount ($)').fill('49');
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.locator('.result')).toHaveText('Applied.');

  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Budget' })
    .click();
  const budget = page.locator('budget-page');
  await expect(budget).toContainText('Gym');
  await expect(budget).toContainText('49');

  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.locator('.result')).toHaveText('Undone.');
  await expect(budget).not.toContainText('Added from the chat panel');
});

test('chat: on a phone it starts closed and opens as a full-screen sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const panel = page.locator('chat-panel');
  await expect(panel.getByRole('heading', { name: 'Ask Crux' })).toBeHidden();
  await panel.getByRole('button', { name: 'Open chat' }).click();
  await expect(panel.getByRole('heading', { name: 'Ask Crux' })).toBeVisible();
  await expect(panel.locator('.panel')).toHaveCSS('left', '0px');
});
