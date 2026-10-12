/**
 * Streamed replies (ADR 0024): server-sent events from Anthropic's Messages
 * API and from OpenAI-compatible chat completions (OpenAI, Gemini), folded
 * into the same `Reply` the non-streamed parser gives. Pure: the egress gate
 * reads the bytes; this turns them into text as it arrives and, at the end,
 * the full reply with its tool calls.
 */
import type { ProviderConfig } from './providers.ts';
import type { Reply, ToolCall } from './llm.ts';

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Splits a text stream into events. Feed it chunks as they arrive; it keeps
 * a partial event between chunks. Lines are LF or CRLF; `data:` lines join
 * with newlines; comments (`:`) are ignored.
 */
export class SseParser {
  private buf = '';

  push(chunk: string): SseEvent[] {
    this.buf += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(this.buf);
      if (!m) break;
      const raw = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const e = parseEvent(raw);
      if (e) out.push(e);
    }
    return out;
  }

  /** Whatever is left when the stream closes without a final blank line. */
  end(): SseEvent[] {
    const e = parseEvent(this.buf);
    this.buf = '';
    return e ? [e] : [];
  }
}

function parseEvent(raw: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

/** What a stream says as it goes. */
export type StreamDelta =
  /** Text for the person. */
  | { kind: 'text'; text: string }
  /** A progress note between tool calls (Claude's "updates" thinking display). */
  | { kind: 'note'; text: string }
  /** The model has started asking for a tool. */
  | { kind: 'tool'; name: string };

export interface StreamFolder {
  /** One event's data; returns what to show now. Throws on a provider error event. */
  push(e: SseEvent): StreamDelta[];
  /** The whole reply, once the stream has closed. */
  finish(): Reply;
}

export function streamFolder(cfg: ProviderConfig): StreamFolder {
  return cfg.kind === 'anthropic' ? new AnthropicFolder() : new OpenAiFolder();
}

type Block = Record<string, unknown> & { type: string };

const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/** Anthropic: message_start, content_block_start/delta/stop, message_delta, message_stop, error. */
class AnthropicFolder implements StreamFolder {
  private model = '';
  private stopReason = '';
  private readonly blocks: Block[] = [];
  private readonly partial = new Map<number, string>();

  push(e: SseEvent): StreamDelta[] {
    const d = parse(e.data) as Record<string, unknown> | undefined;
    if (!d) return [];
    switch (d.type) {
      case 'message_start': {
        const m = d.message as { model?: string };
        this.model = m.model ?? this.model;
        return [];
      }
      case 'content_block_start': {
        const b = structuredClone(d.content_block) as Block;
        if (b.type === 'tool_use') {
          b.input = {};
          this.partial.set(d.index as number, '');
        }
        this.blocks[d.index as number] = b;
        if (b.type === 'tool_use') return [{ kind: 'tool', name: String(b.name) }];
        if (b.type === 'text' && b.text) return [{ kind: 'text', text: String(b.text) }];
        return [];
      }
      case 'content_block_delta': {
        const i = d.index as number;
        const b = this.blocks[i];
        const delta = d.delta as Record<string, string>;
        if (!b) return [];
        switch (delta.type) {
          case 'text_delta':
            b.text = String(b.text ?? '') + delta.text;
            return [{ kind: 'text', text: delta.text ?? '' }];
          case 'input_json_delta':
            this.partial.set(i, (this.partial.get(i) ?? '') + delta.partial_json);
            return [];
          case 'thinking_delta':
            b.thinking = String(b.thinking ?? '') + delta.thinking;
            return delta.thinking ? [{ kind: 'note', text: delta.thinking }] : [];
          case 'signature_delta':
            b.signature = String(b.signature ?? '') + delta.signature;
            return [];
          default:
            // citations and other deltas: the final block is replayed as received.
            return [];
        }
      }
      case 'content_block_stop': {
        const i = d.index as number;
        const b = this.blocks[i];
        if (b?.type === 'tool_use') {
          const json = this.partial.get(i) ?? '';
          b.input = json ? (parse(json) ?? { $invalid: json }) : {};
        }
        return [];
      }
      case 'message_delta': {
        const delta = d.delta as { stop_reason?: string };
        if (delta.stop_reason) this.stopReason = delta.stop_reason;
        return [];
      }
      case 'error': {
        const err = d.error as { type?: string; message?: string } | undefined;
        throw new Error(`The provider stopped: ${err?.message ?? err?.type ?? 'error'}`);
      }
      default:
        return [];
    }
  }

  finish(): Reply {
    let content = this.blocks.filter(Boolean);
    // After a server-side fallback, blocks the declined model produced before the
    // last switch point are not echoed back, except text (claude-api guidance).
    const last = content.map((b) => b.type).lastIndexOf('fallback');
    if (last > 0)
      content = content.filter(
        (b, i) =>
          i >= last ||
          !['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'].includes(b.type)
      );
    return parseAnthropicContent(content, this.stopReason, this.model);
  }
}

export function parseAnthropicContent(content: Block[], stopReason: string, model: string): Reply {
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('');
  const calls: ToolCall[] = content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: String(b.id), name: String(b.name), input: b.input }));
  const stop =
    stopReason === 'end_turn'
      ? 'end'
      : stopReason === 'tool_use'
        ? 'tool'
        : stopReason === 'max_tokens'
          ? 'max_tokens'
          : stopReason === 'refusal'
            ? 'refusal'
            : 'other';
  return { text, calls, raw: content, stop, model };
}

