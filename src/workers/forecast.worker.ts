/**
 * The `forecast` worker (SPEC §4, §10): OPEX and CAPEX forecasts. Inputs are
 * small (monthly series, the asset register), so the ledger stays in the
 * ingest worker.
 */
import type { Asset } from '../domain/types.ts';
import { forecastCapex, type CapexForecast } from '../forecast/capex.ts';
import { bayesChecks, type BayesChecks } from '../bayes/forecast.ts';
import { forecastOpex, type OpexForecast } from '../forecast/opex.ts';
import type { MonthlySeries } from '../forecast/series.ts';
import { useKernels } from '../forecast/kernels.ts';
import { loadMlCore } from '../forecast/mlcore.ts';
import { tsCma, type CmaKernel } from '../optimise/cmaes.ts';
import { expose, type Endpoint } from './rpc.ts';

let cma: CmaKernel = tsCma;

/** ml-core (WASM) when it loads; the TypeScript reference otherwise. Results agree within 1e-9. */
const ready: Promise<'ml-core' | 'ts'> = (async () => {
  try {
    const res = await fetch(new URL('../forecast/ml-core.wasm', import.meta.url));
    if (!res.ok) return 'ts';
    const ml = await loadMlCore(await res.arrayBuffer());
    useKernels(ml);
    cma = ml.cma;
    return 'ml-core';
  } catch {
    return 'ts';
  }
})();

const api = {
  /** CMA-ES for the optimiser (SPEC §11.4), on ml-core when it loaded. */
  async cmaInit(x0: Float64Array, sigma0: number, lambda: number): Promise<Float64Array> {
    await ready;
    return cma.init(x0, sigma0, lambda);
  },
  async cmaAsk(state: Float64Array, z: Float64Array): Promise<Float64Array> {
    await ready;
    return cma.ask(state, z);
  },
  async cmaTell(state: Float64Array, x: Float64Array, f: Float64Array): Promise<Float64Array> {
    await ready;
    return cma.tell(state, x, f);
  },
  kernels(): Promise<'ml-core' | 'ts'> {
    return ready;
  },
  async opex(
    history: MonthlySeries[],
    budgetMonthly: Record<string, number>,
    opts: { horizon: number; seed: string; bayes?: boolean; checks?: boolean }
  ): Promise<OpexForecast> {
    await ready;
    return forecastOpex(history, budgetMonthly, {
      horizon: opts.horizon,
      seed: BigInt(opts.seed),
      bayes: opts.bayes,
      checks: opts.checks,
    });
  },
  /** The Bayesian model's checks for the Forecast screen's panel (ADR 0022). */
  async opexChecks(history: MonthlySeries[], opts: { seed: string }): Promise<BayesChecks | null> {
    await ready;
    return bayesChecks(history, BigInt(opts.seed));
  },
  async capex(
    assets: Asset[],
    opts: { start: string; horizon: number; seed: string }
  ): Promise<CapexForecast> {
    await ready;
    return forecastCapex(assets, {
      start: opts.start,
      horizon: opts.horizon,
      seed: BigInt(opts.seed),
    });
  },
};

export type ForecastApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
