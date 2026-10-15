# ADR 0038 — A self-correcting budget: a feedback loop with a deadband, a gain and a floor

- Status: proposed
- Date: 2026-10-15
- SPEC: §9.2 (FR-BUD-001), §11.4, §13.3, NFR-MISSION-001; new requirements on acceptance
- Builds on: ADR 0023 (proposals as cards), ADR 0026 (plan checks), ADR 0032 (Run my plan), ADR 0033
  (the floor), ADR 0034 (budget lines on standard categories), the Bayesian spending model (FR-BAY)

## Context

The budget is open-loop. Crux measures the gap between budget and actual (actual vs budget, run
rates) and says nothing about what to do with it. People respond in one of two ways, both bad: they
ignore the gap, so the budget drifts away from reality and every plan built on it is wrong; or they
chase every month's noise, raising and cutting lines until the budget means nothing. The floor
(ADR 0033) showed the cost of the first: a Secure budget below what rent actually costs makes a plan
"work" that can't pay the rent.

Cybernetics names the problem. A household is a viable system (Beer): operations spend (System 1),
the budget coordinates them (2), a monthly review controls them (3), the forecast and the freedom
simulation look ahead (4), and the person's values set the policy (5): what Secure, Independent and
Luxury mean, and when they want to be free. Ashby's law says the controller must be able to absorb
the variety it faces, and his essential variables are the few things that must stay within limits
for the system to survive. A budget that corrects itself needs both: a loop for System 3, and a
clear account of what it may change and what only the person may.

## Decision

Crux closes the loop as a **monthly review** that proposes changes to budget lines. It never changes
the budget itself: every adjustment is a card the person applies or not (ADR 0023).

### 1. Essential variables, watched every review

1. **The floor holds:** the Secure tier covers what the essentials actually cost (ADR 0033's
   out-of-date check, per line instead of per group).
2. **The plan holds:** the chance of success at the plan's tier is at or above its target (the
   latest Run my plan; stale runs are re-run on the device before the review).
3. **The buffer holds:** cash on hand covers at least the person's chosen number of months of
   Secure spending (default 3).

A breach is not an adjustment: it is an **alert** at the top of the review, in words, with what can
be done (Beer's algedonic signal). Everything below serves these three.

### 2. The error, and a deadband from the model

Per budget line (or category, where lines share one), each review compares the budget with the
trailing three-month run rate, so one odd month is not a trend. The **deadband** is the Bayesian
spending model's 80 % predictive range for that category's month: an actual inside it is what the
model expects from noise, and nothing is proposed. Outside it, the error is the distance from the
budget. Without a usable fit (too little data, R̂ or ESS failing), the band is the 10th to 90th
percentile of the last 12 months, and with under 6 months of data no line is adjusted.

Known one-offs are feed-forward, not error: big purchases from the register, renewals the budget
already names, and transactions the person marks as one-off are left out of the run rate.

### 3. A gain, so the budget converges instead of oscillating

A proposal moves a line part of the way: `new = budget + k × (run rate − budget)`, with gain
`k = 0.5` by default, rounded to the line's own precision ($5 a week, $10 a month). A line is
proposed at most once per review and not again for two reviews after a change (hysteresis), so a
step response settles in a few months without overshoot. Proposals smaller than $5 a month or 2 %
of the line are dropped.

### 4. What may move, and which way

- **The setpoint is the person's (System 5).** The review adjusts lines within the plan's tier; it
  never changes the tier, the target or the date. When the essential variables can't be kept with
  line changes, the alert says so and offers the choice (a different tier, date or target), as a
  scenario to compare, not a change.
- **Secure lines only go up.** A line the Secure tier includes (multiplier above 0) is proposed
  upward when it costs more; it is never proposed downward to make a plan fit (ADR 0033). When it
  costs well less for 6 months, the review says so and leaves the decision to the person.
- **Discretionary lines are choices.** A line only higher tiers include, over its band, comes as a
  **choice card**: raise the line to what it costs, keep it and aim to spend less, or move the
  difference from another discretionary line. Each choice shows its effect on the chance of
  success and the freedom date, from the same run.

### 5. Where it lives

- **"Review my budget"** in the chat (a built-in answer, no AI needed) and a **Review** card on the
  Budget screen once a month: alerts first, then up to five proposals, largest effect first.
- The AI may explain a proposal and the choices, using the review's own figures (NFR-HON-002); it
  cannot add proposals of its own outside the review's rules.
- Each applied change is logged with the error, the band and the gain that produced it, so the
  person can see why the budget moved, and undo it.

## Consequences

- The budget tracks reality without chasing noise: the deadband absorbs the model's expected
  variety; the gain and the hysteresis keep the loop stable.
- The floor rises when essentials cost more, and never falls to make a plan fit.
- People decide everything that touches their values; the review decides only what it may measure.
- **Open questions** for implementation: whether `k` should depend on how sure the model is (a
  narrower band, a larger gain); per-line versus per-category review where lines share a category;
  how the review treats a new line with no history; the buffer's default and where cash on hand is
  read from.
- **Tests on acceptance:** unit tests for the deadband (inside, outside, no fit, too little data),
  the gain and rounding, hysteresis, the Secure-only-up rule, feed-forward exclusions and each
  alert; a simulated household whose rent steps up, checking that the budget converges within
  three reviews without overshoot; e2e for "Review my budget", a choice card and an undo.