interface OpenAiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
  [extra: string]: unknown;
}

/** OpenAI-compatible: `data: {choices:[{delta, finish_reason}]}` chunks, then `data: [DONE]`. */
class OpenAiFolder implements StreamFolder {
  private model = '';
  private text = '';
  private finish_reason = '';
  private readonly calls: OpenAiToolCall[] = [];

  push(e: SseEvent): StreamDelta[] {
    if (e.data.trim() === '[DONE]') return [];
    const d = parse(e.data) as
      | {
          model?: string;
          error?: { message?: string };
          choices?: {
            delta?: {
              content?: string | null;
              tool_calls?: (Partial<OpenAiToolCall> & {
                index?: number;
                function?: { name?: string; arguments?: string };
              })[];
            };
            finish_reason?: string | null;
          }[];
        }
      | undefined;
    if (!d) return [];
    if (d.error) throw new Error(`The provider stopped: ${d.error.message ?? 'error'}`);
    if (d.model) this.model = d.model;
    const c = d.choices?.[0];
    if (!c) return [];
    const out: StreamDelta[] = [];
    if (c.delta?.content) {
      this.text += c.delta.content;
      out.push({ kind: 'text', text: c.delta.content });
    }
    for (const t of c.delta?.tool_calls ?? []) {
      const i = this.slot(t.index, t.id);
      const { index: _i, function: fn, ...rest } = t;
      let call = this.calls[i];
      if (!call) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        this.calls[i] = call;
      }
      Object.assign(call, rest);
      if (fn?.name) {
        const first = !call.function.name;
        call.function.name += fn.name;
        if (first) out.push({ kind: 'tool', name: fn.name });
      }
      if (fn?.arguments) call.function.arguments += fn.arguments;
    }
    if (c.finish_reason) this.finish_reason = c.finish_reason;
    return out;
  }

  /**
   * Which call a fragment belongs to: its `index`, or (servers that send each
   * call whole and leave `index` out) the call with its id, a new call for a
   * new id, or the latest call for a fragment with neither.
   */
  private slot(index: number | undefined, id: string | undefined): number {
    if (index !== undefined) return index;
    if (id) {
      const i = this.calls.findIndex((x) => x?.id === id);
      return i >= 0 ? i : this.calls.length;
    }
    return Math.max(0, this.calls.length - 1);
  }

  finish(): Reply {
    const tool_calls = this.calls.filter(Boolean);
    const calls = tool_calls.map((t) => {
      const input = parse(t.function.arguments || '{}');
      return {
        id: t.id,
        name: t.function.name,
        input: input === undefined ? { $invalid: t.function.arguments } : input,
      };
    });
    const r = this.finish_reason;
    const stop =
      r === 'stop'
        ? 'end'
        : r === 'tool_calls'
          ? 'tool'
          : r === 'length'
            ? 'max_tokens'
            : r === 'content_filter'
              ? 'refusal'
              : // Some servers end a tool turn with "stop".
                calls.length
                ? 'tool'
                : 'other';
    return {
      text: this.text,
      calls,
      raw: {
        role: 'assistant',
        content: this.text || null,
        ...(tool_calls.length ? { tool_calls } : {}),
      },
      stop: stop === 'end' && calls.length ? 'tool' : stop,
      model: this.model,
    };
  }
}
