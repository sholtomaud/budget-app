/** Sign in with OpenRouter (ADR 0047), against a mock of OpenRouter. Made-up data. */
import { createHash } from 'node:crypto';
import type { Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

test('sign in with OpenRouter: PKCE round trip, a key for this session, and the chat uses it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let challenge = '';
  let exchange: Record<string, string> = {};
  const chatAuth: (string | undefined)[] = [];
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('https://openrouter.ai/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/auth') {
      // OpenRouter's sign-in page: approve at once, back to the callback with a code.
      challenge = url.searchParams.get('code_challenge') ?? '';
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const back = new URL(url.searchParams.get('callback_url')!);
      // The app's root, a real page on any static host.
      expect(back.pathname).toBe(new URL(page.url()).pathname.replace(/settings$/, ''));
      back.searchParams.set('code', 'one-time-code');
      return route.fulfill({ status: 302, headers: { location: back.toString() } });
    }
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    if (url.pathname === '/api/v1/auth/keys') {
      exchange = JSON.parse(req.postData() ?? '{}');
      return route.fulfill({ headers: cors, json: { key: 'sk-or-v1-test' } });
    }
    if (url.pathname === '/api/v1/chat/completions') {
      chatAuth.push(req.headers()['authorization']);
      const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
      return route.fulfill({
        contentType: 'text/event-stream',
        headers: cors,
        body: `${chunk({ choices: [{ delta: { content: 'Hello through OpenRouter.' }, finish_reason: 'stop' }] })}data: [DONE]\n\n`,
      });
    }
    return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
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
  await form.getByLabel('Provider').selectOption('openrouter');
  await page.getByRole('button', { name: 'Sign in with OpenRouter' }).click();

  // Back on Settings: the exchange is shown before it's sent, like every call.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('one-time-code');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.providers .msg')).toContainText('Signed in with OpenRouter');
  expect(exchange.code).toBe('one-time-code');
  expect(exchange.code_challenge_method).toBe('S256');
  expect(createHash('sha256').update(exchange.code_verifier!).digest('base64url')).toBe(challenge);
  // The code leaves the address bar; the verifier is used once.
  expect(page.url()).not.toContain('code=');
  expect(
    await page.evaluate(() => sessionStorage.getItem('budget-app:openrouter-pkce'))
  ).toBeNull();
  // Never stored: not in localStorage, sessionStorage or the provider settings.
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  ).not.toContain('sk-or-v1-test');

  // The chat uses the key.
  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('Ask the AI: what should I look at first?');
  await panel.getByRole('button', { name: 'Send' }).click();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply).toContainText('Hello through OpenRouter.');
  expect(chatAuth).toEqual(['Bearer sk-or-v1-test']);
});
