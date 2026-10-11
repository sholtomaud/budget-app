import { wrap, type Remote } from '../workers/rpc.ts';
import type { SimApi } from '../workers/sim.worker.ts';

let remote: Remote<SimApi> | null = null;

/** The sim worker, started on first use. The UI never touches WASM directly. */
export function sim(): Remote<SimApi> {
  remote ??= wrap<SimApi>(
    new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sim',
    })
  );
  return remote;
}
