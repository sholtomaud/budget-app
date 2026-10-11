import { wrap, type Remote } from '../workers/rpc.ts';
import type { IngestApi } from '../workers/ingest.worker.ts';
import type { SimApi } from '../workers/sim.worker.ts';
import type { SynthApi } from '../workers/synth.worker.ts';

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

let ingestRemote: Remote<IngestApi> | null = null;

/** The ingest worker: imports, the ledger, and IndexedDB persistence. */
export function ingest(): Remote<IngestApi> {
  ingestRemote ??= wrap<IngestApi>(
    new Worker(new URL('../workers/ingest.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ingest',
    })
  );
  return ingestRemote;
}

let synthRemote: Remote<SynthApi> | null = null;

/** The synth worker: generates synthetic households (SPEC §7). */
export function synth(): Remote<SynthApi> {
  synthRemote ??= wrap<SynthApi>(
    new Worker(new URL('../workers/synth.worker.ts', import.meta.url), {
      type: 'module',
      name: 'synth',
    })
  );
  return synthRemote;
}
