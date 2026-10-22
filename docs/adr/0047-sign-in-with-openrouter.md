# ADR 0047 — Sign in with OpenRouter

- Status: accepted
- Date: 2026-10-22
- SPEC: §13 FR-API-006 (new), FR-API-001…005, NFR-PRIV-003
- Builds on: ADR 0021 (providers and the egress gate), ADR 0018 (monetisation)

## Context

The chat is much better with an AI provider, but getting one means creating an account with
Anthropic, Google or OpenAI, finding the API console, making a key, setting up billing, and pasting
the key in. Running a model locally is harder still. Most people who would use Crux won't do either.

Hosted AI credits (ADR 0018) would fix that, but they need a server: a relay that holds our key and
meters each person's use. That server, Stripe and the privacy rules it needs are a separate decision.
Until then, people need a way in that needs no server of ours.

OpenRouter offers OAuth PKCE for exactly this. A web app sends the person to OpenRouter to sign in;
they come back with a one-time code; the app exchanges the code for an API key tied to their own
OpenRouter account. They pay OpenRouter. OpenRouter's chat API is OpenAI-compatible, which Crux
already speaks.

## Decision

1. **OpenRouter is a provider**: `openrouter`, OpenAI-compatible at `https://openrouter.ai/api`
   (chat at `/api/v1/chat/completions`), with model `openrouter/auto` by default and any model id
   accepted. `https://openrouter.ai` joins the allow-list and the CSP's `connect-src`.
2. **Sign in with PKCE (S256)**: **Sign in with OpenRouter** on Settings.
   - It turns the provider on and makes a verifier (32 random bytes, base64url) and its challenge
     (base64url of its SHA-256).
   - It keeps the verifier in the tab's `sessionStorage` for the round trip. The verifier is
     single-use, not a key.
   - It goes to `https://openrouter.ai/auth` with the callback and the challenge.
3. **The callback is the app's root**, a real page on any static host (a deep link is a 404 on
   GitHub Pages). At start-up, a `?code=` with a kept verifier opens Settings.
4. **The exchange goes through the egress gate**, like every call.
   - It is a POST to `/api/v1/auth/keys` with only the code, the verifier and the method. The
     person sees it in the consent dialog first, and it is logged.
   - The code is removed from the address bar and the verifier from storage, whatever happens.
5. **The key is held like any other** (FR-API-001): in memory, never stored or exported, forgotten
   on reload or lock. Signing in again is a click on Settings plus OpenRouter's approval.
6. **Crux gets nothing from it**: no referral, no account data. It is a free way in, beside
   bring-your-own-key and local models, and beside paid hosted credits if those come.

## Consequences

- Anyone can get the chat working without a key or a local model, and without a server of ours.
- OpenRouter sees the advisor's requests, as any provider does. They go to the provider the person
  chose, redacted, with consent per call. The models behind OpenRouter have their own data terms,
  and choosing one is the person's decision. The user guide says so.
- **Not verified against the live service.** The flow follows OpenRouter's PKCE documentation;
  the build environment couldn't reach openrouter.ai, so tests use a mock of it. Check a real
  sign-in on the deployed site before announcing it.
- `openrouter/auto` may choose a model without tool calls. If the advisor's tools fail with it,
  name a model that supports them.
- A key that lasts only for the session means signing in again after each reload. That is the
  existing rule for every key (ADR 0021), and it keeps a long-lived key out of the browser's
  storage.
