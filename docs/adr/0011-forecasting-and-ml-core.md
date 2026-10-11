# ADR 0011 — Forecasting and ml-core (M4)

- Status: accepted
- Date: 2026-10-11
- SPEC: §10, §15.2, §16.2 refined; amended to match in Draft 6

## Decisions

1. **Candidates per series** (§10.1):
   - Regular series: seasonal naive, the historical mean, and ETS.
   - ETS is additive Holt–Winters with a damped trend, φ ∈ {0.8, 0.9, 0.98, 1}.
   - Intermittent series (≥ 30 % zero months) use Croston, SBA and TSB instead of ETS.
   - Parameters come from a fixed grid by in-sample SSE, so fits are deterministic.
   - **The seasonal component needs three full seasons** (36 months). With two, twelve seasonal
     indices from two observations each fit noise: on synthetic data, cafe and restaurant forecasts
     oscillated. Under three seasons, ETS is Holt with a damped trend.
   - The mean is in the set because flat, noisy household spending is often best forecast by
     its average.
2. **Choice** is by rolling-origin backtest from 6 months of training, scored on the next 3 months by
   MASE, with pinball loss reported. Ties go to the simpler method.
3. **Quantiles** come from a residual bootstrap. The point forecast is perturbed by resampled
   one-step residuals that persist with weight 0.5, so uncertainty widens with the horizon without
   a pure random walk's runaway spread. Paths are floored at zero. The total is the sum of category
   paths, treating categories as independent, and the UI says so.
4. **Short histories** (< 6 months) use the budget line for the chosen tier, labelled `budgeted`.
5. **CAPEX forecast** (FR-FC-010): a seeded Monte-Carlo over the register, 2 000 runs.
   - Owned assets renew on Weibull lives conditional on age.
   - Wish and planned items count only with a "buy by" decision. An undecided wish item contributes
     nothing, since the register has no purchase probability.
6. **Evaluation** (§16.2):
   - **OPEX:** method choice on the first 18 months, scored against seasonal naive on the held-out
     6 months, pooled over the three personas × five seeds (135 series). A single persona has
     8–11 series, too few to judge an 80 % share; per-persona results ranged 73–100 %, pooled
     90 %.
   - **Replacement windows:** P10–P90 coverage over 30 seeds × 3 personas (300 assets): 81 %.
7. **ml-core is plain wasm32 exports**: `extern "C"` functions over `f64` buffers in linear memory,
   with `mc_alloc` and `mc_free`. There is no wasm-bindgen and no crates (ADR 0007).
   - `src/forecast/mlcore.ts` owns all pointer handling.
   - The ABI is versioned (`mc_version`).
   - The toolchain is pinned in `rust-toolchain.toml`.
   - `npm run build` and `npm test` build the crate first.
8. **One kernel interface, two implementations**: `src/forecast/kernels.ts` holds the TypeScript
   reference. The forecast worker swaps in ml-core when it loads, and falls back to TypeScript
   otherwise. Parity tests hold them within 1e-9 relative: SplitMix64 floats bit-identical, ETS,
   Croston family, bootstrap, quantiles, scores, and a whole forecast.
9. **Scope of ml-core in M4**: the forecasting kernels and samplers it uses now. The Monte-Carlo
   accumulators (M5) and CMA-ES (M6) join when those milestones need them, each with parity tests.
   The naive Bayes classifier stays in TypeScript: it trains in milliseconds.

## Consequences

Contributors need Rust (rustup installs the pinned toolchain). Forecast quality on real data
depends on history length; with under three years, seasonality is not modelled at all, and the UI
shows each series' method and backtest MASE so this is visible.
