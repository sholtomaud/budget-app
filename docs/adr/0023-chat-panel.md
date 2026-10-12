# ADR 0023 — The chat panel: built-in answers first, AI second, changes as cards

- Status: accepted
- Date: 2026-10-12
- SPEC: §12 (screens), §13.3 (advisor), NFR-HON-002, NFR-PRIV-003, NFR-MISSION-001
- Builds on: ADR 0021 (providers, egress gate, advisor), ADR 0022 (the model's checks)

## Context

The M8 advisor was a separate screen that only worked with an AI provider and an API key. Its
first real answer (Gemini, the default synthetic household) was useful but showed the problems:

- markdown shown raw (`**0 %**`);
- the same run reference three times;
- a disclaimer repeated in every reply;
- and a bare "0 %" with no "why" or "what would help".

The person using Crux may know budgeting arithmetic but not statistics. A chat that sits beside
every screen can carry much of the work: explaining results, taking costs in plain words, and
finding what would make a plan work.

## Decision

### A panel, not a screen

- **Placement:** a right-hand panel (like VS Code's chat), open by default on wide screens,
  resizable, and closable with the **Chat** button or Ctrl+J.
- **Persistence:** it stays open, with its conversation, as you move between screens.
- **Phones:** a full-screen sheet, closed by default, opened from an **Ask Crux** button.
- **What is kept:** the open state and width, as preferences under `budget-app:` keys, so
  delete-all clears them.
- **The old `/advisor` address** opens the panel.

### Built-in answers first ("Crux")

Common questions and requests are recognised by simple patterns (`src/assistant/intents.ts`).
They are answered from the app's own results with templated text: no AI and no network.

| Ask                                      | Answer, from                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| How likely is my plan to work?           | A 500-run simulation; a chance meter against the target                                      |
| Why is it low?                           | Typical capital at the freedom date against the freedom number; the biggest shortfall driver |
| What would make it work?                 | The optimiser on when freedom starts and spending after it; offered as a scenario card       |
| How sure is the forecast?                | The Bayesian model's checks (ADR 0022) in plain words                                        |
| Where does my money go?                  | The last 12 months by group                                                                  |
| What does P90 / freedom number / … mean? | A plain glossary                                                                             |
| Explain this screen                      | The getting-started guide's text for the screen                                              |
| Show me the forecast                     | Opens the screen                                                                             |
| I pay $45 a month for the gym            | A budget-line card                                                                           |
| My car is 6 years old                    | A Big purchases card                                                                         |
| Categorise the cafe ones as Cafes        | A category-change card                                                                       |

**Numbers become words by lookup** (`src/assistant/phrases.ts`):

- frequencies, not probabilities: "in about 9 in 10 simulated futures";
- rounded dollars: "$1.6 million";
- calibration in words: "about right", "a little cautious".

The numbers themselves are always the app's.

### AI second ("Crux + provider")

Anything else goes to the AI provider, if one is set up, through the egress gate (ADR 0021):
consent, redaction and the call log.

- **Context:** the message carries the screen ("[Screen: Forecast · 2-year forecast, 8
  categories]"). It's shown as a chip the person can remove.
- **More tools:** the model gets new ones, built on the same code as the built-in answers:
  - `explain_shortfall`, `find_plan_changes`, `get_forecast_confidence`;
  - `propose_budget_line`, `propose_big_purchase`, `propose_categorisation`;
  - `go_to_screen`.
- **Style guide** in the system prompt:
  - frequencies, not jargon;
  - cite a run once (the app makes it a footnote);
  - never claim a change was made;
  - no repeated disclaimer.
- **Cache:** the same question, on the same screen, about the same data and plan is answered
  from this session's cache. It is labelled "same answer as earlier", and nothing is sent.

### Every reply says where it came from

- **"Crux · on this device"** or **"Crux + Gemini"**. A person always knows whether their
  question went to an AI.
- **Typed-out display:** replies are revealed progressively. That is display only, and it is
  instant with reduced motion.
- **"What I did"** lists the steps taken: "Ran your plan in 500 simulated futures".

### Changes are cards

Nothing changes without a click:

- Proposals show their details, editable: item, amount, how often, category, cost.
- **Apply** writes through the same functions as the screens.
- **Undo** reverses it: it deletes the line or asset, clears the labels, or removes the scenario.

The person can always see what will change before it does.

### Formatting

- **Safe markdown** (`src/assistant/markdown.ts`): a small subset (paragraphs, lists, bold,
  italic, code) is parsed to a tree and built as DOM nodes. Nothing in a reply is ever treated as
  HTML.
- **Run references** become numbered footnotes.
- **A short trailing "not financial advice" note** is dropped; the panel shows it once.
- **Unverified figures** are still flagged (NFR-HON-002).

## Not in this change

- **True token streaming from the providers.** Parsing Anthropic's and the OpenAI-compatible
  server-sent events, including tool calls and Anthropic's thinking blocks, is a separate change.
  Until then, replies are typed out once they arrive.
- **Saved conversations.** They stay in memory for the session, as the project owner chose.
- **Out of scope for the panel's cards:** deleting anything, imports, encryption and settings.

## Consequences

- **Useful to everyone, on the device:** the panel works with no provider, so the AI becomes an
  addition, not a requirement.
- **Testing:** e2e tests cover the built-in path (no network), cards with Apply and Undo, phones,
  and the AI path with a mocked provider (label, figure check, cache).
- **Tests needed updating:** the panel is open on desktop by default, so tests that look for
  generic elements (a status line, a button named "Chat") must scope to their screen.
