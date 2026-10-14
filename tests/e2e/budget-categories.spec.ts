/** A spreadsheet budget's lines onto the app's categories: rules, then the AI (FR-ING-019, ADR 0034). Made-up data. */
import type { Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const SHEET = `# x-synthetic: made-up budget
OUTGOINGS,,,,,,,
CATEGORY,Item,Cost,Unit,Fin. Secure,Fin. Indepnt,Fin. Luxury,Sub-category
HOUSING,Rent,$500,w,1,1.5,2,rental
FOOD,Super.Market,$100,w,1,1,1.5,groceries
UTILITIES,Elect,$100,m,1,1,2,utilities
GADGETS,Laptop,"$3,000",5y,0,1,1,gadgets
,TOTALS,,,,,,
`;

test('budget lines are matched to categories by rules, the rest by the AI, then imported', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bodies: Record<string, unknown>[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const user = JSON.stringify(body.messages);
    const row = Number(/(\d+): item \\"Laptop\\"/.exec(user)?.[1] ?? -1);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        choices: [
          {
            message: {
              content: JSON.stringify({ lines: [{ row, category: 'shopping.electronics' }] }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
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
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Budget' })
    .click();

  await page.locator('input.pick-csv').setInputFiles({
    name: 'my-budget.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(SHEET),
  });
  const lines = page.locator('.line-categories');
  const by = (item: string) =>
    lines
      .locator('tbody tr')
      .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${item}$`) }) })
      .locator('.by');
  await expect(lines.locator('summary')).toHaveText('Categories: 3 of 4 lines matched');
  await expect(by('Rent')).toHaveText('rules');
  await expect(lines.getByLabel('Category for Rent')).toHaveValue('housing.rent');
  await expect(by('Laptop')).toHaveText('not matched');

  await lines.getByRole('button', { name: 'Match the other 1 with AI' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Match the lines of my-budget.csv to spending categories.');
  const payload = await dialog.locator('.payload').textContent();
  expect(payload).toContain('Laptop');
  expect(payload).not.toContain('3,000');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(lines.locator('summary')).toHaveText('Categories: 4 of 4 lines matched');
  await expect(by('Laptop')).toHaveText('AI');
  await expect(lines.getByLabel('Category for Laptop')).toHaveValue('shopping.electronics');

  // The person has the last word.
  await lines.getByLabel('Category for Elect').selectOption('utilities.gas');
  await expect(by('Elect')).toHaveText('you');

  await page.getByRole('button', { name: /^Import \d+ rows$/ }).click();
  await expect(page.locator('table.vs tbody tr[data-category="housing.rent"]')).toBeVisible();
  await expect(
    page.locator('table.vs tbody tr[data-category="shopping.electronics"]')
  ).toBeVisible();
  await expect(page.locator('table.vs tbody tr[data-category="utilities.gas"]')).toBeVisible();
  expect(bodies).toHaveLength(1);
});
