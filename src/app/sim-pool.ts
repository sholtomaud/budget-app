/**
 * A pool of `sim` workers for Monte-Carlo (FR-SIM-005): navigator.hardwareConcurrency − 1
 * workers, each running a contiguous chunk of runs. Run i has the same seed
 * whichever worker runs it, so results do not depend on the pool size.
 */
import { canonicalJson, sha256Hex } from '../lib/hash.ts';
import type { RunRequest, Runner } from '../sim/metrics.ts';
import { chunks, combine, type SimResult } from '../sim/montecarlo.ts';
import { wrap, type Remote } from '../workers/rpc.ts';
import type { SimApi } from '../workers/sim.worker.ts';
import { onWorkersReset, sim, track } from './workers.ts';

let pool: Remote<SimApi>[] | null = null;
onWorkersReset(() => (pool = null));

export function poolSize(): number {
  const n = (globalThis.navigator?.hardwareConcurrency ?? 2) - 1;
  return Math.max(1, Math.min(8, n));
}

function workers(): Remote<SimApi>[] {
  if (!pool) {
    // The first is the app's shared sim worker; the rest are extra.
    pool = [sim()];
    for (let i = 1; i < poolSize(); i++) {
      pool.push(
        wrap<SimApi>(
          track(
            new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
              type: 'module',
              name: `sim-${i}`,
            })
          )
        )
      );
    }
  }
  return pool;
}

/** Reproducibility record for a set of runs (FR-SIM-004). */
export interface RunRecord {
  gsskVersion: string;
  wasmSha256: string;
  modelHash: string;
  inputsHash: string;
  seed: string;
  runs: number;
}

export interface PoolResult extends SimResult {
  record: RunRecord;
}

export async function runPool(
  req: RunRequest,
  onProgress?: (done: number, total: number) => void
): Promise<PoolResult> {
  const ws = workers();
  const parts = chunks(req.runs, ws.length * 2);
  let done = 0;
  let next = 0;
  const results: Awaited<ReturnType<SimApi['runChunk']>>[] = [];
  // Each worker takes the next chunk when it finishes one, so a slow worker does not hold the rest.
  await Promise.all(
    ws.map(async (w) => {
      while (next < parts.length) {
        const [from, to] = parts[next++]!;
        const r = await w.runChunk({ ...req, from, to });
        results.push(r);
        done += to - from;
        onProgress?.(done, req.runs);
      }
    })
  );
  const info = await ws[0]!.kernelInfo();
  const combined = combine(results);
  return {
    ...combined,
    record: {
      gsskVersion: info.version,
      wasmSha256: info.sha256,
      modelHash: await sha256Hex(results[0]?.modelJson ?? ''),
      inputsHash: await sha256Hex(
        canonicalJson({
          scenario: req.scenario,
          spending: req.spending,
          freeze: req.freeze ?? null,
          scale: req.holdingScale ?? 1,
        })
      ),
      seed: req.scenario.seed,
      runs: req.runs,
    },
  };
}

export const poolRunner: Runner = (req) => runPool(req);
