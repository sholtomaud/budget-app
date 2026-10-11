/**
 * The `forecast` worker (SPEC §4, §10): OPEX and CAPEX forecasts. Inputs are
 * small (monthly series, the asset register), so the ledger stays in the
 * ingest worker.
 */
import type { Asset } from '../domain/types.ts';
import { forecastCapex, type CapexForecast } from '../forecast/capex.ts';
import { forecastOpex, type OpexForecast } from '../forecast/opex.ts';
import type { MonthlySeries } from '../forecast/series.ts';
import { useKernels } from '../forecast/kernels.ts';
import { loadMlCore } from '../forecast/mlcore.ts';
import { expose, type Endpoint } from './rpc.ts';

/** ml-core (WASM) when it loads; the TypeScript reference otherwise. Results agree within 1e-9. */
const ready: Promise<'ml-core' | 'ts'> = (async () => {
  try {
    const res = await fetch(new URL('../forecast/ml-core.wasm', import.meta.url));
    if (!res.ok) return 'ts';
    useKernels(await loadMlCore(await res.arrayBuffer()));
    return 'ml-core';
  } catch {
    return 'ts';
  }
})();

const api = {
  kernels(): Promise<'ml-core' | 'ts'> {
    return ready;
  },
  async opex(
    history: MonthlySeries[],
    budgetMonthly: Record<string, number>,
    opts: { horizon: number; seed: string }
  ): Promise<OpexForecast> {
    await ready;
    return forecastOpex(history, budgetMonthly, { horizon: opts.horizon, seed: BigInt(opts.seed) });
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
