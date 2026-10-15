/** Dashboards: named layouts of charts, by dragging or with buttons (ADR 0036). Made-up data. */
import { expect, test, type Page } from './fixtures.ts';

async function open(page: Page) {
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('link', { name: 'Dashboards', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible();
}

const tiles = (page: Page) => page.locator('dashboards-page .grid > li.tile');
const titles = (page: Page) => tiles(page).locator('.title, .problem');

test('a starter dashboard; add by dragging and with a button; move, widen, remove; kept on reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  await expect(page.getByRole('combobox', { name: 'Dashboard', exact: true })).toHaveValue(/dash-/);
  await expect(
    page.getByRole('combobox', { name: 'Dashboard', exact: true }).locator('option:checked')
  ).toHaveText('Overview');
  await expect(tiles(page)).toHaveCount(3);
  await expect(tiles(page).first()).toHaveClass(/wide/);
  await expect(tiles(page).first().locator('chat-chart svg')).toBeVisible();
  // No full run yet: the savings chart says so instead of drawing nothing.
  await expect(tiles(page).nth(2).locator('.problem')).toContainText('no full run');

  // Drag a built-in chart onto the first tile: it goes before it.
  const rail = page.locator('dashboards-page .rail');
  const merchants = rail.locator('li[data-title^="Where the money goes"]');
  await expect(merchants.locator('chat-chart svg')).toBeVisible();
  await merchants.dragTo(tiles(page).first());
  await expect(tiles(page)).toHaveCount(4);
  await expect(titles(page).first()).toHaveText(
    'Where the money goes: top merchants, last 12 months'
  );
  await expect(page.locator('dashboards-page .status')).toHaveText(
    'Added “Where the money goes: top merchants, last 12 months”.'
  );

  // The same with buttons: add at the end, move it up, make it wide, remove one.
  await rail
    .getByRole('button', { name: 'Add “Income and spending, by quarter” to the dashboard' })
    .click();
  await expect(tiles(page)).toHaveCount(5);
  await expect(titles(page).last()).toHaveText('Income and spending, by quarter');
  await page
    .getByRole('button', { name: 'Move earlier: “Income and spending, by quarter”' })
    .click();
  await expect(titles(page).nth(3)).toHaveText('Income and spending, by quarter');
  await page.getByRole('button', { name: 'Make wide: “Income and spending, by quarter”' }).click();
  await expect(tiles(page).nth(3)).toHaveClass(/wide/);
  await page.getByRole('button', { name: 'Remove “Spending by group, last 12 months”' }).click();
  await expect(tiles(page)).toHaveCount(4);

  // Reorder by dragging a tile onto the end slot (both on screen: a drag that scrolls starts elsewhere).
  await page.setViewportSize({ width: 1400, height: 2400 });
  await tiles(page).first().dragTo(page.locator('dashboards-page .grid > li.end'));
  await expect(titles(page).last()).toHaveText(
    'Where the money goes: top merchants, last 12 months'
  );

  await page.reload();
  await expect(tiles(page)).toHaveCount(4);
  await expect(titles(page).last()).toHaveText(
    'Where the money goes: top merchants, last 12 months'
  );
  await expect(titles(page).nth(1)).toHaveText('Income and spending, by quarter');
  await expect(tiles(page).nth(1)).toHaveClass(/wide/);
});

test('named dashboards: new, rename, duplicate, switch, delete', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const pick = page.getByRole('combobox', { name: 'Dashboard', exact: true });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const name = page.getByRole('form', { name: 'Rename dashboard' }).getByLabel('Name');
  await expect(name).toBeFocused();
  await name.fill('Monthly check-in');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(pick.locator('option:checked')).toHaveText('Monthly check-in');
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.locator('dashboards-page .grid > li.end')).toContainText(
    'This dashboard is empty'
  );
  await page
    .locator('dashboards-page .rail')
    .getByRole('button', { name: 'Add “Big purchases coming up, by year” to the dashboard' })
    .click();
  await expect(tiles(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(pick.locator('option:checked')).toHaveText('Monthly check-in (copy)');
  await expect(tiles(page)).toHaveCount(1);

  await pick.selectOption({ label: 'Overview' });
  await expect(tiles(page)).toHaveCount(3);

  await pick.selectOption({ label: 'Monthly check-in (copy)' });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('dashboards-page .confirm')).toContainText(
    'Delete “Monthly check-in (copy)”?'
  );
  await page.getByRole('button', { name: 'Delete it' }).click();
  await expect(pick.locator('option')).toHaveText(['Overview', 'Monthly check-in']);

  await page.reload();
  await expect(pick.locator('option')).toHaveText(['Overview', 'Monthly check-in']);
});

