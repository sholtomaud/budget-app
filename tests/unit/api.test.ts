import { describe, expect, test } from 'vitest';
import {
  authHeaders,
  chatRequest,
  checkToolInput,
  parseReply,
  parseStructured,
  structuredRequest,
  type ToolDef,
  type Turn,
} from '../../src/api/llm.ts';
import { DEFAULT_PROVIDERS, isLocal, originAllowed } from '../../src/api/providers.ts';
import { bucketAmount, redactText, roughAmount } from '../../src/api/redact.ts';
import type { Schema } from '../../src/lib/jsonschema.ts';

const provider = (id: string) => DEFAULT_PROVIDERS.find((p) => p.id === id)!;
const anthropic = provider('anthropic');
const openai = { ...provider('openai-compatible'), endpoint: 'http://localhost:11434/' };
const gemini = provider('gemini');

const schema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['labels'],
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'categoryId'],
        properties: { ref: { type: 'integer' }, categoryId: { enum: ['food.groceries', null] } },
      },
    },
  },
};

const tool: ToolDef = {
  name: 'run_scenario',
  description: 'Run a scenario',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
};

describe('providers and redaction (FR-API-003, FR-API-005)', () => {
  test('only allow-listed origins can be called', () => {
    expect(originAllowed('https://api.anthropic.com/v1/messages')).toBe(true);
    expect(originAllowed('http://localhost:11434/v1/chat/completions')).toBe(true);
    expect(
      originAllowed('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    ).toBe(true);
    expect(originAllowed('https://evil.example/v1')).toBe(false);
    expect(originAllowed('https://api.anthropic.com.evil.example')).toBe(false);
    expect(originAllowed('not a url')).toBe(false);
  });

  test('amounts are bucketed and aggregates rounded', () => {
    expect(bucketAmount(-63.85)).toBe('$50–100');
    expect(bucketAmount(4_200)).toBe('$2,000–5,000');
    expect(bucketAmount(80_000)).toBe('over $50,000');
    expect(roughAmount(653_412)).toBe('~$650,000');
    expect(roughAmount(0)).toBe('$0');
  });

  test('identifiers are removed from free text', () => {
    const s = redactText(
      'TRANSFER TO SYN-SAV 062-000 4321 ref 12345678 jo@example.com card xx1234 call 02 9999 1234'
    );
    expect(s).not.toMatch(/SYN-|jo@|1234|4321|12345678|062/);
    expect(s).toContain('[bsb account]');
    expect(s).toContain('[account]');
  });
});

describe('LLM adapters', () => {
  test('Anthropic structured request: output_config.format with the schema; the key is not in it', () => {
    const r = structuredRequest(anthropic, { system: 's', user: 'u', schema, name: 'labels' });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.body.output_config).toEqual({ format: { type: 'json_schema', schema } });
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.stringify(r)).not.toContain('sk-');
    expect(authHeaders(anthropic, 'sk-test')).toEqual({ 'x-api-key': 'sk-test' });
  });

  test('OpenAI-compatible structured request: json_schema response format', () => {
    const r = structuredRequest(openai, { system: 's', user: 'u', schema, name: 'labels' });
    expect(r.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(r.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'labels', schema, strict: true },
    });
    expect(authHeaders(openai, 'k')).toEqual({ authorization: 'Bearer k' });
  });

  test("Gemini: Google's OpenAI-compatible endpoint, same request shape, Bearer key", () => {
    const r = structuredRequest(gemini, { system: 's', user: 'u', schema, name: 'labels' });
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(r.body.model).toBe('gemini-3.8-flash');
    expect(r.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'labels', schema, strict: true },
    });
    const c = chatRequest(gemini, {
      system: 's',
      turns: [{ role: 'user', text: 'q' }],
      tools: [tool],
    });
    expect(c.url).toBe(r.url);
    expect((c.body.tools as { type: string }[])[0]!.type).toBe('function');
    // The key goes in a header, never in the URL (where it would end up in logs and history).
    expect(authHeaders(gemini, 'k')).toEqual({ authorization: 'Bearer k' });
    expect(r.url).not.toContain('key=');
  });

  test('a structured answer is parsed and validated', () => {
    const ok = {
      content: [{ type: 'text', text: '{"labels":[{"ref":1,"categoryId":"food.groceries"}]}' }],
      stop_reason: 'end_turn',
      model: 'm',
    };
    expect(parseStructured(anthropic, ok, schema)).toEqual({
      labels: [{ ref: 1, categoryId: 'food.groceries' }],
    });
    const bad = {
      content: [{ type: 'text', text: '{"labels":[{"ref":1,"categoryId":"made.up"}]}' }],
      stop_reason: 'end_turn',
      model: 'm',
    };
    expect(() => parseStructured(anthropic, bad, schema)).toThrow('did not match');
    const refusal = { content: [], stop_reason: 'refusal', model: 'm' };
    expect(() => parseStructured(anthropic, refusal, schema)).toThrow('declined');
  });

  test('Anthropic tool loop: tool_use parsed, raw content replayed unchanged, results as tool_result', () => {
    const json = {
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Let me run it.' },
        { type: 'tool_use', id: 'tu_1', name: 'run_scenario', input: { id: 'current' } },
      ],
    };
    const reply = parseReply(anthropic, json);
    expect(reply.stop).toBe('tool');
    expect(reply.calls).toEqual([{ id: 'tu_1', name: 'run_scenario', input: { id: 'current' } }]);
    const turns: Turn[] = [
      { role: 'user', text: 'How likely?' },
      { role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw },
      { role: 'tool', results: [{ id: 'tu_1', content: '{"pSuccess":0.91}' }] },
    ];
    const r = chatRequest(anthropic, { system: 'sys', turns, tools: [tool] });
    const msgs = r.body.messages as { role: string; content: unknown }[];
    expect(msgs[1]!.content).toBe(json.content); // thinking block kept
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"pSuccess":0.91}' }],
    });
    expect((r.body.tools as { strict: boolean }[])[0]!.strict).toBe(true);
  });

  test('OpenAI-compatible tool loop', () => {
    const json = {
      model: 'local',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{ id: 'c1', function: { name: 'run_scenario', arguments: '{"id":"x"}' } }],
          },
        },
      ],
    };
    const reply = parseReply(openai, json);
    expect(reply.calls).toEqual([{ id: 'c1', name: 'run_scenario', input: { id: 'x' } }]);
    const r = chatRequest(openai, {
      system: 'sys',
      turns: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: '', calls: reply.calls, raw: reply.raw },
        { role: 'tool', results: [{ id: 'c1', content: 'ok' }] },
      ],
      tools: [tool],
    });
    const msgs = r.body.messages as { role: string }[];
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(r.body.tool_choice).toBeUndefined();
  });

  test('the last request of a tool loop asks for words, keeping the tools defined', () => {
    const turns = [{ role: 'user' as const, text: 'q' }];
    const a = chatRequest(anthropic, { system: 's', turns, tools: [tool], toolChoice: 'none' });
    expect(a.body.tool_choice).toEqual({ type: 'none' });
    expect(a.body.tools).toHaveLength(1);
    const o = chatRequest(gemini, { system: 's', turns, tools: [tool], toolChoice: 'none' });
    expect(o.body.tool_choice).toBe('none');
    expect(o.body.tools).toHaveLength(1);
  });

  test('tool inputs are validated', () => {
    expect(checkToolInput(tool, { id: 'a' })).toBeNull();
    expect(checkToolInput(tool, { id: 1 })).toMatch(/id/);
    expect(checkToolInput(tool, { id: 'a', extra: 1 })).not.toBeNull();
  });
});

