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
