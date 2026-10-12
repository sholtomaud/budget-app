# ADR 0026 — Plan guidance: checks that find the settings behind a bad result

- Status: accepted
- Date: 2026-10-12
- SPEC: §11 (simulation), §13.3 (advisor), NFR-HON-002, NFR-MISSION-001
- Builds on: ADR 0022 (the model), ADR 0023/0024 (the chat panel), ADR 0025 (honest results)

## Context

The project owner tried their own plan and got 0 %. The simulation was right for what was entered,
but the inputs did not describe what they meant:

- **No pay.** Take-home pay and salaries were $0.
- **A late start.** Freedom started in July 2042, so 16 years were paid from savings.
- **Money that earns nothing.** $700,000 sat in "Cash kept in the bank", the everyday buffer,
  which the model treats as earning nothing.

Neither the app nor the AI said so. Gemini guessed at the cause. "Find changes" made things worse:
it pushed freedom later, which only adds years paid from savings when no pay comes in. Separately,
several money fields only accepted round amounts ($100 or $1,000 steps). The app filled them with
exact values, so the browser rejected the app's own defaults.

The owner put the point plainly: Crux is not only a simulation engine. It is also the guidance
around it. That guidance should show which settings explain a result, and which settings would
reach the goal.

## Decision

Crux has three layers, and this ADR adds the middle one:

1. **The engine:** the Bayesian forecast and the Monte-Carlo simulation (ADRs 0022, 0010).
2. **Guidance (new):** deterministic checks on the plan's settings, plus the optimiser.
   - They run on the device, with no AI.
   - Each finding is in plain words.
   - Where there is an obvious correction, it is offered as a change to apply, with Undo.
3. **Conversation:** the chat's built-in answers and the optional AI, which use the guidance
   layer and never replace it.

### The checks (`src/sim/checks.ts`)

| Check           | Level   | Finds                                                        | Offers                                         |
| --------------- | ------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `no-pay`        | problem | no take-home pay, and freedom starts 6+ months away          | Start freedom now                              |
| `pay-gap`       | problem | paid work ends 6+ months before freedom starts               | Work until freedom starts                      |
| `idle-bank`     | problem | "Cash kept in the bank" well over 6 months of spending       | Keep 6 months in the bank, rest to savings     |
| `over-spending` | problem | spending more than take-home pay while working               | (points to Transactions)                       |
| `all-cash`      | note    | 90 %+ of savings in cash over 15+ years                      | nothing: the person's call; a licensed adviser |
| `credits`       | note    | spending groups that took in more than they spent (ADR 0025) | (points to Transactions)                       |

**Mission guardrail.** No check recommends a product or an investment. `all-cash` only explains
what the app's own assumption means. It has no fix, and it points to a licensed adviser.

### Where the checks appear

- **Freedom screen:** a "Plan checks" panel. Fixes apply to the form, with Undo.
- **Chat, "How likely…":** each check is listed, problems first, with its fix as a card.
- **Chat, "Why is it low?":** leads with the problems.
- **Chat, "What would make it work?":** leads with the problems. When there is no pay before
  freedom, it does not try a later start; it tries spending, and offers the check's fix.
- **The AI:** a new `check_plan` tool. The system prompt says to call it first when a plan looks
  surprisingly bad. Fixes reach the person as cards.
- **New card kind:** `setup` changes the current plan. Undo restores the plan the check was made
  from. Applying it from the chat updates the Freedom screen.

### Inputs

Money and percentage fields accept any value (`step="any"`), so the app's own exact defaults and
the optimiser's results are valid input.

### Also fixed

When a run-id citation ended a paragraph, removing it also removed the paragraph break and the
next paragraph's opening `**`. Bold text after a citation therefore showed raw asterisks. Emphasis
next to a citation is now taken only if it wraps the citation.

## Consequences

- **Explained, not guessed.** A bad result caused by a setting now comes with the reason, in one
  sentence, and usually a one-click fix. Neither the person nor the AI has to work it out.
- **A layer to grow.** New checks are cheap to add. Each is a pure function of the setup and the
  spending, with a unit test.
- **Tests:**
  - unit tests cover the owner's plan exactly, a pay gap, over-spending, and a clean default plan;
  - an end-to-end test finds and fixes the owner's plan on the Freedom screen and from the chat,
    with Undo in both, and checks that the app's own defaults are valid input;
  - a markdown test covers the citation bug.

## Addendum: clearer "what would make it work"

The owner found the first answer from "find changes" hard to follow. It said "70 % of your planned
amount" with no dollars. The card repeated its summary. Its "Apply" only saved a scenario, so
"Applied." looked like a plan change that hadn't happened. And the person's own 90 % target was
flagged as an unverified figure. Now:

- **Dollars.** The change is stated in dollars a month ("about $2,700 a month after freedom instead
  of $3,900"), with the share in brackets.
- **Two cards.**
  - **Change my plan** applies the change to the current plan, with Undo.
  - **Save scenario** saves it to compare, and says the plan is unchanged.
  - Every card's button names what it does.
- **The figure check.** It counts the screen context the person sent as their own figures, so
  their target isn't flagged. The AI also receives the target in the tool result.
