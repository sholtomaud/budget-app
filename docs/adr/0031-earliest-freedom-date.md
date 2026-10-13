# ADR 0031 — The earliest freedom date

- Status: accepted
- Date: 2026-10-13
- SPEC: §11.4, FR-OPT-001, FR-OPT-006 (new), §13.3, NFR-DET-001, NFR-HON-002
- Builds on: ADR 0013 (optimiser), ADR 0023 (chat panel), ADR 0029 (three different plans)

## Context

Asked "what's the earliest I can retire?", the AI advisor had no tool for it. It searched by hand:
`propose_plan` for 3 years sooner, `run_plan`, then 6, 9, 12 and 15 years, one tool round each. That
is slow (200 simulated futures and a provider round trip per date), saves a scenario per date, and
it never finds the earliest date, only the last one it happened to try.

It also ran out of tool rounds. The conversation loop stopped after 8 requests even when the last
reply was a tool call, so the question ended with an empty answer ("The provider gave no answer").

The optimiser (ADR 0013) answers a different question: the smallest change that reaches the target
when the plan falls short. It never looks for sooner dates.

## Decision

1. **A search for the date.** While pay comes in before freedom, starting later never lowers the
   chance of success, so it is (near enough) monotone in the start date. `src/optimise/earliest.ts`
   bisects over start dates on a 3-month grid, from now to 10 years after the current start.
   Every candidate runs on the same simulated futures (common random numbers), so the comparison is
   fair, and a re-run gives the same answer. The answer is always a date that was simulated and
   reached the target; about log2 of the grid's size in simulations (200 futures each) instead of
   one per date.
2. **Three plans.** The same search, with shared results, gives:
   - the earliest date at the target;
   - the earliest with a safer margin (target + 5 points, at most 99 %);
   - the earliest when spending 10 % less after freedom.

   A plan on the same date as the first is dropped. Each is offered as a scenario card (nothing is
   saved until the person clicks), and the first also as "Use in my plan".

3. **In the chat.** "What's the earliest I can retire?", "how soon can I stop work" and the like are
   recognised without an AI and answered by the app. With an AI provider, the new
   `find_earliest_freedom` tool returns the plans' rounded facts and run ids, and the system prompt
   tells the AI to call it once instead of testing dates itself.
4. **The chat always answers.** After 8 rounds of tool calls, one more request goes with
   `tool_choice: none` (Anthropic and OpenAI-compatible, including Gemini), so the model answers with
   what it has. If a provider still returns a tool call, that turn is dropped and the person is told
   the advisor ran out of steps.

## Consequences

- The answer arrives in one step, with real alternatives, as ADR 0029 asks; NSGA-II there remains
  the general search over all levers.
- If the chance is not monotone in the start date (for example, no pay before freedom), the
  bisection still returns a simulated date that meets the target, but not necessarily the earliest.
  The plan checks (ADR 0026) are shown alongside, as they flag that case.
