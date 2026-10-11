# ADR 0013 — Scenarios and the optimiser (M6)

- Status: accepted
- Date: 2026-10-11
- SPEC: §11.3, §11.4, §12 refined; amended to match in Draft 8

## Decisions

1. **Levers.** The optimiser moves four decision variables, each in natural units and bounded by
   the user:
   - when freedom starts, as years later or sooner (paid work moves with it);
   - spending after freedom, as a multiplier on the tier;
   - spending now, as a multiplier on today's spending (saving more);
   - project income, in dollars a year.

   The spending multipliers are stored on the setup (`levers`) and are also editable on the Freedom
   screen. Allocation, withdrawal strategy, housing and CAPEX decisions from §11.3 are not levers
   yet.

2. **Distance.** "Minimum change" is the Euclidean distance from the current setup, with each lever
   normalised to its bounds (0…1).
3. **Search** (§11.4):
   - **Up to two levers:** a coarse grid, then a finer grid around the best point.
   - **More than two:** CMA-ES. The objective is
     `distance + 4·max(0, target − pSuccess) + (distance outside the box)`. The answer is the
     nearest feasible candidate seen, not CMA-ES's mean.
   - The search stops at a simulation budget (20, 60 or 120 plans) and can be cancelled.
4. **Common random numbers.** Every candidate is simulated with the setup's seed and the same run
   indices. pSuccess is then a deterministic function of the levers, and a re-run gives the same
   answer, which a test checks.
5. **CMA-ES runs in ml-core.**
   - It is an ask/tell API over a flat state vector, `mc_cmaes_init/ask/tell`, and ml-core's ABI
     moves to version 2.
   - The caller passes in the standard-normal draws from the app's SplitMix64. The kernel is
     therefore pure arithmetic, and its TypeScript twin agrees within 1e-9 at every step (parity
     test).
   - The eigendecomposition is cyclic Jacobi, the same loop order in both languages.
   - The forecast worker runs it, because that worker already loads ml-core and the UI never
     touches WASM.
6. **Pareto set.** All evaluated candidates are filtered to those that no other candidate beats on
   pSuccess (↑), spending after freedom (↑) and freedom start (↓). This is the "Trade-offs" table.
   Any row can be kept as a scenario.
7. **Citations.** Every candidate and every comparison column cites its runs: the first 12 hex
   digits of the inputs hash, the seed and the run range.
8. **Scenarios** are saved setups in IndexedDB (`kv:scenarios`), from the Freedom screen or the
   optimiser.
   - Up to four can be compared side by side. Each is simulated with the chosen number of runs,
     and rows whose decisions differ are highlighted.
   - "Open in Freedom" makes a scenario the current plan.
9. **Property tests** (§16.1) run on random scenarios, comparing run by run with the same seeds:
   - more starting capital never turns a successful run into a failure, and never lowers the
     minimum capital;
   - doubling OPEX never turns a failed run into a success;
   - the money balance holds.

   A golden test pins pSuccess and end-capital quantiles for a fixed scenario and seed.

## Consequences

- With 100 runs per candidate, pSuccess moves in steps of 1 %. The answer is the smallest change
  that reaches the target on those runs, and keeping a result lets the user re-check it with more
  runs on the Freedom screen.
- Shortfall drivers shipped with M5 (ADR 0012).
