# ADR 0027 — Chat-first setup: guided steps, AI for what the steps don't recognise

- Status: accepted for setup (M10, first part built); goals from words and spending insights proposed (M11)
- Date: 2026-10-13
- SPEC: §12 (screens), §13.3 (advisor), FR-SETUP-001…006, FR-GOAL-010…012, NFR-HON-002,
  NFR-PRIV-003, NFR-MISSION-001
- Builds on: ADR 0020 (landing page), ADR 0021 (providers and the egress gate), ADR 0023 (chat
  panel), ADR 0024 (streaming and the activity log), ADR 0026 (plan guidance)

## Context

Crux works, but setting it up takes too many screens. Import, the mapping wizard, the budget,
big purchases and the Freedom goal editor each need a visit, in the right order, and the menu
doesn't say what that order is. The chat panel (ADR 0023) already answers questions and proposes
changes as cards. It can carry setup too.

People also describe what they want in words, not in levers: "I want to stop working as soon as
possible, buy a house and a nice car." Today they have to turn that into a freedom start date, a
tier and big purchases by hand.

## Decision

### A chat landing page, beside Start until it proves itself

- **New screen:** a full-width chat (route `/chat`). The menu sits on the left, as a hamburger
  on phones. Charts and cards appear in the conversation.
- **Start stays the default landing page.** The chat landing is offered from Start ("Set up by
  chatting") and the menu. We switch the default only when the chat setup shows it works: people
  finish setup more often, in fewer steps, than through the screens.
- **Every screen stays.** The chat is a front door, not a replacement. Results it creates are
  saved where they are today, and the menu opens them.

### Setup is a set of small state machines

Each setup flow is a state machine in plain TypeScript (`src/assistant/flows/`). Each state asks
one question and offers buttons, with typed answers accepted too:

| Flow            | Asks                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Your data**   | Do you have transactions? A bank export (CDR JSON or CSV), an accounting export (MYOB, Xero), a personal spreadsheet, several CSV files, or none: try a sample household |
| **Your budget** | Do you have a budget file? Import it, build one from your transactions, or start from a tier                                                                             |
| **Your goals**  | What do you want? Free text or chips (stop working, house, car, travel, children, study)                                                                                 |
| **Your plan**   | Runs the plan in one step (ADR 0029) and shows the three plans                                                                                                           |

- **States are data:** each has an id, a prompt, the answers it accepts (button values, a typed
  pattern, or a JSON Schema for AI answers) and the next state per answer.
- **Resumable:** the current state is saved with the household, so setup continues where it
  stopped.
- **Testable without a DOM:** flows are pure functions of (state, answer) → (next state, effects).
  Effects (import, apply a card, run the plan) go through the same functions as the screens.

### AI for answers the steps don't recognise

- **First:** buttons and the built-in patterns (`src/assistant/intents.ts`).
- **Then, if an AI provider is set up:** the unrecognised text goes to the cloud provider (Gemini,
  Anthropic or OpenAI-compatible; ADR 0021) with the current state's JSON Schema as a
  **structured output**. The reply is validated locally against the schema; an invalid reply is
  rejected and the question is asked again.
- **Without a provider:** the step says it didn't understand and shows its buttons. Setup is
  always possible with buttons alone.
- **No local model.** An in-browser LLM is parked (SPEC §23).

### Goals from words

"Stop working now, a house, a nice car" becomes a **goals draft** (`schemas/goals-draft.schema.json`):

- `freedomStart`: "as soon as possible" or a date or age;
- `purchases`: item, rough timing, and a cost only if the person said one;
- `tier` hints ("comfortable", "frugal") and non-negotiables;
- `unknowns`: what still needs a number.

Rules:

- **The AI never supplies a price** (NFR-HON-002). Missing costs become follow-up questions ("Roughly
  what would the house cost? Which city?"). If the person skips, the app offers a default from a
  shipped table, labelled `assumed`.
- **Nothing is saved without a click.** The draft is shown as cards: big purchases, a goal and a
  tier, each with Apply and Undo (ADR 0023).
- **Built-in path:** the goal chips produce the same draft without any AI.

### Spending insights as scenarios

- **Insight:** a category is compared with the household's own history and with published
  household spending (ABS, labelled `assumed`). It is phrased as a trade-off in freedom time:
  "Cafes cost about 5 months of freedom".
- **Suggestion:** a change is offered as a scenario card ("Half the cafe visits, bulk coffee from
  the supermarket"). It shows the savings and the new freedom date. A shopping list is a scenario
  of budget-line changes.
- **No named stores or products** until there is a price source and the offers rules of §22 apply.
  Suggestions describe what would happen, not what the person should do: information, not
  personal advice (open question 13).

## Built so far (M10, first part)

- **The flows:** your data, your budget and your plan (`src/assistant/flows/setup.ts`), run by
  `src/app/setup-runner.ts`. "Your goals" waits for goals from words (M11); until then, the plan
  step runs the Freedom screen's settings.
- **The chat screen:** `/chat`, offered from Start and the menu. The top bar, the getting-started
  bar and the chat panel step aside there.
- **Shared conversation:** the chat panel and the chat screen use one `Conversation`
  (`src/app/conversation.ts`) for messages, the activity log, cards and buttons.
- **Data paths:** CDR files and the sample households import as today. Budget CSVs are previewed
  with the wizard's detection; when a sheet isn't recognised and a provider is on, the AI mapping
  assistant (FR-ING-017) proposes a mapping. Bank and accounting CSV exports say they aren't
  readable yet and offer another way, until the adapters (later in M10).
- **What is saved:** the step setup is waiting at, in IndexedDB with the household (`setup`),
  removed by delete-all. Steps that hold files in memory resume at their section's question.
- **AI reading:** one structured-output call (purpose `setup`) with the step's question, its
  options and the message; consent and the call log as for every AI call. An answer of "other"
  goes to the advisor as an ordinary question.

## Consequences

- **More reach, same honesty:** setup by conversation, with every figure still computed by the app
  and every change still a card.
- **Two front doors to test:** e2e tests cover each flow with buttons only (no network), and with
  a mocked provider for free text.
- **Schemas grow:** each AI-answered state has a JSON Schema in `schemas/`, validated with the
  in-house subset validator.
- **Decision to revisit:** making the chat the default landing page, on the evidence above.
