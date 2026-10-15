/**
 * The egress gate (SPEC §13.1, FR-API-001…005, NFR-PRIV-003). Every request
 * to anything outside the app's origin goes through `send`:
 *
 *   1. the origin must be on the allow-list the CSP also enforces;
 *   2. the user sees the exact payload and confirms it, unless they chose
 *      "remember for this session" for this provider and purpose;
 *   3. the API key is attached from memory (never stored, ADR 0020);
 *   4. the call is logged locally: time, provider, purpose, payload hash, bytes.
 */
import { authHeaders, parseReply, type HttpRequest, type Reply } from '../api/llm.ts';
import {
  DEFAULT_PROVIDERS,
  isLocal,
  originAllowed,
  type ProviderConfig,
} from '../api/providers.ts';
import { SseParser, STALL_MS, streamFolder, watchdog, type StreamDelta } from '../api/stream.ts';
import { sha256Hex } from '../lib/hash.ts';
import { askConsent } from './components/consent-dialog/consent-dialog.ts';
import { sim } from './workers.ts';

export interface ProviderSettings {
  /** The provider the app's LLM features use, or null when they are off. */
  active: string | null;
  providers: ProviderConfig[];
}

export interface EgressLogEntry {
  at: string;
  provider: string;
  purpose: string;
  origin: string;
  sha256: string;
  bytes: number;
  status: number | null;
  /** Made by a schedule the person allowed to call the AI on its own (ADR 0041). */
  scheduled?: true;
}

/** API keys, in memory for this session only. */
const keys = new Map<string, string>();
const remembered = new Set<string>();
/** True only while a schedule allowed to call the AI runs: its calls skip the dialog, and are logged. */
let standing = false;

/**
 * Run a scheduled job with standing consent: the person allowed schedules to
 * call the AI on their own (ADR 0041). Calls are still checked, redacted and
 * logged, marked as scheduled.
 */
export async function withStandingConsent<T>(fn: () => Promise<T>): Promise<T> {
  standing = true;
  try {
    return await fn();
  } finally {
    standing = false;
  }
}

export const setKey = (providerId: string, key: string) => {
  if (key.trim()) keys.set(providerId, key.trim());
};
export const forgetKey = (providerId: string) => keys.delete(providerId);
export const hasKey = (providerId: string) => keys.has(providerId);

export async function loadProviderSettings(): Promise<ProviderSettings> {
  const s = (await sim().loadKv('providers')) as ProviderSettings | null;
  if (!s) return { active: null, providers: structuredClone(DEFAULT_PROVIDERS) };
  // New defaults appear for existing users without overwriting their edits.
  const ids = new Set(s.providers.map((p) => p.id));
  return { ...s, providers: [...s.providers, ...DEFAULT_PROVIDERS.filter((p) => !ids.has(p.id))] };
}

export const saveProviderSettings = (s: ProviderSettings) => sim().saveKv('providers', s);

/** The active LLM provider and its key, or a reason it isn't usable. */
export async function activeProvider(): Promise<
  { ok: true; provider: ProviderConfig } | { ok: false; reason: string }
> {
  const s = await loadProviderSettings();
  const p = s.providers.find((x) => x.id === s.active);
  if (!p) return { ok: false, reason: 'No AI provider is turned on. Choose one in Settings.' };
  if (!hasKey(p.id) && !isLocal(p.endpoint))
    return { ok: false, reason: `Enter your ${p.label} API key in Settings for this session.` };
  return { ok: true, provider: p };
}

export interface SendOptions {
  provider: { id: string; label: string };
  /** A stable purpose id (classify, mapping, advisor, prices) and a plain-language label. */
  purpose: string;
  purposeLabel: string;
  method?: 'POST' | 'GET';
  request: HttpRequest;
  /** Attach the provider's API key. */
  auth?: ProviderConfig;
  /** Shown in the dialog above the payload, e.g. what was redacted. */
  note?: string;
}

export class ConsentDeclinedError extends Error {
  constructor() {
    super('Not sent: you declined.');
    this.name = 'ConsentDeclinedError';
  }
}

