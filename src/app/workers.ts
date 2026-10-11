import { wrap, type Remote } from '../workers/rpc.ts';
import type { IngestApi } from '../workers/ingest.worker.ts';
import type { SimApi } from '../workers/sim.worker.ts';
import type { SynthApi } from '../workers/synth.worker.ts';
import type { ForecastApi } from '../workers/forecast.worker.ts';

/** Every worker the UI has started, so locking can stop them all (NFR-STO-002). */
const running = new Set<Worker>();

/**
 * Track a worker so it can be terminated. The `new Worker(new URL(...))`
 * expression must stay inline at each call site: Vite only bundles workers
 * written that way.
 */
export function track(w: Worker): Worker {
  running.add(w);
  return w;
}

let simRemote: Remote<SimApi> | null = null;
let ingestRemote: Remote<IngestApi> | null = null;
let synthRemote: Remote<SynthApi> | null = null;
let forecastRemote: Remote<ForecastApi> | null = null;
const resetHooks = new Set<() => void>();

/**
 * Stop every worker. Decrypted data held in their memory goes with them;
 * the next call to any worker starts a fresh one.
 */
export function terminateWorkers(): void {
  for (const w of running) w.terminate();
  running.clear();
  simRemote = ingestRemote = synthRemote = forecastRemote = null;
  for (const h of resetHooks) h();
}

/** Run `fn` whenever the workers are terminated (for modules that cache remotes). */
export function onWorkersReset(fn: () => void): void {
  resetHooks.add(fn);
}

/** The sim worker, started on first use. The UI never touches WASM directly. */
export function sim(): Remote<SimApi> {
  simRemote ??= wrap<SimApi>(
    track(
      new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
        type: 'module',
        name: 'sim',
      })
    )
  );
  return simRemote;
}

/** The ingest worker: imports, the ledger, IndexedDB persistence and the vault. */
export function ingest(): Remote<IngestApi> {
  ingestRemote ??= wrap<IngestApi>(
    track(
      new Worker(new URL('../workers/ingest.worker.ts', import.meta.url), {
        type: 'module',
        name: 'ingest',
      })
    )
  );
  return ingestRemote;
}

/** The synth worker: generates synthetic households (SPEC §7). */
export function synth(): Remote<SynthApi> {
  synthRemote ??= wrap<SynthApi>(
    track(
      new Worker(new URL('../workers/synth.worker.ts', import.meta.url), {
        type: 'module',
        name: 'synth',
      })
    )
  );
  return synthRemote;
}

/** The forecast worker (SPEC §10). */
export function forecast(): Remote<ForecastApi> {
  forecastRemote ??= wrap<ForecastApi>(
    track(
      new Worker(new URL('../workers/forecast.worker.ts', import.meta.url), {
        type: 'module',
        name: 'forecast',
      })
    )
  );
  return forecastRemote;
}
