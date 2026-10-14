# ADR 0021 — Optional AI providers, the egress gate and the advisor

- Status: accepted
- Date: 2026-10-11
- SPEC: §13 (FR-API-001…005, §13.2, §13.3), §8 stage 6, FR-ING-017, §11.2, NFR-PRIV-003, NFR-HON-002

## Context

Milestone M8 adds optional calls to an external LLM: to classify leftover transactions, to map an
unusual budget CSV, and to power an advisor. Until now the app has made no network call at all
(NFR-PRIV-003). Every call is a privacy event, and an LLM that is allowed to state figures can
invent them (NFR-HON-002). The mission (NFR-MISSION-001) also applies: the advisor serves the user
and nothing else.

## Decision

### Keys are never stored on the device

API keys live **in memory, for the session only** (`src/app/egress.ts`). They are never written to
IndexedDB, never sealed into the vault and never included in a `.budgetapp` export. A reload or a
lock forgets them. Each key is attached only to requests to its own provider's endpoint. Provider
settings without the key (provider, endpoint, model) are saved like other settings.

This is stricter than the draft FR-API-001 ("stored locally, encrypted if encryption is on"). A
stored key is a long-lived credential that can be spent by anyone who unlocks or copies the data;
re-entering a key once per session is a small cost.

### One egress gate

Every external call goes through `send()` in `src/app/egress.ts`:

1. **Origin allow-list.** `ALLOWED_ORIGINS` (`src/api/providers.ts`) is the single list shared by
   the gate and the Content Security Policy's `connect-src` (`vite.config.ts`). A CSP cannot be
   widened at runtime, so the list is static: `https://api.anthropic.com`,
   `https://api.openai.com`, `https://generativelanguage.googleapis.com` (Gemini), and
   `http://localhost:*` / `http://127.0.0.1:*` for local
   OpenAI-compatible servers (Ollama, LM Studio, llama.cpp). Other hosted providers need a build
   with their origin added. A **Local model** provider (`http://localhost:8080`, llama-server's
   default) is listed by default, and a local endpoint needs no key: none is sent unless the
   person enters one (llama-server's `--api-key`). The consent dialog still shows each call. (Added
   2026-10-15.)
2. **Consent with the exact payload.** A dialog shows the provider, purpose, URL and the request
   body as it will be sent. "Don't send" sends nothing. "Don't ask again" holds only until the app
   reloads.
3. **Redaction** (`src/api/redact.ts`): account IDs, emails, BSBs with their account numbers, card
   numbers, phone-like numbers and long digit runs are replaced; amounts are bucketed ("$50–100") or
   rounded to two significant figures ("~$650,000"). The draft's "untick redaction for this call"
   is not offered: nothing in M8 needs exact data.
4. **A local log** of every call: time, provider, purpose, origin, SHA-256 of the body, bytes and
   HTTP status, kept in IndexedDB (last 500) and shown in Settings.

### Providers

Two adapters (`src/api/llm.ts`), no SDKs (ADR 0007):

- **Anthropic Messages API**, called from the browser with
  `anthropic-dangerous-direct-browser-access: true`. Structured answers use
  `output_config.format` with a JSON Schema; advisor tools are `strict: true`. Assistant turns are
  replayed exactly as returned, so thinking and tool-use blocks stay intact across tool rounds.
- **OpenAI-compatible Chat Completions**, with `response_format: json_schema` (strict) and strict
  function tools. This covers OpenAI and local servers.
- **Google Gemini** (added 2026-10-12), through Gemini's OpenAI-compatible endpoint
  (`/v1beta/openai/chat/completions`) with the same request and reply shapes, so structured
  answers and function tools need no second code path. The key is sent in the `Authorization`
  header, never as a `?key=` query parameter, which would end up in logs and browser history.
  Gemini's newer Interactions API (`/v1beta/interactions`) was considered. It would mean a third
  request format, and its built-in `google_search` tool must not be used here: it would send
  queries to Google Search, and the advisor's figures must come only from the app's own tools.
  Both endpoints allow calls from the app's origin (checked by CORS preflight).

Every structured answer is checked again on the device against the same schema; a refusal, a
truncated answer or a schema mismatch is an error, not a guess.

### Uses

- **Classification (§8 stage 6).** Only transactions still in the review queue, biggest first, at
  most 40 per call. Sent: merchant, redacted description, amount bucket, direction and the category
  list. The schema allows only known category ids or null. Labels are stored with the model name,
  applied at confidence 0.7 with provenance `by: 'llm'`, and never override the user's own choices.
- **Budget CSV mapping (FR-ING-017; the LLM tier of ADR 0014).** Sent: the first rows with every
  cell masked (`<date>`, `<number $1k–5k>`, redacted text cut to 40 characters). The answer is a
  mapping spec, validated locally (fields allowed for the type, columns in range, no duplicates),
  shown in the wizard as "Mapping suggested by …" and applied only when the user imports.
  In M8 the answer is the wizard's existing mapping, with one "suggested by" line for the whole
  mapping; the full mapping spec (FR-ING-015) and per-column provenance (FR-ING-018) come with the
  learned mapper in M10.
- **Price history: imported, not fetched.** The draft listed price and CPI APIs. Free price APIs do
  not reliably offer the multi-decade monthly history a bootstrap needs, and each new origin widens
  the CSP. Instead the user imports a CSV (Date plus Adj Close, Close or Price; at least 25 months).
  It becomes a block-bootstrap return model for holdings (`src/sim/history.ts`) and is stored on the
  device. CPI stays a manual assumption. A fetch can be added later through the same gate.

### The advisor (§13.3)

- A fixed tool set (`src/advisor/tools.ts`): `get_plan`, `get_spending_summary`, `list_scenarios`,
  `run_plan`, `propose_plan`, `explain_assumption`. Names differ from the draft
  (`get_scenario`, `run_scenario`, …) to match the screens; the contract is the same.
- Tools run on the device against the user's own data and the simulator. Results carry rounded
  figures only; `run_plan` returns a run id that the advisor must cite.
- `propose_plan` takes bounded lever changes (start, spending, project income, withdrawal), not a
  whole scenario. The change is applied by the same code as the optimiser's levers and saved as a
  scenario marked "Advisor" for the user to review. Nothing is changed without the user.
- **Figure check.** Every dollar amount and percentage in a reply is compared with the tool results
  in the conversation (within 1 %, or 0.5 percentage points for percentages, and probabilities as
  percentages). Figures from the user's own question are allowed. Anything else is shown as
  "Unverified figure".
- The system prompt states the mission, that the advisor cannot calculate, that this is not
  financial advice, and that it never recommends credit, buy-now-pay-later, gambling or speculative
  products. The advisor cannot see offers or bids (ADR 0018).
- A conversation is at most 8 model calls per question. Conversations are not stored.

Not in M8: an in-browser LLM (WebLLM), and the advisor writing `Goal`/`Tier` drafts.

## Consequences

- The app is still complete with no provider. With one configured, every byte that leaves is seen
  by the user first and logged.
- e2e tests mock the provider: they check that the key never reaches storage, that declining sends
  nothing, the request headers and schema, the log, and that an invented figure is flagged.
- Users of other hosted providers need the origin added to `ALLOWED_ORIGINS` in a build.
