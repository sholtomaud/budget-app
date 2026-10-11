/**
 * The `ingest` worker (SPEC §4): imports, the ledger, classification, and
 * IndexedDB persistence. The UI reads DataView.
 */
import type { Asset, ImportRecord } from '../domain/types.ts';
import type { Rule } from '../classify/rules.ts';
import { DataService, type DataView } from '../data/service.ts';
import type { InputFile } from '../ingest/service.ts';
import { IdbImportStore } from '../store/import-store.ts';
import { IdbClassifyStore } from '../store/kv.ts';
import { expose, type Endpoint } from './rpc.ts';

let service: Promise<DataService> | null = null;

function svc(): Promise<DataService> {
  service ??= (async () => {
    const s = new DataService(new IdbImportStore(), new IdbClassifyStore());
    await s.load();
    return s;
  })();
  return service;
}

const api = {
  async view(): Promise<DataView> {
    return (await svc()).view();
  },
  async importFiles(files: InputFile[], label?: string): Promise<ImportRecord> {
    return (await svc()).importFiles(files, label);
  },
  async undo(importId: string) {
    await (await svc()).undo(importId);
  },
  async clear() {
    await (await svc()).clear();
  },
  async correct(keys: string[], categoryId: string, rememberMerchant: boolean) {
    await (await svc()).correct(keys, categoryId, rememberMerchant);
  },
  async similar(key: string): Promise<string[]> {
    return (await svc()).similar(key);
  },
  async clearLabel(key: string) {
    await (await svc()).clearLabel(key);
  },
  async addRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    return (await svc()).addRule(rule);
  },
  async deleteRule(id: string) {
    await (await svc()).deleteRule(id);
  },
  async moveRule(id: string, delta: number) {
    await (await svc()).moveRule(id, delta);
  },
  async addCategory(c: { id: string; name: string }) {
    return (await svc()).addCategory(c);
  },
  async forgetMemory(id: string) {
    await (await svc()).forgetMemory(id);
  },
  async confirmCapex(key: string, opts: { assetId?: string; name?: string } = {}): Promise<Asset> {
    return (await svc()).confirmCapex(key, opts);
  },
  async rejectCapex(key: string) {
    await (await svc()).rejectCapex(key);
  },
  async updateAsset(id: string, patch: Partial<Omit<Asset, 'id'>>) {
    await (await svc()).updateAsset(id, patch);
  },
  async deleteAsset(id: string) {
    await (await svc()).deleteAsset(id);
  },
};

export type IngestApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
