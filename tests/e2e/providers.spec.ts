import { expect, test, type Page, type Route } from './fixtures.ts';

/** IndexedDB and localStorage, as text: the API key must appear in neither. */
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('budget-app');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['imports', 'kv']);
          const a = tx.objectStore('imports').getAll();
          const b = tx.objectStore('kv').getAll();
          tx.oncomplete = () => {
            resolve(
              JSON.stringify([a.result, b.result, { ...localStorage }], (_k, v) =>
                typeof v === 'bigint' ? String(v) : v
              )
            );
            db.close();
          };
        };
      })
  );

const KEY = 'sk-ant-test-0123456789';

test('AI provider: key never stored; consent shows a redacted payload; declining sends nothing (FR-API-001…005)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request();
    const body = req.postDataJSON() as Record<string, unknown>;
    calls.push({ headers: req.headers(), body });
    const user = JSON.stringify(body.messages);
    const refs = [...user.matchAll(/\\"ref\\": (\d+)/g)].map((m) => Number(m[1]));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              labels: refs.map((ref) => ({ ref, categoryId: 'food.groceries' })),
            }),
          },
        ],
      }),
    });
  });

  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);

  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('anthropic');
  await form.getByLabel('API key, for this session only').fill(KEY);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.providers .msg')).toContainText('with a key for this session');
  expect(await stored(page)).not.toContain(KEY);

  await nav.getByRole('link', { name: 'Transactions' }).click();
  await page.getByRole('tab', { name: /Review queue/ }).click();
  const before = await page.getByRole('tab', { name: /Review queue/ }).textContent();

  // Declining sends nothing.
  await page.getByRole('button', { name: 'Suggest categories with AI' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Send this to Anthropic (Claude)?');
  const payload = await dialog.locator('.payload').textContent();
  expect(payload).toContain('direction');
  expect(payload).not.toMatch(/SYN-[A-Z]/);
  expect(payload).not.toMatch(/\b\d+\.\d{2}\b/); // no exact amounts
  expect(payload).not.toContain(KEY);
  await dialog.getByRole('button', { name: "Don't send" }).click();
  await expect(page.locator('.ai-status')).toContainText('Not sent');
  expect(calls).toHaveLength(0);

  // Sending: the request carries the key in a header, a structured-output schema, nothing else.
  await page.getByRole('button', { name: 'Suggest categories with AI' }).click();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.ai-status')).toContainText('suggested by Anthropic', {
    timeout: 30_000,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.headers['x-api-key']).toBe(KEY);
  expect(calls[0]!.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(calls[0]!.body.output_config).toMatchObject({ format: { type: 'json_schema' } });
  expect(JSON.stringify(calls[0]!.body)).not.toMatch(/SYN-[A-Z]/);
  await expect(page.getByRole('tab', { name: /Review queue/ })).not.toHaveText(before!);

  // The call is in the log; the key is still not stored.
  await nav.getByRole('link', { name: 'Settings' }).click();
  await page.getByText('Calls made (log)').click();
  await expect(page.locator('table.egress tbody tr').first()).toContainText('classify');
  expect(await stored(page)).not.toContain(KEY);

  // After a reload the key is gone.
  await page.reload();
  await expect(
    page.getByRole('form', { name: 'AI provider' }).getByLabel('API key, for this session only')
  ).toHaveAttribute('placeholder', 'Not stored');
});

test('advisor: tool loop on this device; an invented figure is flagged (§13.3, NFR-HON-002)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  let step = 0;
  const bodies: string[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const body = route.request().postData() ?? '';
    bodies.push(body);
    step++;
    const reply =
      step === 1
        ? {
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: "I'll run your plan." },
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'run_plan',
                input: { scenarioId: null, runs: 200 },
              },
            ],
          }
        : (() => {
            const chance = /\\"chanceOfSuccess\\":\\"(\d+) %\\"/.exec(body)?.[1] ?? '?';
            return {
              stop_reason: 'end_turn',
              content: [
                {
                  type: 'text',
                  text: `Your plan succeeds in ${chance}% of futures. You would also have $123,456 spare.`,
                },
              ],
            };
          })();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ model: 'claude-opus-5-5', ...reply }),
    });
  });

  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('anthropic');
  await form.getByLabel('API key, for this session only').fill(KEY);
  await form.getByRole('button', { name: 'Save' }).click();

  // The advisor is the chat panel. A free-form question goes to the AI (common
  // questions like "How likely is my plan to work?" are answered on the device).
  const panel = page.locator('chat-panel');
  const question = 'Talk me through my plan in a couple of sentences';
  await panel.getByLabel('Your message').fill(question);
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  const answer = panel.locator('.msg.reply').last();
  await expect(answer).toHaveAttribute('data-done', 'true', { timeout: 120_000 });
  await expect(answer.locator('.who')).toHaveText('Crux + Anthropic (Claude)');
  await expect(answer).toContainText('Your plan succeeds in');
  await expect(answer.locator('.steps')).toContainText('Ran a simulation');
  await expect(answer.locator('.meter')).toBeVisible();
  await expect(answer.locator('.unverified')).toContainText('$123,456');
  await expect(answer.locator('.unverified')).not.toContainText('%');
  // The screen the user was on went with the question, as a context line.
  expect(bodies[0]).toContain('[Screen: Settings]');
  expect(step).toBe(2);
  // The tool result sent back holds rounded aggregates, never account data.
  expect(bodies[1]).toContain('tool_result');
  expect(bodies[1]).not.toMatch(/SYN-[A-Z]/);

  // The same question about the same data on the same screen: the earlier answer, no new call.
  await panel.getByLabel('Your message').fill(question);
  await panel.getByRole('button', { name: 'Send' }).click();
  const again = panel.locator('.msg.reply').last();
  await expect(again.locator('.who')).toContainText('same answer as earlier');
  expect(step).toBe(2);
});
