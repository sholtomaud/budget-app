/** Streamed replies (ADR 0024): SSE parsing and folding into a Reply. */
import { describe, expect, test, vi } from 'vitest';
import { chatRequest, type Turn } from '../../src/api/llm.ts';
import { DEFAULT_PROVIDERS } from '../../src/api/providers.ts';
import {
  SseParser,
  STALL_MS,
  streamFolder,
  watchdog,
  type StreamDelta,
} from '../../src/api/stream.ts';
import { Rng } from '../../src/lib/prng.ts';

const provider = (id: string) => DEFAULT_PROVIDERS.find((p) => p.id === id)!;
const anthropic = provider('anthropic');
const gemini = provider('gemini');

const sse = (events: { event?: string; data: unknown }[]) =>
  events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`
    )
    .join('');

/** Feed `text` in random-sized chunks (a seeded split), collecting deltas. */
function run(cfg: typeof anthropic, text: string, seed = 1) {
  const rng = new Rng(seed);
  const parser = new SseParser();
  const folder = streamFolder(cfg);
  const deltas: StreamDelta[] = [];
  let i = 0;
  while (i < text.length) {
    const n = 1 + rng.int(40);
    for (const e of parser.push(text.slice(i, i + n))) deltas.push(...folder.push(e));
    i += n;
  }
  for (const e of parser.end()) deltas.push(...folder.push(e));
  return { deltas, reply: folder.finish() };
}

const textOf = (ds: StreamDelta[], kind: 'text' | 'note' = 'text') =>
  ds
    .filter((d) => d.kind === kind)
    .map((d) => (d as { text: string }).text)
    .join('');

describe('SSE parser', () => {
  test('events split across chunks, CRLF, comments and multi-line data', () => {
    const p = new SseParser();
    const out = [
      ...p.push(': keep-alive\r\n\r\nevent: a\r\nda'),
      ...p.push('ta: 1\r\ndata: 2\r\n\r\ndata: x'),
      ...p.end(),
    ];
    expect(out).toEqual([
      { event: 'a', data: '1\n2' },
      { event: 'message', data: 'x' },
    ]);
  });
});

describe('Anthropic stream', () => {
  const stream = sse([
    {
      event: 'message_start',
      data: { type: 'message_start', message: { model: 'claude-opus-5-5', content: [] } },
    },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Running the plan first.' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: "I'll run " },
      },
    },
    { event: 'ping', data: { type: 'ping' } },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'your plan.' },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'run_plan', input: {} },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"scenarioId": null, ' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '"runs": 200}' },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 30 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);

  test('text and notes as they arrive; the full reply, tool input and thinking at the end', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { deltas, reply } = run(anthropic, stream, seed);
      expect(textOf(deltas)).toBe("I'll run your plan.");
      expect(textOf(deltas, 'note')).toBe('Running the plan first.');
      expect(deltas).toContainEqual({ kind: 'tool', name: 'run_plan' });
      expect(reply.stop).toBe('tool');
      expect(reply.model).toBe('claude-opus-5-5');
      expect(reply.text).toBe("I'll run your plan.");
      expect(reply.calls).toEqual([
        { id: 'tu_1', name: 'run_plan', input: { scenarioId: null, runs: 200 } },
      ]);
      // Replayed unchanged next turn, thinking signature included.
      expect(reply.raw).toEqual([
        { type: 'thinking', thinking: 'Running the plan first.', signature: 'sig' },
        { type: 'text', text: "I'll run your plan." },
        { type: 'tool_use', id: 'tu_1', name: 'run_plan', input: { scenarioId: null, runs: 200 } },
      ]);
    }
  });

  test('after a fallback, earlier thinking and tool calls are not echoed; text is', () => {
    const s = sse([
      { data: { type: 'message_start', message: { model: 'claude-opus-4-8' } } },
      {
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      { data: { type: 'content_block_stop', index: 0 } },
      {
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: 'Part' },
        },
      },
      { data: { type: 'content_block_stop', index: 1 } },
      {
        data: {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
        },
      },
      { data: { type: 'content_block_stop', index: 2 } },
      {
        data: { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } },
      },
      {
        data: {
          type: 'content_block_delta',
          index: 3,
          delta: { type: 'text_delta', text: 'ial.' },
        },
      },
      { data: { type: 'content_block_stop', index: 3 } },
      { data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } },
    ]);
    const { reply } = run(anthropic, s);
    expect(reply.text).toBe('Partial.');
    expect((reply.raw as { type: string }[]).map((b) => b.type)).toEqual([
      'text',
      'fallback',
      'text',
    ]);
  });

  test('an error event stops the stream with its message', () => {
    const s = sse([
      { data: { type: 'message_start', message: { model: 'm' } } },
      {
        event: 'error',
        data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      },
    ]);
    expect(() => run(anthropic, s)).toThrow('Overloaded');
  });
});

describe('OpenAI-compatible stream (OpenAI, Gemini)', () => {
  test('text, then tool calls in fragments by index, extra fields kept for replay', () => {
    const s = sse([
      {
        data: {
          model: 'gemini-x',
          choices: [{ delta: { role: 'assistant', content: 'Let me ' } }],
        },
      },
      { data: { choices: [{ delta: { content: 'check.' } }] } },
      {
        data: {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'run_plan', arguments: '{"scenarioId":' },
                    extra_content: { google: { thought_signature: 'abc' } },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        data: {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'null,"runs":200}' } }] } },
          ],
        },
      },
      {
        data: {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'get_plan', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      },
      { data: '[DONE]' },
    ]);
    for (const seed of [1, 2, 3]) {
      const { deltas, reply } = run(gemini, s, seed);
      expect(textOf(deltas)).toBe('Let me check.');
      expect(deltas.filter((d) => d.kind === 'tool')).toHaveLength(2);
      expect(reply.stop).toBe('tool');
      expect(reply.model).toBe('gemini-x');
      expect(reply.calls).toEqual([
        { id: 'call_1', name: 'run_plan', input: { scenarioId: null, runs: 200 } },
        { id: 'call_2', name: 'get_plan', input: {} },
      ]);
      const raw = reply.raw as { content: string; tool_calls: Record<string, unknown>[] };
      expect(raw.content).toBe('Let me check.');
      expect(raw.tool_calls[0]).toMatchObject({
        id: 'call_1',
        extra_content: { google: { thought_signature: 'abc' } },
      });
    }
  });

  test('whole tool calls without an index; a tool turn that ends with "stop"', () => {
    const s = sse([
      {
        data: {
          choices: [
            {
              delta: {
                tool_calls: [
                  { id: 'a', type: 'function', function: { name: 'get_plan', arguments: '{}' } },
                  {
                    id: 'b',
                    type: 'function',
                    function: { name: 'list_scenarios', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        },
      },
      { data: '[DONE]' },
    ]);
    const { reply } = run(gemini, s);
    expect(reply.calls.map((c) => c.name)).toEqual(['get_plan', 'list_scenarios']);
    expect(reply.stop).toBe('tool');
  });

  test('a plain answer', () => {
    const s = sse([
      { data: { choices: [{ delta: { content: 'Hello.' }, finish_reason: 'stop' }] } },
      { data: '[DONE]' },
    ]);
    const { reply } = run(gemini, s);
    expect(reply).toMatchObject({ text: 'Hello.', calls: [], stop: 'end' });
    expect(reply.raw).toEqual({ role: 'assistant', content: 'Hello.' });
  });
});

describe('streamed chat requests', () => {
  const turns: Turn[] = [{ role: 'user', text: 'hi' }];
  test('Anthropic: stream on, progress notes on the models that give them', () => {
    const r = chatRequest(anthropic, { system: 's', turns, tools: [], stream: true });
    expect(r.body.stream).toBe(true);
    expect(r.body.thinking).toEqual({ type: 'adaptive', display: 'updates' });
    expect(r.headers['anthropic-beta']).toBe(
      'server-side-fallback-2026-07-01,thinking-display-updates-2026-08-18'
    );
    const older = chatRequest(
      { ...anthropic, model: 'claude-opus-4-8' },
      { system: 's', turns, tools: [], stream: true }
    );
    expect(older.body.thinking).toBeUndefined();
    expect(older.headers['anthropic-beta']).toBeUndefined();
    expect(chatRequest(anthropic, { system: 's', turns, tools: [] }).body.stream).toBeUndefined();
  });
  test('OpenAI-compatible: stream on', () => {
    expect(chatRequest(gemini, { system: 's', turns, tools: [], stream: true }).body.stream).toBe(
      true
    );
  });
});

describe('a reply that goes quiet is given up on, not waited for for ever', () => {
  test('the watchdog fires once after the silence, and each chunk resets it', () => {
    vi.useFakeTimers();
    try {
      let stalls = 0;
      const dog = watchdog(1000, () => stalls++);
      vi.advanceTimersByTime(900);
      dog.kick();
      vi.advanceTimersByTime(900);
      expect(stalls).toBe(0);
      vi.advanceTimersByTime(200);
      expect(stalls).toBe(1);
      dog.kick();
      vi.advanceTimersByTime(5000);
      expect(stalls).toBe(1);
      const quiet = watchdog(1000, () => stalls++);
      quiet.stop();
      vi.advanceTimersByTime(5000);
      expect(stalls).toBe(1);
      expect(STALL_MS).toBeGreaterThanOrEqual(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
