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