describe('LLM classification payload (§8 stage 6, FR-API-003)', async () => {
  const { classifyPrompt, labelsFromAnswer } = await import('../../src/api/classify-llm.ts');
  const { defaultCategories } = await import('../../src/classify/categories.ts');
  const { validate } = await import('../../src/lib/jsonschema.ts');
  const items = [
    {
      key: 'SYN-TXN\u001fSYN-TXN-000193',
      merchant: 'FRESH FIELDS',
      description: 'FRESH FIELDS 0231 NEWTOWN AU card xx1234',
      amount: -63.85,
    },
    {
      key: 'SYN-TXN\u001fSYN-TXN-000194',
      merchant: 'TRANSFER',
      description: 'TRANSFER TO SYN-SAV 062-000 4321 ref 12345678',
      amount: -500,
    },
  ];
  const p = classifyPrompt(items, defaultCategories());

  test('carries no identifiers or exact amounts', () => {
    const sent = p.system + p.user;
    expect(sent).not.toMatch(/SYN-|xx1234|4321|12345678|63\.85|000193/);
    expect(sent).toContain('$50–100');
    expect(p.payloadItems.map((i) => i.ref)).toEqual([1, 2]);
  });

  test('the schema only allows known categories or null, and refs map back to keys', () => {
    const ok = {
      labels: [
        { ref: 1, categoryId: 'food.groceries' },
        { ref: 2, categoryId: null },
      ],
    };
    expect(validate(p.schema, ok)).toBeNull();
    expect(validate(p.schema, { labels: [{ ref: 1, categoryId: 'made.up' }] })).not.toBeNull();
    expect(labelsFromAnswer(p, ok)).toEqual([{ key: items[0]!.key, categoryId: 'food.groceries' }]);
  });
});

describe('a local model (llama.cpp, Ollama, LM Studio)', () => {
  test('a server on this computer is local: allowed, and a key is optional', () => {
    const local = provider('local');
    expect(local.kind).toBe('openai-compatible');
    expect(originAllowed(local.endpoint)).toBe(true);
    expect(isLocal(local.endpoint)).toBe(true);
    expect(isLocal('http://127.0.0.1:11434')).toBe(true);
    expect(isLocal('https://api.openai.com')).toBe(false);
    expect(isLocal('http://localhost.example.com')).toBe(false);
    expect(isLocal('not a url')).toBe(false);
  });
});
