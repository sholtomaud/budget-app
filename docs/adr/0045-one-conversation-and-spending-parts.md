# ADR 0045 — One conversation with the AI; the freedom number's spending in parts

- Status: accepted
- Date: 2026-10-22
- SPEC: §13.3, FR-GOAL-024 (new), FR-BUD-004 (new), NFR-HON-001, NFR-PRIV-003
- Amends: ADR 0023 (built-in answers first), ADR 0033 (the floor)

## Context

The project owner added a mortgage (about $3,000 a month) to the budget, then saw a freedom number
built on "$24,297 a year of spending" and asked why. The chat that followed went wrong in five ways:

1. **A pasted screen became a budget line.** The message contained "the spending is $24k" and
   "a year", which the built-in pattern took for "add a budget line". It offered a $636,455-a-year
   line four times.
2. **"Please ask Gemini" changed nothing.** Crux answered from its template every time.
3. **The repeat rule missed.** It sent a repeat to the AI only if the text was identical. Each
   re-send had a few words added.
4. **Gemini said it couldn't reach Gemini.** Its only instruction about itself was "you are the
   advisor inside Crux". So it said it was local, that nothing could be sent to Gemini, and that
   Crux connects to no AI service.
5. **The AI didn't see Crux's answers.** Its conversation held only the turns it answered itself.
   It couldn't tell what "that" referred to, or that the person had asked three times.

And the number itself couldn't be checked. The screen said "$24,297 a year of spending at a 4.0 %
withdrawal rate" with nothing to show how much of it was the tier's budget, the share after freedom,
big purchases or project income. A budget line can count as nothing at a plan's tier without anyone
being told: a share of 0 at that tier, or a period the app can't read. So a mortgage could be in
the budget and still not in the plan.

## Decision

### The chat

- **Cards only for one request.** A budget line, big purchase or category card needs a message of
  25 words or fewer, two sentences or fewer, and at most one dollar amount. Anything longer is a
  question, for the AI if one is set up.
- **The AI by name.** "Ask Gemini…", "send this to the AI", "local model: …", or the active
  provider's own name (`asksForAI`) skips Crux's built-in answers.
- **Near-repeats.** A message that shares at least 60 % of its words with the one Crux just
  answered goes to the AI (`sameMessage`), not only an identical one.
- **The model is told who it is** (`advisorSystem(label)`): the provider the person chose, reached
  with their consent. "Ask Gemini" means it. It must never claim to be local, or that Crux can't
  reach an AI.
- **Crux's answers are shared.** Exchanges Crux answered on the device since the AI's last turn
  (up to 6, each cut to 1,200 characters) go at the start of the AI's next message, marked as
  Crux's. A card is mentioned ("offered a card"), not its details. Like everything sent, they
  appear in the consent dialog first (NFR-PRIV-003).

### The spending, in parts

- **Every freedom number shows its year of spending in parts** (FR-GOAL-024): the tier's budget a
  month and its biggest groups, the share after freedom if it isn't 100 %, big purchases a month,
  and project income taken off. This shows on the Freedom screen, in the chat's full run, and in
  the run facts. `get_plan` gives the AI the same parts (`tierBudgetByGroupPerMonth`,
  `bigPurchasesPerMonth`), and the prompt tells it to explain a surprising figure from them.
- **Lines that count as nothing say so** (FR-BUD-004).
  - A line whose period can't be read is a plan problem: it is nothing in every plan.
  - An essential (housing, utilities, groceries and the rest, ADR 0033) with a share of 0 at the
    plan's tier is a note with its cost. The person may have meant it ("the mortgage ends before
    freedom"), so it is not a problem.
  - Both reach the AI as `budgetLinesNotCounted`.

## Consequences

- A person who asks the AI gets the AI, with the conversation they saw.
- A short request ("I pay $45 a month for the gym") still makes a card without an AI.
- Long requests with several amounts ("add $45 for the gym and $20 for Netflix") go to the AI,
  which can propose them on one card (ADR 0042). With no AI set up they get the usual "I can
  answer…" reply.
- A surprising freedom number can be traced to the budget line responsible from the screen alone.
- **Not decided here: a mortgage that ends.** A mortgage ends. A budget line runs for the whole
  plan, so a mortgage paid off in year 12 is still paid in year 31. Lines with an end date are a
  separate change.
