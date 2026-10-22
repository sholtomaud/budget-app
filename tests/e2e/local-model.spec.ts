/** A model on this computer (llama.cpp's llama-server, Ollama, LM Studio): no key needed. Made-up data. */
import type { Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

test('a local model answers without an API key, and no key is sent', async ({ page }) => {
  test.setTimeout(120_000);
  const auth: (string | undefined)[] = [];
  await page.route('http://localhost:8080/**', async (route: Route) => {
    auth.push(route.request().headers()['authorization']);
    const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
    await route.fulfill({
      contentType: 'text/event-stream',
      headers: { 'access-control-allow-origin': '*' },
      body: `${chunk({ choices: [{ delta: { content: 'Hello from your own computer.' }, finish_reason: 'stop' }] })}data: [DONE]\n\n`,
    });
  });

  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Settings' })
    .click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('local');
  await expect(form.getByLabel('Endpoint')).toHaveValue('http://localhost:8080');
  await expect(form.getByLabel('API key, for this session only')).toHaveAttribute(
    'placeholder',
    'Optional for a local server'
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('on this computer: nothing leaves it')).toBeVisible();

  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('How is my plan going?');
  await panel.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply).toContainText('Hello from your own computer.');
  expect(auth.length).toBeGreaterThan(0);
  expect(auth.every((a) => a === undefined)).toBe(true);
});

test('asked for by name, the AI answers, and sees what Crux said before (ADR 0045)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bodies: string[] = [];
  await page.route('http://localhost:8080/**', async (route: Route) => {
    bodies.push(route.request().postData() ?? '');
    const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
    await route.fulfill({
      contentType: 'text/event-stream',
      headers: { 'access-control-allow-origin': '*' },
      body: `${chunk({ choices: [{ delta: { content: 'Here is what that means for you.' }, finish_reason: 'stop' }] })}data: [DONE]\n\n`,
    });
  });
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Settings' })
    .click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('local');
  await form.getByRole('button', { name: 'Save' }).click();

  const panel = page.locator('chat-panel');
  const send = async (text: string) => {
    await panel.getByLabel('Your message').fill(text);
    await panel.getByRole('button', { name: 'Send' }).click();
  };
  // Crux answers a short question on its own.
  await send('What does P90 mean?');
  await expect(panel.locator('.msg.reply').last()).toHaveAttribute('data-done', 'true');
  expect(bodies).toHaveLength(0);
  // A short question Crux knows, but asked of the AI by name: the AI gets it, with Crux's answer.
  await send('ask the local model: what does P90 mean for me?');
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply).toContainText('Here is what that means for you.');
  expect(bodies[0]).toContain('Earlier in this chat, answered by Crux on the device');
  expect(bodies[0]).toContain('What does P90 mean?');
  expect(bodies[0]).toContain('Who you are');
  // A pasted screen with amounts in it is a question, not a budget line.
  await send(
    "I see Freedom number $636,455 and $24,297 a year of spending at a 4.0 % withdrawal rate. But I don't understand why the spending is $24k when the mortgage alone is about $35k per year?"
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('.msg.reply').last()).toHaveAttribute('data-done', 'true', {
    timeout: 60_000,
  });
  await expect(panel.getByText('Add a budget line')).toHaveCount(0);
  expect(bodies.length).toBeGreaterThan(1);
});
