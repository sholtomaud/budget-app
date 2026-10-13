# ADR 0032 — Run my plan: one button, a dated history, and the same run for the AI

- Status: accepted
- Date: 2026-10-13
- SPEC: §11.4, FR-OPT-002, FR-OPT-007 (new), §12 (Freedom), §13.3, NFR-HON-002, NFR-STO-004
- Builds on: ADR 0012 (simulation), ADR 0022 (the Bayesian spending model), ADR 0026 (plan checks),
  ADR 0029 (one-click plans), ADR 0031 (the earliest freedom date)

## Context

The Freedom screen answered one question ("will my plan work, and what would help?") with four
buttons: **Simulate**, **Find** (the freedom number at the target), **Analyse** (what drives
shortfalls), and the earliest-date search, which lived only in the chat. Results vanished on
reload, so there was no way to see how a plan had changed. The AI could call several of the steps
as tools, but not the whole run, so its answer and the screen's could differ.

## Decision

### One button

**Run my plan** runs every step, in order of how quickly each answers, and shows each result as
it arrives:

1. the chance of success (the main simulation, at the chosen number of runs);
2. the plan checks;
3. the chance at the other tiers (200 runs each);
4. what drives shortfalls (200 runs per frozen input);
5. the freedom number at the target (bisection) and the years to reach it;
6. the earliest freedom date, with a safer and a spend-less plan (ADR 0031), never below what the
   essentials cost (ADR 0033);
7. how much the chance depends on the Bayesian spending model's starting assumptions: the plan on
   the same 200 futures with the priors as built, weakened (×0.5) and strengthened (×2) (the
   prior sensitivity of pSuccess ADR 0022 deferred). The refits use the model checks' lighter
   sampler settings. When the Bayesian model isn't in use, the step says so.

**Stop** ends the run after the current step and keeps what finished. The separate Simulate, Find
and Analyse buttons are gone. The earliest-date plans appear on the screen with **Use this plan**
and **Save as scenario**.

`runFullPlan` (`src/app/plan-run.ts`) does the work; the screen, the chat and the AI all call it,
so they give the same answer.

### A dated history

- **Every run is kept**, with its date, the inputs hash, the reproducibility record and the
  results: chance, tiers, checks, drivers, freedom numbers, years, the earliest-date plans, and the
  capital fan at one point a year. The simulated paths themselves are not kept.
- **The newest 20** are kept, in the vault (`plan-runs`): encrypted, exported, removed by
  delete-all.
- **Opening Freedom shows the last run.** It is marked out of date when the inputs hash of the
  current data and settings differs from the run's (the same hash the simulation records), and
  as soon as a setting is changed on the screen.
- **What changed:** the last run says how the chance moved since the run before.
- **History** lists the runs; **Show** opens any of them.

### The same run for the AI

- **`run_my_plan`** runs `runFullPlan`, keeps the run in the history and returns rounded facts
  (FR-API-003): every step's results, and the spending model's checks (ADR 0022) so the AI can say
  how far to trust the spending side.
- **`get_plan_history`** returns the earlier runs and whether the newest is out of date.
- **"Run my plan"** in the chat does the same on the device, with no AI, and answers in words.

### Savings over time in the chat

The kept capital fan is a chart dataset (`capital`, ADR 0028): "Chart my savings over time", or the
AI's `make_chart`, draws the latest run's typical future, the half-of-futures and 9-in-10 bands, and
the floor, a point a year, labelled _forecast_, with the run's date and a note when it is out of
date. Without a run, it says how to make one.

## Relationship to ADR 0029

This is ADR 0029's one button (FR-OPT-002). Its "three different plans" are, for now, ADR 0031's
three earliest-date plans; the multi-objective search (FR-OPT-003) and screen-then-confirm runs
(FR-OPT-004) remain to be built and will slot into steps 5 and 6.

## Consequences

- **One place to look:** the screen opens on the last answer, dated, and says when it's stale.
- **Slower than a single simulation:** a full run takes tens of seconds; the chance appears first
  and Stop is always there. FR-OPT-004 is what makes it faster.
- **Tests:** unit tests for the facts and words; e2e for the one button, history across a reload,
  stale marking, Stop, the built-in chat run and the AI's `run_my_plan`.
