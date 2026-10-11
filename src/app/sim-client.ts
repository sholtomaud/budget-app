import * as Comlink from 'comlink';
import type { SimApi } from '../workers/sim.worker.ts';

let remote: Comlink.Remote<SimApi> | null = null;

/** The sim worker, started on first use. The UI never touches WASM directly. */
export function sim(): Comlink.Remote<SimApi> {
  remote ??= Comlink.wrap<SimApi>(
    new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sim',
    })
  );
  return remote;
}