/** Consent, the key and the log entry: everything before the request goes out. */
async function prepare(opts: SendOptions) {
  const { request: req } = opts;
  if (!originAllowed(req.url))
    throw new Error(`${new URL(req.url).origin} is not an allowed endpoint`);
  const method = opts.method ?? 'POST';
  const body = method === 'POST' ? JSON.stringify(req.body) : undefined;
  const key = `${opts.provider.id}|${opts.purpose}`;
  const scheduled = standing;
  if (!remembered.has(key) && !scheduled) {
    const answer = await askConsent({
      provider: opts.provider.label,
      purpose: opts.purposeLabel,
      url: req.url,
      payload: method === 'POST' ? req.body : null,
      note: opts.note,
    });
    if (!answer.ok) throw new ConsentDeclinedError();
    if (answer.remember) remembered.add(key);
  }
  const headers: Record<string, string> = { ...req.headers };
  if (opts.auth) {
    const k = keys.get(opts.auth.id);
    // A local server may run without a key (llama-server without --api-key, Ollama).
    if (k) Object.assign(headers, authHeaders(opts.auth, k));
    else if (!isLocal(opts.auth.endpoint))
      throw new Error(`No API key for ${opts.auth.label} in this session`);
  }
  const entry: EgressLogEntry = {
    at: new Date().toISOString(),
    provider: opts.provider.id,
    purpose: opts.purpose,
    origin: new URL(req.url).origin,
    sha256: await sha256Hex(body ?? req.url),
    bytes: new TextEncoder().encode(body ?? '').length,
    status: null,
    ...(scheduled ? { scheduled: true as const } : {}),
  };
  return { method, body, headers, entry };
}

export async function send(opts: SendOptions): Promise<unknown> {
  const { method, body, headers, entry } = await prepare(opts);
  try {
    const res = await fetch(opts.request.url, { method, headers, body });
    entry.status = res.status;
    const text = await res.text();
    if (!res.ok)
      throw new Error(`${opts.provider.label} returned ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    await sim().appendEgressLog(entry);
  }
}

/**
 * A streamed chat turn (ADR 0024): the same gate as `send`, then the reply is
 * read as server-sent events and handed out as it arrives. A provider that
 * answers with plain JSON instead still works. `signal` stops it (the Stop button).
 */
export async function sendStream(
  opts: SendOptions & {
    provider: ProviderConfig;
    signal?: AbortSignal;
    onSent?: () => void;
    onDelta?: (d: StreamDelta) => void;
  }
): Promise<Reply> {
  const { method, body, headers, entry } = await prepare(opts);
  // Stop (the person's signal) and silence (the watchdog) both abort the fetch.
  const ctl = new AbortController();
  const relay = () => ctl.abort(opts.signal?.reason);
  if (opts.signal?.aborted) relay();
  opts.signal?.addEventListener('abort', relay, { once: true });
  let stalled = false;
  const dog = watchdog(STALL_MS, () => {
    stalled = true;
    ctl.abort();
  });
  try {
    const res = await fetch(opts.request.url, { method, headers, body, signal: ctl.signal });
    dog.kick();
    entry.status = res.status;
    opts.onSent?.();
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${opts.provider.label} returned ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!/text\/event-stream/.test(res.headers.get('content-type') ?? '') || !res.body)
      return parseReply(opts.provider, JSON.parse(await res.text()));
    const parser = new SseParser();
    const folder = streamFolder(opts.provider);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const take = (events: ReturnType<SseParser['push']>) => {
      for (const e of events) for (const d of folder.push(e)) opts.onDelta?.(d);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      dog.kick();
      take(parser.push(value));
    }
    take(parser.end());
    return folder.finish();
  } catch (err) {
    if (stalled && !opts.signal?.aborted)
      throw new Error(
        `${opts.provider.label} stopped replying: nothing arrived for ${STALL_MS / 1000} s. Try again, or choose another model in Settings.`
      );
    throw err;
  } finally {
    dog.stop();
    opts.signal?.removeEventListener('abort', relay);
    await sim().appendEgressLog(entry);
  }
}

export const loadEgressLog = () => sim().loadEgressLog() as Promise<EgressLogEntry[]>;
