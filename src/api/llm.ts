/**
 * LLM provider adapters (SPEC §13.2, §13.3), as pure functions: build a
 * request (without the key) and parse a reply. One normalised conversation
 * maps onto Anthropic's Messages API and onto OpenAI-compatible chat
 * completions. No SDK (ADR 0007): plain fetch, done by the egress gate.
 *
 * Structured outputs: Anthropic's `output_config.format` with a JSON
 * Schema, and `strict: true` tools; OpenAI-compatible `json_schema`
 * response format and strict function tools (ADR 0014).
 */
import { formatError, validate, type Schema } from '../lib/jsonschema.ts';
import type { ProviderConfig } from './providers.ts';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema; objects must set additionalProperties: false (strict tools). */
  input_schema: Schema;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type Turn =
  | { role: 'user'; text: string }
  /** `raw` is the provider's own content, replayed unchanged (thinking blocks included). */
  | { role: 'assistant'; text: string; calls: ToolCall[]; raw: unknown }
  | { role: 'tool'; results: { id: string; content: string; isError?: boolean }[] };

export interface HttpRequest {
  url: string;
  /** Headers except authentication, which the egress gate adds. */
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface Reply {
  text: string;
  calls: ToolCall[];
  raw: unknown;
  stop: 'end' | 'tool' | 'max_tokens' | 'refusal' | 'other';
  model: string;
}

const ANTHROPIC_VERSION = '2023-06-01';
/** Server-side refusal fallback for the current Claude models (claude-api guidance). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const usesFallback = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
const trim = (s: string) => s.replace(/\/+$/, '');

export function authHeaders(cfg: ProviderConfig, key: string): Record<string, string> {
  return cfg.kind === 'anthropic' ? { 'x-api-key': key } : { authorization: `Bearer ${key}` };
}

function anthropicBase(cfg: ProviderConfig, maxTokens: number): HttpRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    // The user's own key, called from their own browser.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: maxTokens };
  if (usesFallback(cfg.model)) {
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  return { url: `${trim(cfg.endpoint)}/v1/messages`, headers, body };
}

function openaiBase(cfg: ProviderConfig): HttpRequest {
  return {
    url: `${trim(cfg.endpoint)}/v1/chat/completions`,
    headers: { 'content-type': 'application/json' },
    body: { model: cfg.model },
  };
}

function anthropicMessages(turns: readonly Turn[]): unknown[] {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', content: t.text };
    if (t.role === 'assistant') return { role: 'assistant', content: t.raw };
    return {
      role: 'user',
      content: t.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  });
}

function openaiMessages(system: string, turns: readonly Turn[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') out.push(t.raw);
    else
      for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  return out;
}

/** A tool-using chat turn (the advisor). */
export function chatRequest(
  cfg: ProviderConfig,
  opts: { system: string; turns: readonly Turn[]; tools: readonly ToolDef[]; maxTokens?: number }
): HttpRequest {
  const maxTokens = opts.maxTokens ?? 16_000;
  if (cfg.kind === 'anthropic') {
    const r = anthropicBase(cfg, maxTokens);
    r.body.system = opts.system;
    r.body.messages = anthropicMessages(opts.turns);
    r.body.tools = opts.tools.map((t) => ({ ...t, strict: true }));
    return r;
  }
  const r = openaiBase(cfg);
  r.body.max_tokens = maxTokens;
  r.body.messages = openaiMessages(opts.system, opts.turns);
  r.body.tools = opts.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
      strict: true,
    },
  }));
  return r;
}

/** A single structured answer conforming to `schema` (classification, CSV mapping). */
export function structuredRequest(
  cfg: ProviderConfig,
  opts: { system: string; user: string; schema: Schema; name: string; maxTokens?: number }
): HttpRequest {
  const maxTokens = opts.maxTokens ?? 16_000;
  if (cfg.kind === 'anthropic') {
    const r = anthropicBase(cfg, maxTokens);
    r.body.system = opts.system;
    r.body.messages = [{ role: 'user', content: opts.user }];
    r.body.output_config = { format: { type: 'json_schema', schema: opts.schema } };
    return r;
  }
  const r = openaiBase(cfg);
  r.body.max_tokens = maxTokens;
  r.body.messages = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
  r.body.response_format = {
    type: 'json_schema',
    json_schema: { name: opts.name, schema: opts.schema, strict: true },
  };
  return r;
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export function parseReply(cfg: ProviderConfig, json: unknown): Reply {
  if (cfg.kind === 'anthropic') {
    const r = json as { content: AnthropicBlock[]; stop_reason: string; model: string };
    const text = r.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const calls = r.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id!, name: b.name!, input: b.input }));
    const stop =
      r.stop_reason === 'end_turn'
        ? 'end'
        : r.stop_reason === 'tool_use'
          ? 'tool'
          : r.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : r.stop_reason === 'refusal'
              ? 'refusal'
              : 'other';
    return { text, calls, raw: r.content, stop, model: r.model };
  }
  const r = json as {
    model: string;
    choices: {
      finish_reason: string;
      message: {
        content: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const c = r.choices[0]!;
  const calls = (c.message.tool_calls ?? []).map((t) => {
    let input: unknown;
    try {
      input = JSON.parse(t.function.arguments);
    } catch {
      input = { $invalid: t.function.arguments };
    }
    return { id: t.id, name: t.function.name, input };
  });
  const stop =
    c.finish_reason === 'stop'
      ? 'end'
      : c.finish_reason === 'tool_calls'
        ? 'tool'
        : c.finish_reason === 'length'
          ? 'max_tokens'
          : c.finish_reason === 'content_filter'
            ? 'refusal'
            : 'other';
  return {
    text: c.message.content ?? '',
    calls,
    raw: { role: 'assistant', content: c.message.content, tool_calls: c.message.tool_calls },
    stop,
    model: r.model,
  };
}

/** Parse and validate a structured answer. Throws with the validation error. */
export function parseStructured<T>(cfg: ProviderConfig, json: unknown, schema: Schema): T {
  const reply = parseReply(cfg, json);
  if (reply.stop === 'refusal') throw new Error('The provider declined to answer');
  if (reply.stop === 'max_tokens') throw new Error('The answer was cut off (max tokens)');
  let value: unknown;
  try {
    value = JSON.parse(reply.text);
  } catch {
    throw new Error('The provider did not return JSON');
  }
  const err = validate(schema, value);
  if (err) throw new Error(`The answer did not match the schema: ${formatError(err)}`);
  return value as T;
}

/** Validate a tool call's input against its tool's schema (strict tools still get checked). */
export function checkToolInput(tool: ToolDef, input: unknown): string | null {
  const err = validate(tool.input_schema, input);
  return err ? formatError(err) : null;
}
