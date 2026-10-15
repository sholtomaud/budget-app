/** Profile: a rough age and a country set how long the plan runs (ADR 0043). */
import { expect, test } from './fixtures.ts';

test.use({ timezoneId: 'Australia/Sydney', locale: 'en-AU' });

test('profile: country from the device, plan to an age, and Freedom follows', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Profile' }).click();
  const profile = page.locator('profile-page');

  // Country from the time zone; nothing looked up online.
  await expect(profile.getByLabel('Country')).toHaveValue('AU');
  await expect(profile.locator('.country-note')).toContainText('Nothing was looked up online');
  await expect(profile.locator('.result')).toContainText('Enter your age');

  await profile.getByLabel('Age (years)', { exact: true }).fill('40');
  await profile.getByLabel('Age (years)', { exact: true }).dispatchEvent('change');
  await profile.getByLabel('Your sex, for the life table').selectOption('male');
  await expect(profile.locator('.result')).toHaveText(/Plan to age \d+/);
  const planTo = Number((await profile.locator('.result strong').textContent())!);
  expect(planTo).toBeGreaterThan(85);
  await expect(profile.locator('.explain .prov')).toHaveText('assumed');

  // More caution, a longer plan.
  await profile.getByLabel(/1 in 10 live longer/).check();
  await expect(profile.locator('.result strong')).not.toHaveText(String(planTo));
  await profile.getByLabel(/1 in 4 live longer/).check();
  await expect(profile.locator('.result strong')).toHaveText(String(planTo));

  // Freedom's years of freedom now come from the profile.
  await nav.getByRole('link', { name: 'Freedom' }).click();
  const freedom = page.locator('freedom-page');
  const years = freedom.getByLabel('Years of freedom');
  await expect(freedom.locator('.horizon-note')).toContainText(`To age ${planTo}`);
  await expect(years).toHaveJSProperty('readOnly', true);
  const y = Number(await years.inputValue());
  // A later start leaves fewer years to fund.
  const start = freedom.getByLabel('Freedom starts');
  const [yr, mo] = (await start.inputValue()).split('-').map(Number);
  await start.fill(`${yr! + 2}-${String(mo).padStart(2, '0')}`);
  await start.dispatchEvent('change');
  await expect(years).toHaveValue(String(y - 2));

  // Most settings are tucked away.
  await expect(freedom.getByLabel('Cash kept in the bank ($)')).toBeHidden();
  await freedom.locator('details.more summary').click();
  await expect(freedom.getByLabel('Cash kept in the bank ($)')).toBeVisible();
});
