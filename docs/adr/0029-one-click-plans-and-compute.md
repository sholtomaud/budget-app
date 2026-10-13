# ADR 0029 — One-click plans: three different plans that work, found with less compute

- Status: proposed (milestone M11)
- Date: 2026-10-13
- SPEC: §11.4, FR-OPT-002…005, FR-SIM-005, NFR-DET-001, NFR-KER-001
- Builds on: ADR 0012 (simulation and the worker pool), ADR 0013 (optimiser), ADR 0026 (plan
  guidance), ADR 0027 (chat-first setup)

## Context

The Freedom screen asks for three clicks (simulate, find, analyse) to answer one question: "will
my plan work, and if not, what would?" The optimiser (ADR 0013) answers "what would" with the
**single** nearest change. People want a few genuinely different choices: "work 4 more years",
"spend 15 % less", "a smaller house and stop now".

The simulation also spends a lot of compute. It runs 1,000 simulated futures for every candidate
plan the optimiser tries. Those runs are not wasted: they measure how likely one plan is, and
12 runs can't tell 75 % from 95 % (the error bar is about ±9 points). But most candidates are
clearly good or clearly bad after far fewer runs.

## Decision

### One button

**Run my plan** on the Freedom screen, and "run my plan" in the chat, do it all:

1. Run the current plan (fast pass first, so a chance appears within about a second).
2. Run the plan checks (ADR 0026).
3. If the chance is below the target, search for plans that reach it (below).
4. Explain the result: the shortfall drivers and the three plans, as cards.

The separate buttons go. The steps show in the activity log (ADR 0024).

### Three different plans: a multi-objective genetic algorithm

The search becomes NSGA-II over the unlocked levers (`ml-core`, with a TypeScript twin and a
parity test, like CMA-ES). Its objectives:

- the chance of success (higher);
- when freedom starts (sooner);
- spending after freedom (higher);
- how far the plan moves from today's (smaller).

From the plans on the trade-off front that reach the target, the app picks **three that are far
apart** in lever space (max–min distance selection), so they are real alternatives, not three
versions of the same change. Each is offered as a scenario card. The single nearest plan of ADR
0013 is still available as "smallest change".

### Fewer runs: screen, then confirm

- **Screen:** every candidate gets 64 runs. All candidates share the same seeds and run indices
  (common random numbers), so comparisons between them are fair even at 64.
- **Confirm:** only the finalists (the trade-off front, at most about 12 plans) get the full
  1,000 runs. A finalist stops early when its 95 % interval is clearly above or below the target.
- **Reported numbers** always come from confirmed runs, with their run references. Screening
  numbers are never shown as a plan's chance.

Expected cost: about 10–20× fewer simulated futures than evaluating every candidate at 1,000.

### More threads, and WebGPU for the screen

- **Workers:** the existing pool (`hardwareConcurrency − 1`, up to 8) runs both passes.
- **WebGPU screening (optional):** a small batch simulator written as a compute shader runs the
  screen when WebGPU is available. It implements the same monthly model in pure arithmetic, so
  thousands of futures run in parallel.
- **GSSK stays the reference** (NFR-KER-001). Confirmed runs and every reported figure use GSSK
  in the workers. GPUs work in 32-bit floats, which drift over 40 years of compounding; that is
  acceptable for ranking candidates, not for reporting them.
- **Parity:** CI checks that the GPU screen and GSSK rank a fixed set of plans the same way, and
  agree on the chance within a tolerance, on the synthetic personas. Without WebGPU (or in CI
  without a GPU) the screen runs on the workers.
- **Deterministic:** the shader takes the same SplitMix64 seeds per run (NFR-DET-001).

## Consequences

- **One click, three answers:** the Freedom screen and the chat give the same result in one step.
- **Faster:** most of the compute goes to the plans that matter; the GPU path is a speed-up, never
  a source of reported numbers.
- **More code to keep in step:** the GPU simulator duplicates part of the model; the parity test
  is what keeps it honest.
- **ADR 0013 is extended, not replaced:** the grid and CMA-ES remain for "smallest change".
