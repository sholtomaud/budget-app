import { expect, test } from './fixtures.ts';

test('household example model runs in the sim worker (M0 acceptance)', async ({ page }) => {
  await page.goto('kernel');
  await expect(page.locator('.k-status')).toHaveText('SHA-256 matches the pin');
  await expect(page.locator('.k-version')).toHaveText('5.3.0');

  await page.getByRole('button', { name: 'Run example' }).click();
  await expect(page.locator('.result')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.summary')).toContainText('Household Ecological-Economy: 240 steps');
  await expect(page.locator('.carriers tbody tr')).toHaveCount(4);
  await expect(page.locator('line-chart .series path')).toHaveCount(3);
  await expect(page.locator('line-chart .prov')).toHaveText('illustrative');
});

test('the built page carries a CSP that limits connections to its origin and the allowed providers', async ({
  page,
}) => {
  await page.goto('./');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  // Its own origin, plus only the AI providers the egress gate allows (FR-API-005).
  expect(csp).toContain(
    "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com http://localhost:* http://127.0.0.1:*;"
  );
  expect(csp).toContain("default-src 'self'");
});
