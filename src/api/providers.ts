/**
 * External providers (SPEC §13, FR-API-001). Configuration is stored; API
 * keys never are. A key lives in memory for the session only, is sent only
 * to its own provider's endpoint, and is gone when the app locks or reloads
 * (ADR 0020).
 */

export type ProviderKind = 'anthropic' | 'openai-compatible';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  /** Base URL, e.g. https://api.anthropic.com. */
  endpoint: string;
  model: string;
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    kind: 'anthropic',
    label: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
  },
  {
    id: 'openai-compatible',
    kind: 'openai-compatible',
    label: 'OpenAI-compatible',
    endpoint: 'https://api.openai.com',
    model: 'gpt-4.1',
  },
];

/**
 * Origins the app may ever call (FR-API-005). The build's Content Security
 * Policy lists exactly these in `connect-src`; a meta CSP cannot be widened
 * at runtime, so a custom endpoint must be one of them.
 */
export const ALLOWED_ORIGINS = [
  'https://api.anthropic.com',
  'https://api.openai.com',
  'http://localhost:*',
  'http://127.0.0.1:*',
] as const;

export function originAllowed(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_ORIGINS.some((o) => {
    if (o.endsWith(':*')) {
      const base = o.slice(0, -2);
      return `${u.protocol}//${u.hostname}` === base;
    }
    return u.origin === o;
  });
}
