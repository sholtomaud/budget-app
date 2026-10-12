# ADR 0024 — Streamed AI replies and an activity log in the chat panel

- Status: accepted
- Date: 2026-10-12
- SPEC: §13.1 (egress), §13.3 (advisor), NFR-PRIV-003, NFR-HON-002
- Builds on: ADR 0021 (providers, egress gate), ADR 0023 (the chat panel)

## Context

ADR 0023 left true streaming for later: an AI reply appeared only once it had fully arrived, then
was typed out. During a tool loop the panel showed a single changing status line ("Working: Ran a
simulation…"), and whatever the AI said before calling a tool ("I'll run your plan first") was
lost.

The project owner asked for the panel to read like a log of what is happening behind the scenes:
the AI says what it is about to do, Crux says what it is doing on the device ("Running 500
simulated futures"), Crux says when it is sending something to the AI, and then the AI's answer
arrives. Each comes from a visibly different source.

## Decision

### Streaming from the providers

Advisor requests are sent with `stream: true` and read as server-sent events. This is plain
`fetch`, as before (ADR 0007), through the same egress gate: allow-list, consent, key from memory,
and the call log.

- **The parser** (`src/api/stream.ts`):
  - splits events across arbitrary chunk boundaries;
  - folds them into the same `Reply` the non-streamed parser produces, so the tool loop is
    unchanged.
- **Anthropic:**
  - `text_delta` is shown as it arrives;
  - `input_json_delta` is joined and parsed when its block stops;
  - `thinking_delta` and `signature_delta` are kept so thinking blocks replay unchanged;
  - an `error` event stops the reply with its message.
  - **After a server-side fallback,** blocks before the last `fallback` block are not echoed back,
    except text.
- **Progress notes (Anthropic):** Claude Opus 5.5, Claude Fable 5 / 5.1 and Claude Sonnet 5.5 are
  asked for `thinking: {type: "adaptive", display: "updates"}`, with the
  `thinking-display-updates-2026-08-18` beta. Those models then return short progress notes
  between tool calls; other models' thinking stays hidden.
- **OpenAI-compatible (OpenAI, Gemini):**
  - `delta.content` is shown as it arrives;
  - `delta.tool_calls` fragments are joined by `index`, or by `id` when a server sends whole calls
    without an index;
  - extra fields on a call (Gemini's `extra_content` thought signature) are kept for replay;
  - a tool turn that ends with `finish_reason: "stop"` still runs its tools.
- **A provider that answers with plain JSON** instead of a stream still works.
- **Eager input streaming** is not turned on. The advisor's tool inputs are a few fields, and each
  input is still validated against its schema before it runs.

### The activity log

Everything that happens while answering goes to the panel as it happens (`src/app/activity.ts`).
It is shown as separate bubbles, each labelled with its source:

| Bubble                       | Source        | Example                                                            |
| ---------------------------- | ------------- | ------------------------------------------------------------------ |
| Step (running → ✓ with time) | **Crux**      | Running your plan in 500 simulated futures… → Ran 500 … · 0.8 s    |
| Request                      | **Crux**      | Sent to Google Gemini (7.2 kB, amounts rounded) · replied in 1.1 s |
| Progress note                | **the AI**    | _Checking how the plan holds up before answering._                 |
| Aside (text before a tool)   | **Crux + AI** | I'll run your plan through some simulated futures first.           |
| Tool run                     | **Crux**      | Ran 200 simulated futures · 1.4 s (the AI asked; it ran here)      |
| Reply (streamed)             | **Crux + AI** | The answer, then cards, buttons and footnotes once it ends         |
| Cache hit                    | **Crux**      | Asked before about the same data on the same screen … Nothing sent |

Built-in answers use the same steps, so a question answered on the device also shows what ran.
Their reply is still typed out (display only; instant with reduced motion). The "What I did" list
from ADR 0023 is replaced by the log.

- **Every request is a visible event.** The log says when something is sent to an AI and how big
  it is, alongside the consent dialog and the call log in Settings.
- **The sizes:** the request body's size, after redaction.
- **Stop:**
  - aborts the request in flight;
  - keeps whatever arrived, marked as stopped;
  - drops the unfinished exchange from the conversation. A tool call without its result would make
    the next request invalid. Dropping only the tail keeps earlier thinking blocks valid.
- **Run ids** reported by tools become footnotes while the reply is still streaming.
- **The figure check** (NFR-HON-002) runs on the finished reply.

## Consequences

- **The person sees the work as it happens:** which steps ran on their device, what went to the
  AI, and when. A long tool loop no longer looks like a stalled spinner.
- **Interim AI text is kept, not lost.** If the AI states figures in an aside, those are not
  checked; only the final reply is. The style guide still requires every figure to come from a
  tool.
- **Tests:**
  - unit tests feed recorded event streams in random chunk sizes, for both protocols;
  - e2e tests stream from mocked providers (Anthropic with a tool loop; Gemini with Stop) and check
    the log's order and what was sent.
- **Untested against live providers.** The updates beta header is used as documented, but CI uses
  mocks; a 400 from a model that rejects it would show as an error in the log.
