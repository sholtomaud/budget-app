/**
 * App-wide data state on the main thread. The ingest worker owns the ledger;
 * this store holds the latest LedgerView for screens to render.
 */
import type { Asset, ImportRecord } from '../domain/types.ts';
import type { Rule } from '../classify/rules.ts';
import type { BudgetLine, BudgetSettings } from '../budget/model.ts';
import type { WorkbookOptions } from '../data/service.ts';
import type { InputFile } from '../ingest/service.ts';
import type { BankCsvSpec } from '../ingest/csv/read.ts';
import type { DataView } from '../data/service.ts';
import { Store } from './core/store.ts';
import { ingest, synth } from './workers.ts';
import { whenReady } from './vault.ts';

export interface DataState {
  view: DataView | null;
  busy: string | null;
  error: string | null;
  lastImport: ImportRecord | null;
}

export const data = new Store<DataState>({ view: null, busy: null, error: null, lastImport: null });

let loading: Promise<DataView> | null = null;

/** The current view, loading it from the worker on first use. */
export function ensureLoaded(): Promise<DataView> {
  loading ??= refresh();
  return loading;
}

export async function refresh(): Promise<DataView> {
  await whenReady();
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

/** Propose a column mapping for a transaction CSV, with a preview (ADR 0030). */
export const suggestCsv = (file: string, text: string) => ingest().suggestCsv(file, text);
export const previewCsv = (text: string, spec: BankCsvSpec) => ingest().previewCsv(text, spec);

export function importCsv(input: InputFile, spec: BankCsvSpec): Promise<ImportRecord> {
  return run(`Importing ${input.name}…`, async () => {
    const rec = await ingest().importCsv(input, spec);
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

/** Run a data action in the worker, then refresh the view. */
function act<T>(busy: string, fn: () => Promise<T>): Promise<T> {
  return run(busy, async () => {
    const r = await fn();
    await refresh();
    return r;
  });
}

/** FR-CLS-001: set the category of transactions; optionally remember the merchant so similar ones follow. */
export const correct = (keys: string[], categoryId: string, rememberMerchant: boolean) =>
  act('Saving…', () => ingest().correct(keys, categoryId, rememberMerchant));
export const similarTo = (key: string) => ingest().similar(key);
export const clearLabel = (key: string) => act('Saving…', () => ingest().clearLabel(key));
export const addRule = (rule: Omit<Rule, 'id'>) =>
  act('Saving rule…', () => ingest().addRule(rule));
export const deleteRule = (id: string) => act('Saving…', () => ingest().deleteRule(id));
export const moveRule = (id: string, delta: number) =>
  act('Saving…', () => ingest().moveRule(id, delta));
export const addCategory = (c: { id: string; name: string }) =>
  act('Saving…', () => ingest().addCategory(c));
export const forgetMemory = (id: string) => act('Saving…', () => ingest().forgetMemory(id));
export const confirmCapex = (key: string, opts: { assetId?: string; name?: string } = {}) =>
  act('Saving…', () => ingest().confirmCapex(key, opts));
export const rejectCapex = (key: string) => act('Saving…', () => ingest().rejectCapex(key));
export const updateAsset = (id: string, patch: Partial<Omit<Asset, 'id'>>) =>
  act('Saving…', () => ingest().updateAsset(id, patch));
export const deleteAsset = (id: string) => act('Saving…', () => ingest().deleteAsset(id));
export const addAsset = (asset: Asset) => act('Saving…', () => ingest().addAsset(asset));
export const previewWorkbook = (file: string, text: string, opts: WorkbookOptions = {}) =>
  ingest().previewWorkbook(file, text, opts);
export const commitWorkbook = (file: string, text: string, opts: WorkbookOptions = {}) =>
  act(`Importing ${file}…`, () => ingest().commitWorkbook(file, text, opts));
export const removeWorkbook = (file: string) =>
  act('Removing…', () => ingest().removeWorkbook(file));
export const upsertLine = (line: BudgetLine) => act('Saving…', () => ingest().upsertLine(line));
export const deleteLine = (id: string) => act('Saving…', () => ingest().deleteLine(id));
export const setSettings = (patch: Partial<BudgetSettings>) =>
  act('Saving…', () => ingest().setSettings(patch));
