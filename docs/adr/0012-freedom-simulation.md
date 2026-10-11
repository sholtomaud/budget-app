# ADR 0012 — Freedom simulation (M5)

- Status: accepted
- Date: 2026-10-11
- SPEC: §11.1, §11.2, §11.3, §17 refined; amended to match in Draft 7

## Decisions

1. **The GSSK model is closed.** `modelgen` emits only `storage` nodes:
   - The external pools `income` and `market` open at 1e10 dollars, far above any 40-year flow.
   - The sinks `opex`, `capex`, `tax` and `market_loss` open at zero and accumulate their offtake.
   - GSSK clamps a storage at zero, so a constant edge out of an empty node would create money.
     The pools are large so that never happens, and a run whose pool falls below zero is marked
     invalid.
2. **Every edge is `constant`, with k set monthly by the controller.**
   - With dt = 1 and RK4, a month's flow is exactly k. The controller computes each month's
     amounts in dollars and the kernel moves them.
   - Returns are discrete monthly gain and loss edges, with gain k = holding × max(r, 0). They are
     not the `interaction` edges sketched in §11.1, so the bridge test (FR-SIM-006) compounds
     exactly like a spreadsheet.
   - The controller writes a rate only when it changes, with its cause interned once
     (`policy:withdraw`, `policy:tax`, …). The mutation log explains every change, and
     `GSSK_Replay` of a run's log reproduces its final state.
3. **One OPEX sink, not one per category group.**
   - GSSK 5.3.0 scans the graph for 2–3 node motifs after every step and formats each canonical
     form with `printf`. A CPU profile puts most of each step's time there.
   - The cost grows with the edges at the bank: about 3 ms per edge per 420-step run.
   - Per-group spending is not a simulation output (the forecast already shows it), so the groups
     are summed in the controller. Raised as **KR-7**.
4. **FR-SIM-003 balance check.**
   - Each step, the change in money held by the household and the sinks must equal what the pool
     edges paid in. The tolerance is 1e-9 relative to household money (bank plus holdings, at
     least $1).
   - Per-node changes are summed, never totals, so the pools' size does not swamp the precision.
   - Each pool must also have paid out exactly that amount, to within $0.001.
5. **The controller** (§11.2):
   - **Order each month:** sample this month's returns, pay last month's tax, then spending, then
     sell holdings in the configured order to cover any deficit. Surplus above the bank buffer is
     invested by the allocation weights, but never in a month that sold.
   - **No storage ever goes negative.** Spending the controller cannot fund is a shortfall. Any
     shortfall after the goal's start fails the run, as does capital below the floor.
   - **Strategies:**
     - `percent` caps the draws at rate × capital, reset yearly.
     - `guardrails` starts at its initial rate (or the first year's need) and moves the
       withdrawal by `adjust` when the rate leaves the band. It succeeds while spending stays at or
       above `minSpendFraction` of the need.
     - `skim` caps the draws at the month's gains above the threshold.
     - `hold` never sells the named holdings.
   - **Tax** is PAYG-style: the financial-year-to-date liability is computed per person on salary
     plus investment income plus realised gains, the CGT discount applied after 12 months and
     losses carried forward. The increment is paid the following month.
     - Brackets are held constant in today's dollars.
     - Super is untaxed in the simulation: its earnings tax is in its return assumption, and
       withdrawals after preservation are tax-free.
     - Cost base is tracked per holding, not per lot.
6. **Monte-Carlo** (§11.2):
   - Run i takes seed `deriveSeed(seed, 'run', i)` for every input: returns, the spending
     quantile, and CAPEX renewals. Results are therefore the same however the runs are split
     across workers, which a test checks.
   - The pool has `hardwareConcurrency − 1` workers (at most 8), taking chunks as they free up.
   - Quantiles are exact: each chunk returns its capital paths, and the merge sorts each month.
     At 1 000 × 481 values that is 3.8 MB, cheaper than an approximate sketch.
   - The first 20 runs are kept as example paths.
   - Each result records the GSSK version, wasm SHA-256, model hash, inputs hash and seed
     (FR-SIM-004).
7. **Measured FR-SIM-005:** 1 000 runs × 480 months take 5.7 s in Chromium on 3 workers (a 4-core
   CI container), within the 10 s budget.
8. **Returns** (§10.3):
   - Lognormal and Student-t models are fitted on monthly log returns, so r > −100 % always.
     Student-t is scaled to unit variance.
   - Bootstrap models draw the same history months jointly.
   - The bootstrap histories are synthetic: 240 months of GARCH(1,1) shocks with a common factor,
     from a fixed seed, labelled `illustrative`. Imported or fetched histories arrive in M8.
9. **Metrics** (§11.3):
   - **Deterministic freedom number** (`assumed`): the tier's need (OPEX plus annualised CAPEX,
     less project income), grossed up by treating the whole withdrawal as taxable income split
     between the people, at the strategy's rate (4 % by default). This is conservative.
   - **P90 freedom number:** bisection over a uniform scale of today's holdings, with freedom
     starting at the goal's start. It uses 200 runs per candidate, with the same seeds for every
     candidate.
   - **Years to freedom:** keep working; the first month capital reaches the P90 number. P10, P50
     and P90 over 200 runs.
   - **Project runway:** reachable capital (no super before preservation, no property) over the
     tier's monthly need net of project income.
   - **Shortfall drivers:** returns, spending and CAPEX each frozen at the median in turn, compared
     on the same 200 runs.
10. **Inputs from data:**
    - Transaction and offset balances become the bank buffer; savings accounts become cash holdings
      (`actual`).
    - Money paid into investment categories becomes a holding at cost (`assumed`, editable).
    - Take-home pay is the 12-month average of income. Gross salary inverts the tax table
      (`assumed`).
    - The tier's spending comes from budget lines, or from current spending when there are none.
    - The setup lives in IndexedDB (`kv:freedom`).

## Consequences

- The kernel integrates every run, and its mutation log replays. Wall time per run is dominated by
  GSSK's motif scan, so KR-7 would make the simulator several times faster.
- Category-level spending is outside the GSSK model. If a later feature needs per-group sinks, the
  cost is linear in the number of groups.
- Shortfall drivers, which §19 lists under M6, ship in M5 because the Freedom screen shows them.
