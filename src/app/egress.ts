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
import { authHeaders, type HttpRequest } from '../api/llm.ts';
import { DEFAULT_PROVIDERS, originAllowed, type ProviderConfig } from '../api/providers.ts';
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
}

/** API keys, in memory for this session only. */
const keys = new Map<string, string>();
const remembered = new Set<string>();

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
  if (!hasKey(p.id))
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

export async function send(opts: SendOptions): Promise<unknown> {
  const { request: req } = opts;
  if (!originAllowed(req.url))
    throw new Error(`${new URL(req.url).origin} is not an allowed endpoint`);
  const method = opts.method ?? 'POST';
  const body = method === 'POST' ? JSON.stringify(req.body) : undefined;
  const key = `${opts.provider.id}|${opts.purpose}`;
  if (!remembered.has(key)) {
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
    if (!k) throw new Error(`No API key for ${opts.auth.label} in this session`);
    Object.assign(headers, authHeaders(opts.auth, k));
  }
  const entry: EgressLogEntry = {
    at: new Date().toISOString(),
    provider: opts.provider.id,
    purpose: opts.purpose,
    origin: new URL(req.url).origin,
    sha256: await sha256Hex(body ?? req.url),
    bytes: new TextEncoder().encode(body ?? '').length,
    status: null,
  };
  try {
    const res = await fetch(req.url, { method, headers, body });
    entry.status = res.status;
    const text = await res.text();
    if (!res.ok)
      throw new Error(`${opts.provider.label} returned ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    await sim().appendEgressLog(entry);
  }
}

export const loadEgressLog = () => sim().loadEgressLog() as Promise<EgressLogEntry[]>;
