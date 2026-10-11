/**
 * The data service behind the `ingest` worker: the ledger (imports) plus its
 * classification. Classification runs in the same worker because it reads and
 * annotates every transaction (ADR 0009).
 */
import type { Asset } from '../domain/types.ts';
import { Classifier, defaultLife, type StateStore } from '../classify/service.ts';
import { emptyBudget, type BudgetState, type WorkbookImport } from '../budget/state.ts';
import type { BudgetLine, BudgetSettings } from '../budget/model.ts';
import { preview, type Mapping, type WorkbookPreview } from '../budget/workbook.ts';
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
  budget: BudgetState;
}

export interface BudgetStore {
  load(): Promise<BudgetState | null>;
  save(s: BudgetState): Promise<void>;
}

export class MemoryBudgetStore implements BudgetStore {
  private s: BudgetState | null = null;
  async load() {
    return this.s ? structuredClone(this.s) : null;
  }
  async save(s: BudgetState) {
    this.s = structuredClone(s);
  }
}

export interface WorkbookOptions {
  mapping?: Mapping;
  categoryMap?: Record<string, string>;
}

export class DataService {
  readonly ingest: IngestService;
  readonly classifier: Classifier;
  private readonly budgetStore: BudgetStore;
  budget: BudgetState = emptyBudget();

  constructor(
    imports: ImportStore,
    classifyState: StateStore,
    budgetStore: BudgetStore = new MemoryBudgetStore(),
    timezone?: string
  ) {
    this.ingest = new IngestService(imports, timezone);
    this.classifier = new Classifier(classifyState);
    this.budgetStore = budgetStore;
  }

  private async saveBudget() {
    await this.budgetStore.save(this.budget);
  }

  private txns() {
    return [...this.ingest.current.txns.values()];
  }

  private reclassify(): void {
    this.classifier.apply(this.txns());
  }

  async load(): Promise<void> {
    const [, , budget] = await Promise.all([
      this.ingest.load(),
      this.classifier.load(),
      this.budgetStore.load(),
    ]);
    if (budget) this.budget = { ...emptyBudget(), ...budget };
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

  // ---- Budget workbook (FR-ING-010…014) and budget lines ----

  previewWorkbook(file: string, text: string, opts: WorkbookOptions = {}): WorkbookPreview {
    return preview(file, text, {
      ...opts,
      periods: this.budget.periods,
      tiers: this.budget.tiers,
      defaultLife,
    });
  }

  async commitWorkbook(
    file: string,
    text: string,
    opts: WorkbookOptions = {}
  ): Promise<WorkbookImport> {
    const p = this.previewWorkbook(file, text, opts);
    const b = this.budget;
    if (p.mapping.type === 'opex') {
      b.lines = [...b.lines.filter((l) => l.source?.file !== file), ...p.lines];
    } else if (p.mapping.type === 'capex' || p.mapping.type === 'wishlist') {
      await this.classifier.importAssets(file, p.assets);
    } else if (p.mapping.type === 'renewals') {
      for (const r of p.renewals) {
        const a = this.classifier.assets.find((x) => x.name.toLowerCase() === r.item.toLowerCase());
        if (!a) continue;
        if (!a.purchasedAt || r.date > a.purchasedAt) {
          await this.classifier.updateAsset(a.id, {
            purchasedAt: r.date,
            status: 'owned',
            ...(r.cost !== undefined ? { cost: { minor: r.cost, ccy: 'AUD' } } : {}),
          });
        }
      }
    } else {
      for (const [k, v] of Object.entries(p.goal)) b.goal[k] = { value: v.value, file, row: v.row };
    }
    for (const c of p.categoryIds) {
      if (!this.classifier.categories().some((x) => x.id === c)) {
        await this.classifier.addCategory({
          id: c,
          name: c
            .split('.')
            .pop()!
            .replace(/-/g, ' ')
            .replace(/^./, (x) => x.toUpperCase()),
        });
      }
    }
    const rec: WorkbookImport = {
      file,
      type: p.mapping.type,
      at: new Date().toISOString(),
      lines: p.lines.length,
      assets: p.assets.length + p.renewals.length,
      issues: p.issues.length,
    };
    b.imports = [...b.imports.filter((i) => i.file !== file), rec];
    await this.saveBudget();
    this.reclassify();
    return rec;
  }

  async removeWorkbook(file: string): Promise<void> {
    this.budget.lines = this.budget.lines.filter((l) => l.source?.file !== file);
    this.budget.imports = this.budget.imports.filter((i) => i.file !== file);
    await this.classifier.importAssets(file, []);
    await this.saveBudget();
    this.reclassify();
  }

  async upsertLine(line: BudgetLine): Promise<void> {
    this.budget.lines = [...this.budget.lines.filter((l) => l.id !== line.id), line];
    await this.saveBudget();
  }

  async deleteLine(id: string): Promise<void> {
    this.budget.lines = this.budget.lines.filter((l) => l.id !== id);
    await this.saveBudget();
  }

  async setSettings(patch: Partial<BudgetSettings>): Promise<void> {
    this.budget.settings = { ...this.budget.settings, ...patch };
    await this.saveBudget();
  }

  async addAsset(asset: Asset): Promise<void> {
    await this.classifier.addAsset(asset);
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
      budget: this.budget,
    };
  }
}
