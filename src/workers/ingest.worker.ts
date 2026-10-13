/**
 * The `ingest` worker (SPEC §4): imports, the ledger, classification, and
 * IndexedDB persistence. The UI reads DataView.
 */
import type { Asset, ImportRecord } from '../domain/types.ts';
import type { Rule } from '../classify/rules.ts';
import { DataService, type DataView } from '../data/service.ts';
import type { InputFile } from '../ingest/service.ts';
import { IdbImportStore } from '../store/import-store.ts';
import { IdbBudgetStore, IdbClassifyStore, IdbMapperStore } from '../store/kv.ts';
import type { BankCsvSpec } from '../ingest/csv/read.ts';
import type { BudgetLine, BudgetSettings } from '../budget/model.ts';
import type { WorkbookOptions } from '../data/service.ts';
import { expose, type Endpoint } from './rpc.ts';
import {
  changePassphrase,
  disableEncryption,
  enableEncryption,
  exportBundle,
  importBundle,
} from '../store/bundle.ts';
import { unlockKeyring } from '../store/crypto.ts';
import { IdbRawDb } from '../store/raw-idb.ts';
import { vault } from '../store/vault.ts';

let service: Promise<DataService> | null = null;
let currentKey: CryptoKey | null = null;

function svc(): Promise<DataService> {
  service ??= (async () => {
    const s = new DataService(
      new IdbImportStore(),
      new IdbClassifyStore(),
      new IdbBudgetStore(),
      undefined,
      new IdbMapperStore()
    );
    await s.load();
    return s;
  })();
  // A failed load (for example while locked) is not cached.
  service.catch(() => (service = null));
  return service;
}

function useKey(key: CryptoKey | null): void {
  currentKey = key;
  vault.setKey(key);
  vault.refresh();
}

export interface VaultStatus {
  encrypted: boolean;
  unlocked: boolean;
  since: string | null;
}

const api = {
  // ---- Encryption at rest, export, import (NFR-STO-002, NFR-STO-003) ----
  async vaultStatus(): Promise<VaultStatus> {
    const k = await vault.keyring();
    return { encrypted: k !== null, unlocked: vault.hasKey(), since: k?.createdAt ?? null };
  },
  /** Unlock with the passphrase; returns the data key for the other workers. */
  async unlock(passphrase: string): Promise<CryptoKey> {
    const k = await vault.keyring();
    if (!k) throw new Error('Encryption is off');
    const key = await unlockKeyring(k, passphrase);
    useKey(key);
    return key;
  },
  async enableEncryption(passphrase: string): Promise<CryptoKey> {
    const key = await enableEncryption(new IdbRawDb(), passphrase);
    useKey(key);
    return key;
  },
  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void> {
    await changePassphrase(new IdbRawDb(), oldPassphrase, newPassphrase);
  },
  async disableEncryption(passphrase: string): Promise<void> {
    await disableEncryption(new IdbRawDb(), passphrase);
    useKey(null);
  },
  async exportAll(passphrase: string): Promise<Uint8Array> {
    return exportBundle(new IdbRawDb(), currentKey, passphrase);
  },
  /** Replace everything with a `.budgetapp` file's contents; the UI reloads afterwards. */
  async importAll(bytes: Uint8Array, passphrase: string): Promise<{ imports: number }> {
    const plain = await importBundle(new IdbRawDb(), bytes, passphrase, currentKey);
    service = null;
    return { imports: plain.imports.length };
  },

  async view(): Promise<DataView> {
    return (await svc()).view();
  },
  async importFiles(files: InputFile[], label?: string): Promise<ImportRecord> {
    return (await svc()).importFiles(files, label);
  },
  async suggestCsv(file: string, text: string) {
    return (await svc()).suggestCsv(file, text);
  },
  async previewCsv(text: string, spec: BankCsvSpec) {
    return (await svc()).previewCsv(text, spec);
  },
  async importCsv(file: InputFile, spec: BankCsvSpec, label?: string): Promise<ImportRecord> {
    return (await svc()).importCsv(file, spec, label);
  },
  async undo(importId: string) {
    await (await svc()).undo(importId);
  },
  async clear() {
    await (await svc()).clear();
  },
  async llmCandidates(limit?: number) {
    return (await svc()).llmCandidates(limit);
  },
  async applyLlmLabels(labels: { key: string; categoryId: string }[], model: string) {
    await (await svc()).applyLlmLabels(labels, model);
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
  async addAsset(asset: Asset) {
    await (await svc()).addAsset(asset);
  },
  async previewWorkbook(file: string, text: string, opts: WorkbookOptions = {}) {
    return (await svc()).previewWorkbook(file, text, opts);
  },
  async commitWorkbook(file: string, text: string, opts: WorkbookOptions = {}) {
    return (await svc()).commitWorkbook(file, text, opts);
  },
  async removeWorkbook(file: string) {
    await (await svc()).removeWorkbook(file);
  },
  async upsertLine(line: BudgetLine) {
    await (await svc()).upsertLine(line);
  },
  async deleteLine(id: string) {
    await (await svc()).deleteLine(id);
  },
  async setSettings(patch: Partial<BudgetSettings>) {
    await (await svc()).setSettings(patch);
  },
};

export type IngestApi = typeof api;

expose(api, globalThis as unknown as Endpoint);
