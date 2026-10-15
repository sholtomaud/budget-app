/** The chat screen: setup by conversation (FR-SETUP-001…006, ADR 0027). */
import type { Route } from '@playwright/test';
import { expect, test, type Page } from './fixtures.ts';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const chat = (page: Page) => page.locator('chat-page');
const lastReply = (page: Page) => chat(page).locator('.msg.reply').last();

async function choose(page: Page, label: string) {
  await chat(page)
    .locator('.suggestions')
    .getByRole('button', { name: label, exact: true })
    .click();
}

test('setup with buttons only: a sample household, no budget, the plan; nothing leaves the device', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin && !r.url().startsWith('data:')) foreign.push(r.url());
  });

  await page.goto('./');
  await page.getByRole('link', { name: 'Set up by chatting' }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('heading', { name: 'Set up Crux' })).toBeVisible();
  // The app's menu is the same as everywhere (ADR 0040); the chat panel steps aside.
  await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();
  await expect(page.locator('chat-panel')).toBeHidden();
  await expect(lastReply(page)).toContainText('What do you have?');
  await expect(chat(page).locator('.steps li[data-section="data"]')).toHaveAttribute(
    'data-state',
    'current'
  );

  await choose(page, 'Try a sample household');
  await expect(lastReply(page)).toContainText('Pick a sample household');
  await choose(page, 'Renting, one salary');
  await expect(
    chat(page).locator('.msg.reply', { hasText: 'Loaded Renting, one salary' })
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(lastReply(page)).toContainText('Do you have a budget spreadsheet?');
  await expect(chat(page).locator('.steps li[data-section="data"]')).toHaveAttribute(
    'data-state',
    'done'
  );

  await choose(page, 'Not now: use my spending');
  await expect(chat(page).locator('.meter')).toBeVisible({ timeout: 120_000 });
  await expect(lastReply(page)).toContainText('Setup is done.');
  await expect(chat(page).locator('.suggestions')).toContainText('What would make it work?');
  for (const s of ['data', 'budget', 'plan'])
    await expect(chat(page).locator(`.steps li[data-section="${s}"]`)).toHaveAttribute(
      'data-state',
      'done'
    );

  // Setup is remembered with the household.
  await page.reload();
  await expect(lastReply(page)).toContainText('Setup is done.');

  // The menu reaches every screen from here too.
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Transactions' })
    .click();
  await expect(page).toHaveURL(/\/ledger$/);
  expect(foreign).toEqual([]);
});

test('typed answers are read on the device; budget CSVs are previewed before import', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('chat');
  await expect(lastReply(page)).toContainText('What do you have?');
  const box = chat(page).getByLabel('Your message');

  await box.fill('something about llamas');
  await box.press('Enter');
  await expect(lastReply(page)).toContainText('I didn’t catch that');
  await expect(chat(page).locator('.suggestions')).toContainText('Try a sample household');

  await box.fill('I have my budget in an Excel spreadsheet');
  await box.press('Enter');
  await expect(lastReply(page)).toContainText('Choose the CSV files');

  await chat(page)
    .getByLabel('Choose CSV files')
    .setInputFiles([
      'fixtures/syn-default-42/workbook/opex-budget.csv',
      'fixtures/syn-default-42/workbook/capex-register.csv',
    ]);
  await expect(lastReply(page)).toContainText('Import these?', { timeout: 30_000 });
  const found = chat(page).locator('.msg.reply', { hasText: 'Here is what I found' });
  await expect(found).toContainText('opex-budget.csv');
  await expect(found).toContainText('OPEX budget');
  await expect(found).toContainText('CAPEX register');

  await choose(page, 'Import them');
  await expect(chat(page).locator('.msg.reply', { hasText: 'Imported 2 sheets' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(lastReply(page)).toContainText('Setup is done.', { timeout: 120_000 });

  // A question mid-setup is answered as usual, and setup carries on.
  await chat(page).getByRole('button', { name: 'Start setup again' }).click();
  await expect(lastReply(page)).toContainText('What do you have?');
  await box.fill('What does P90 mean?');
  await box.press('Enter');
  await expect(lastReply(page)).toContainText('90');
  await expect(chat(page).locator('.suggestions')).toContainText('Nothing yet');
});

test('with an AI provider, an answer the steps do not recognise is read as a structured output', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bodies: Record<string, unknown>[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        choices: [
          { message: { content: JSON.stringify({ choice: 'sample' }) }, finish_reason: 'stop' },
        ],
      }),
    });
  });

  await page.goto('settings');
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Set up' })
    .click();
  await expect(lastReply(page)).toContainText('What do you have?');
  await expect(chat(page).locator('.provider')).toHaveText('+ Google Gemini');

  const box = chat(page).getByLabel('Your message');
  await box.fill('honestly I just want to poke around first');
  await box.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Work out which setup option your message means.');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat(page).locator('.msg.reply', { hasText: 'Understood' })).toContainText(
    'Try a sample household'
  );
  await expect(lastReply(page)).toContainText('Pick a sample household');

  expect(bodies).toHaveLength(1);
  const sent = JSON.stringify(bodies[0]);
  expect(sent).toContain('poke around');
  expect((bodies[0]!.response_format as { type: string }).type).toBe('json_schema');
});

test('phones: the setup steps and the menu are each behind a button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('chat');
  await expect(lastReply(page)).toContainText('What do you have?');
  const steps = chat(page).getByRole('navigation', { name: 'Setup steps' });
  await expect(steps).toBeHidden();
  await chat(page).getByRole('button', { name: 'Steps' }).click();
  await expect(steps).toBeVisible();
  await expect(steps).toContainText('Your budget');
  await page.reload();
  const menu = page.getByRole('navigation', { name: 'Screens' });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Budget' }).click();
  await expect(page).toHaveURL(/\/budget$/);
  // The drawer closes once a screen is chosen.
  await expect(menu).toBeHidden();
});
