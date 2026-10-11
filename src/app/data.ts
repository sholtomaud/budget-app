/**
 * App-wide data state on the main thread. The ingest worker owns the ledger;
 * this store holds the latest LedgerView for screens to render.
 */
import type { ImportRecord } from '../domain/types.ts';
import type { InputFile } from '../ingest/service.ts';
import type { LedgerView } from '../ingest/view.ts';
import { Store } from './core/store.ts';
import { ingest, synth } from './workers.ts';

export interface DataState {
  view: LedgerView | null;
  busy: string | null;
  error: string | null;
  lastImport: ImportRecord | null;
}

export const data = new Store<DataState>({ view: null, busy: null, error: null, lastImport: null });

let loading: Promise<LedgerView> | null = null;

/** The current view, loading it from the worker on first use. */
export function ensureLoaded(): Promise<LedgerView> {
  loading ??= refresh();
  return loading;
}

export async function refresh(): Promise<LedgerView> {
  const view = await ingest().view();
  data.setState({ view });
  return view;
}

async function run<T>(busy: string, fn: () => Promise<T>): Promise<T> {
  data.setState({ busy, error: null });
  try {
    return await fn();
  } catch (e) {
    data.setState({ error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    data.setState({ busy: null });
  }
}

export async function filesToInputs(files: Iterable<File>): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of files) {
    out.push({
      name: f.webkitRelativePath || f.name,
      bytes: new Uint8Array(await f.arrayBuffer()),
      lastModified: f.lastModified,
    });
  }
  return out;
}

export function importFiles(inputs: InputFile[], label?: string): Promise<ImportRecord> {
  return run(`Importing ${inputs.length} file${inputs.length === 1 ? '' : 's'}…`, async () => {
    const rec = await ingest().importFiles(inputs, label);
    data.setState({ lastImport: rec });
    await refresh();
    return rec;
  });
}

export function loadSynthetic(persona: string, seed: string): Promise<ImportRecord> {
  return run(`Generating the ${persona} household…`, async () => {
    const files = await synth().generate(persona, seed);
    data.setState({ busy: `Importing ${files.length} synthetic files…` });
    const rec = await ingest().importFiles(files, `Synthetic: ${persona} (seed ${seed})`);
    data.setState({ lastImport: rec });
    await refresh();
    return rec;
  });
}

export function undoImport(id: string): Promise<void> {
  return run('Undoing the import…', async () => {
    await ingest().undo(id);
    if (data.getState().lastImport?.id === id) data.setState({ lastImport: null });
    await refresh();
  });
}
