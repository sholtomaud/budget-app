/**
 * The `ingest` worker (SPEC §4): parses and validates imported files, keeps
 * the ledger, and persists imports in IndexedDB. The UI reads LedgerView.
 */
import { IngestService, type InputFile } from '../ingest/service.ts';
import type { LedgerView } from '../ingest/view.ts';
import type { ImportRecord } from '../domain/types.ts';
import { IdbImportStore } from '../store/import-store.ts';
import { expose, type Endpoint } from './rpc.ts';

let service: Promise<IngestService> | null = null;

function svc(): Promise<IngestService> {
  service ??= (async () => {
    const s = new IngestService(new IdbImportStore());
    await s.load();
    return s;
  })();
  return service;
}

const api = {
  async view(): Promise<LedgerView> {
    return (await svc()).view();
  },
  async importFiles(files: InputFile[], label?: string): Promise<ImportRecord> {
    return (await svc()).importFiles(files, label ? { label } : {});
  },
  async undo(importId: string): Promise<void> {
    await (await svc()).undo(importId);
  },
  async clear(): Promise<void> {
    await (await svc()).clear();
  },
};

export type IngestApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
