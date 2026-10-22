/** Sign in with OpenRouter (ADR 0047): the PKCE parts. */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  authUrl,
  base64url,
  challengeOf,
  keyFrom,
  keyRequest,
  newVerifier,
} from '../../src/api/openrouter.ts';
import { DEFAULT_PROVIDERS, originAllowed } from '../../src/api/providers.ts';
import { chatRequest } from '../../src/api/llm.ts';

describe('OpenRouter sign-in (PKCE, S256)', () => {
  test('a verifier is 43 base64url characters, fresh each time', () => {
    const a = newVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newVerifier()).not.toBe(a);
  });

  test('the challenge is base64url(SHA-256(verifier)), no padding', async () => {
    const v = newVerifier();
    expect(await challengeOf(v)).toBe(createHash('sha256').update(v).digest('base64url'));
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  test('the sign-in address carries the callback and the challenge', () => {
    const u = new URL(authUrl('https://crux.example/settings', 'abc'));
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      callback_url: 'https://crux.example/settings',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
    });
  });

  test('the exchange sends only the code and the verifier; the key comes back', () => {
    const r = keyRequest('the-code', 'the-verifier');
    expect(r.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(r.body).toEqual({
      code: 'the-code',
      code_verifier: 'the-verifier',
      code_challenge_method: 'S256',
    });
    expect(keyFrom({ key: ' sk-or-1 ' })).toBe('sk-or-1');
    expect(keyFrom({ error: 'bad code' })).toBeUndefined();
    expect(keyFrom(null)).toBeUndefined();
  });

  test('OpenRouter is a provider: allowed origin, OpenAI-compatible chat at /api/v1', () => {
    const p = DEFAULT_PROVIDERS.find((x) => x.id === 'openrouter')!;
    expect(originAllowed('https://openrouter.ai/api/v1/auth/keys')).toBe(true);
    const req = chatRequest(p, { system: 's', turns: [{ role: 'user', text: 'hi' }], tools: [] });
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