test('the AI lays out a dashboard: a card to check and save, shown on Dashboards, undone in one click', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const bodies: Record<string, unknown>[] = [];
  const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
  const call = (id: string, name: string, args: unknown) =>
    chunk({
      model: 'gemini-3.8-flash',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
  const tile = (t: Record<string, unknown>) => ({
    builtin: null,
    saved: null,
    chart: null,
    wide: false,
    ...t,
  });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const sse =
      bodies.length === 1
        ? call('c1', 'list_dashboards', {})
        : bodies.length === 2
          ? call('c2', 'propose_dashboard', {
              dashboardId: null,
              name: 'Monthly check-in',
              tiles: [
                tile({ builtin: 'spending-vs-budget', wide: true }),
                tile({ builtin: 'top-merchants' }),
                tile({
                  chart: {
                    kind: 'bar',
                    title: 'Income by quarter',
                    caption: null,
                    groupBy: 'quarter',
                    series: [
                      {
                        label: 'Income',
                        dataset: 'income',
                        measure: null,
                        splitBy: null,
                        hue: null,
                        look: null,
                        filter: null,
                      },
                    ],
                  },
                }),
              ],
            })
          : chunk({
              choices: [
                {
                  delta: { content: 'Here is a monthly check-in dashboard for you to save.' },
                  finish_reason: 'stop',
                },
              ],
            });
    await route.fulfill({ contentType: 'text/event-stream', body: `${sse}data: [DONE]\n\n` });
  });

  await open(page);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();
  await nav.getByRole('link', { name: 'Dashboards', exact: true }).click();
  const pick = page.getByRole('combobox', { name: 'Dashboard', exact: true });
  await expect(pick.locator('option')).toHaveText(['Overview']);

  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('I need a dashboard for my monthly check-in');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  const reply = panel.locator('.msg.reply').last();
  await expect(reply).toHaveAttribute('data-done', 'true', { timeout: 60_000 });
  await expect(reply).toContainText(
    'Make a dashboard “Monthly check-in” with 3 charts: Spending against the budget, by month; Where the money goes: top merchants, last 12 months; Income by quarter.'
  );
  // Nothing is saved until the person says so.
  await expect(pick.locator('option')).toHaveText(['Overview']);
  await reply.getByLabel('Dashboard name').fill('My check-in');
  await reply.getByRole('button', { name: 'Save dashboard' }).click();
  await expect(reply.locator('.result')).toHaveText('Saved. It opens on the Dashboards screen.');

  // The screen behind the chat shows it at once, opened.
  await expect(pick.locator('option')).toHaveText(['Overview', 'My check-in']);
  await expect(pick.locator('option:checked')).toHaveText('My check-in');
  await expect(tiles(page)).toHaveCount(3);
  await expect(titles(page).last()).toHaveText('Income by quarter');

  await reply.getByRole('button', { name: 'Undo' }).click();
  await expect(pick.locator('option')).toHaveText(['Overview']);

  // The AI saw titles and ids, never a value.
  const listed = (bodies[1]!.messages as { role: string; content: string }[]).find(
    (m) => m.role === 'tool'
  )!.content;
  expect(listed).toContain('"builtIn"');
  expect(listed).not.toMatch(/\$\d/);
});
