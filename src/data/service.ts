/**
 * The data service behind the `ingest` worker: the ledger (imports) plus its
 * classification. Classification runs in the same worker because it reads and
 * annotates every transaction (ADR 0009).
 */
import type { Asset } from '../domain/types.ts';
import { Classifier, type StateStore } from '../classify/service.ts';
import type { Category } from '../classify/categories.ts';
import type { MemoryEntry } from '../classify/memory.ts';
import type { Rule } from '../classify/rules.ts';
import { IngestService, type ImportStore, type InputFile } from '../ingest/service.ts';
import type { LedgerView } from '../ingest/view.ts';

export interface DataView extends LedgerView {
  categories: Category[];
  rules: Rule[];
  memory: MemoryEntry[];
  assets: Asset[];
  /** txnKeys of CAPEX proposals awaiting a decision (FR-CLS-002). */
  capexProposals: string[];
  /** txnKeys needing review: unclassified or low confidence. */
  reviewQueue: string[];
  /** [refund, original] txnKey pairs (FR-CLS-003). */
  refunds: [string, string][];
  /** txnKeys the user labelled themselves. */
  userLabelled: string[];
}

export class DataService {
  readonly ingest: IngestService;
  readonly classifier: Classifier;

  constructor(imports: ImportStore, classifyState: StateStore, timezone?: string) {
    this.ingest = new IngestService(imports, timezone);
    this.classifier = new Classifier(classifyState);
  }

  private txns() {
    return [...this.ingest.current.txns.values()];
  }

  private reclassify(): void {
    this.classifier.apply(this.txns());
  }

  async load(): Promise<void> {
    await Promise.all([this.ingest.load(), this.classifier.load()]);
    this.reclassify();
  }

  async importFiles(files: InputFile[], label?: string) {
    const rec = await this.ingest.importFiles(files, label ? { label } : {});
    this.reclassify();
    return rec;
  }

  async undo(importId: string) {
    await this.ingest.undo(importId);
    this.reclassify();
  }

  async clear() {
    await this.ingest.clear();
    this.reclassify();
  }

  async correct(keys: string[], categoryId: string, rememberMerchant: boolean) {
    await this.classifier.correct(this.txns(), keys, categoryId, rememberMerchant);
    this.reclassify();
  }

  similar(key: string): string[] {
    return this.classifier.similar(this.txns(), key);
  }

  async clearLabel(key: string) {
    await this.classifier.clearLabel(key);
    this.reclassify();
  }

  async addRule(rule: Omit<Rule, 'id'>) {
    const r = await this.classifier.addRule(rule);
    this.reclassify();
    return r;
  }

  async deleteRule(id: string) {
    await this.classifier.deleteRule(id);
    this.reclassify();
  }

  async moveRule(id: string, delta: number) {
    await this.classifier.moveRule(id, delta);
    this.reclassify();
  }

  async addCategory(c: { id: string; name: string }) {
    const cat = await this.classifier.addCategory(c);
    this.reclassify();
    return cat;
  }

  async forgetMemory(id: string) {
    await this.classifier.forgetMemory(id);
    this.reclassify();
  }

  async confirmCapex(key: string, opts: { assetId?: string; name?: string } = {}) {
    const a = await this.classifier.confirmCapex(this.txns(), key, opts);
    this.reclassify();
    return a;
  }

  async rejectCapex(key: string) {
    await this.classifier.rejectCapex(this.txns(), key);
    this.reclassify();
  }

  async updateAsset(id: string, patch: Partial<Omit<Asset, 'id'>>) {
    await this.classifier.updateAsset(id, patch);
    this.reclassify();
  }

  async deleteAsset(id: string) {
    await this.classifier.deleteAsset(id);
    this.reclassify();
  }

  view(): DataView {
    const base = this.ingest.view();
    const txns = this.txns();
    const last = this.classifier.last;
    const userLabelled = txns
      .map((t) => `${t.accountId}\u001f${t.id}`)
      .filter((k) => this.classifier.isUserLabelled(k));
    return {
      ...base,
      categories: this.classifier.categories(),
      rules: this.classifier.rules,
      memory: this.classifier.memoryEntries(),
      assets: this.classifier.assets,
      capexProposals: last?.capexProposals ?? [],
      reviewQueue: this.classifier.reviewQueue(txns),
      refunds: [...(last?.refundOf ?? new Map<string, string>())],
      userLabelled,
    };
  }
}
