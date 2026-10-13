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

/** An Anthropic Messages reply as server-sent events, as the API streams it. */
function anthropicSse(model: string, stop: string, blocks: Record<string, unknown>[]): string {
  const ev = (type: string, data: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { model, content: [] } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      // Word by word, as a model would.
      for (const w of String(b.text).split(/(?<= )/))
        out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: w } });
    } else if (b.type === 'thinking') {
      out += ev('content_block_start', {
        index,
        content_block: { type: 'thinking', thinking: '' },
      });
      out += ev('content_block_delta', {
        index,
        delta: { type: 'thinking_delta', thinking: b.thinking },
      });
      out += ev('content_block_delta', {
        index,
        delta: { type: 'signature_delta', signature: 's' },
      });
    } else {
      out += ev('content_block_start', { index, content_block: { ...b, input: {} } });
      out += ev('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
      });
    }
    out += ev('content_block_stop', { index });
  });
  out += ev('message_delta', { delta: { stop_reason: stop } });
  return out + ev('message_stop', {});
}

test('advisor: streamed, with an activity log; tool loop on this device; an invented figure is flagged (§13.3, NFR-HON-002)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  let step = 0;
  const bodies: string[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const body = route.request().postData() ?? '';
    bodies.push(body);
    step++;
    const sse =
      step === 1
        ? anthropicSse('claude-opus-5-5', 'tool_use', [
            { type: 'thinking', thinking: 'Checking the plan before answering.' },
            { type: 'text', text: "I'll run your plan first." },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'run_plan',
              input: { scenarioId: null, runs: 200 },
            },
          ])
        : (() => {
            const chance = /\\"chanceOfSuccess\\":\\"(\d+) %\\"/.exec(body)?.[1] ?? '?';
            return anthropicSse('claude-opus-5-5', 'end_turn', [
              {
                type: 'text',
                text: `Your plan succeeds in ${chance}% of futures. You would also have $123,456 spare.`,
              },
            ]);
          })();
    await route.fulfill({ contentType: 'text/event-stream', body: sse });
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
  await expect(answer.locator('.meter')).toBeVisible();
  // The activity log, in order: what was sent, the AI's note and aside, the
  // simulation it asked for, the results going back, then the reply.
  const log = panel.locator('.log > li');
  const kinds = await log.evaluateAll((lis) =>
    lis.map((li) => `${li.className.replace('msg ', '')}: ${li.textContent?.trim()}`)
  );
  const at = (re: RegExp) => kinds.findIndex((k) => re.test(k));
  expect(
    at(/^activity: Crux.*Sent to Anthropic \(Claude\) \(.*kB, amounts rounded\) · replied/)
  ).toBe(1);
  expect(at(/^ai-note: Anthropic \(Claude\)Checking the plan/)).toBeGreaterThan(1);
  expect(at(/^aside: Crux \+ Anthropic \(Claude\)I'll run your plan first\./)).toBeGreaterThan(1);
  expect(at(/^activity: .*Ran 200 simulated futures · \d+\.\d s/)).toBeGreaterThan(at(/^aside:/));
  expect(at(/^activity: .*Sent to Anthropic/)).toBeLessThan(at(/^activity: .*Ran 200/));
  expect(at(/^reply/)).toBe(kinds.length - 1);
  await expect(panel.locator('.msg.activity[data-state="running"]')).toHaveCount(0);
  await expect(answer.locator('.unverified')).toContainText('$123,456');
  await expect(answer.locator('.unverified')).not.toContainText('%');
  // The screen the user was on went with the question, as a context line.
  expect(bodies[0]).toContain('[Screen: Settings]');
  expect(JSON.parse(bodies[0]!).stream).toBe(true);
  expect(step).toBe(2);
  // The tool result sent back holds rounded aggregates, never account data.
  expect(bodies[1]).toContain('tool_result');
  expect(bodies[1]).not.toMatch(/SYN-[A-Z]/);

  // The same question about the same data on the same screen: the earlier answer, no new call.
  await panel.getByLabel('Your message').fill(question);
  await panel.getByRole('button', { name: 'Send' }).click();
  const again = panel.locator('.msg.reply').last();
  await expect(again.locator('.who')).toContainText('same answer as earlier');
  await expect(panel.locator('.msg.activity').last()).toContainText('Nothing sent');
  expect(step).toBe(2);
});

test('advisor: a model that keeps calling tools is asked for words after 8 rounds, so the chat always answers', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const bodies: Record<string, unknown>[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const sse = body.tool_choice
      ? anthropicSse('claude-opus-5-5', 'end_turn', [
          { type: 'text', text: 'Here is what I found so far.' },
        ])
      : anthropicSse('claude-opus-5-5', 'tool_use', [
          { type: 'tool_use', id: `tu_${bodies.length}`, name: 'get_plan', input: {} },
        ]);
    await route.fulfill({ contentType: 'text/event-stream', body: sse });
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
  await form.getByLabel('Provider').selectOption('anthropic');
  await form.getByLabel('API key, for this session only').fill(KEY);
  await form.getByRole('button', { name: 'Save' }).click();

  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('Talk me through my plan in a couple of sentences');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  const answer = panel.locator('.msg.reply').last();
  await expect(answer).toHaveAttribute('data-done', 'true', { timeout: 120_000 });
  await expect(answer).toContainText('Here is what I found so far.');
  expect(bodies).toHaveLength(9);
  expect(bodies.slice(0, 8).every((b) => !b.tool_choice)).toBe(true);
  expect(bodies[8]!.tool_choice).toEqual({ type: 'none' });
});

test('advisor: Gemini streams through its OpenAI-compatible endpoint; Stop cancels a request and the next one starts clean', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bodies: Record<string, unknown>[] = [];
  let release: () => void = () => {};
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (bodies.length === 1) {
      // The first request hangs until the test ends: only Stop gets out of it.
      await new Promise<void>((r) => (release = r));
      return route.abort().catch(() => {});
    }
    const chunk = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        chunk({ model: 'gemini-3.8-flash', choices: [{ delta: { content: 'Happy ' } }] }) +
        chunk({ choices: [{ delta: { content: 'to help.' }, finish_reason: 'stop' }] }) +
        'data: [DONE]\n\n',
    });
  });

  await page.goto('./');
  await page.getByLabel('Household').selectOption('default');
  await page.getByRole('button', { name: 'Load sample household' }).click();
  await expect(page).toHaveURL(/\/import$/);
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'AI provider' });
  await form.getByLabel('Provider').selectOption('gemini');
  await form.getByLabel('API key, for this session only').fill('gemini-test-key');
  await form.getByRole('button', { name: 'Save' }).click();

  const panel = page.locator('chat-panel');
  await panel.getByLabel('Your message').fill('Say something kind about saving');
  await panel.getByRole('button', { name: 'Send' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Don't ask again for this until the app reloads").check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('.msg.activity').last()).toContainText('to Google Gemini');
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.locator('.status')).toHaveText('Stopped.');
  release();

  await panel.getByLabel('Your message').fill('Say something kind about budgets');
  await panel.getByRole('button', { name: 'Send' }).click();
  const answer = panel.locator('.msg.reply').last();
  await expect(answer).toHaveAttribute('data-done', 'true');
  await expect(answer.locator('.who')).toHaveText('Crux + Google Gemini');
  await expect(answer.locator('.body')).toHaveText('Happy to help.');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]!.stream).toBe(true);
  // The stopped question was dropped: the conversation holds only the new one.
  const users = (bodies[1]!.messages as { role: string }[]).filter((m) => m.role === 'user');
  expect(users).toHaveLength(1);
});
