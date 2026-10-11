/**
 * Classification state and the actions on it (§8, FR-CLS-001…004): user
 * labels, merchant memory, rules, custom categories, and CAPEX decisions with
 * the assets they create. Persisted as one record; the model is retrained
 * from the user labels each time (ADR 0009).
 */
import type { Asset, Txn } from '../domain/types.ts';
import { txnKey } from '../ingest/ids.ts';
import lifetimes from '../../data-tables/asset-lifetimes.json' with { type: 'json' };
import { defaultCategories, kindOfCategory, type Category } from './categories.ts';
import { recall, remember, memoryId, type MemoryEntry } from './memory.ts';
import { merchantKey } from './normalise.ts';
import {
  classifyAll,
  needsReview,
  type ClassifyResult,
  type LlmLabel,
  type UserLabel,
} from './pipeline.ts';
import type { Rule } from './rules.ts';

export interface ClassifyState {
  userLabels: [string, UserLabel][];
  memory: MemoryEntry[];
  rules: Rule[];
  customCategories: Category[];
  assets: Asset[];
  /** LLM suggestions by txn key (M8); optional so older saved states load. */
  llmLabels?: [string, LlmLabel][];
}

export interface StateStore {
  load(): Promise<ClassifyState | null>;
  save(s: ClassifyState): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  private s: ClassifyState | null = null;
  async load() {
    return this.s ? structuredClone(this.s) : null;
  }
  async save(s: ClassifyState) {
    this.s = structuredClone(s);
  }
}

const LIFETIMES = lifetimes.lifetimes as Record<string, { meanYears: number; shape: number }>;

export function defaultLife(categoryId: string): { meanYears: number; shape: number } {
  return LIFETIMES[categoryId] ?? LIFETIMES.default!;
}

let assetSeq = 0;

export class Classifier {
  private readonly store: StateStore;
  private userLabels = new Map<string, UserLabel>();
  private memory = new Map<string, MemoryEntry>();
  private llmLabels = new Map<string, LlmLabel>();
  rules: Rule[] = [];
  customCategories: Category[] = [];
  assets: Asset[] = [];
  last: ClassifyResult | null = null;

  constructor(store: StateStore) {
    this.store = store;
  }

  async load(): Promise<void> {
    const s = await this.store.load();
    if (!s) return;
    this.userLabels = new Map(s.userLabels);
    this.memory = new Map(s.memory.map((e) => [memoryId(e), e]));
    this.rules = s.rules;
    this.customCategories = s.customCategories;
    this.assets = s.assets;
    this.llmLabels = new Map(s.llmLabels ?? []);
  }

  private async save(): Promise<void> {
    await this.store.save({
      userLabels: [...this.userLabels],
      memory: [...this.memory.values()],
      rules: this.rules,
      customCategories: this.customCategories,
      assets: this.assets,
      llmLabels: [...this.llmLabels],
    });
  }

  /** Store LLM suggestions (stage 6). A user's own label still wins (FR-CLS-004). */
  async setLlmLabels(labels: { key: string; categoryId: string }[], model: string): Promise<void> {
    const known = new Set(this.categories().map((c) => c.id));
    for (const l of labels)
      if (known.has(l.categoryId)) this.llmLabels.set(l.key, { categoryId: l.categoryId, model });
    await this.save();
  }

  categories(): Category[] {
    return [...defaultCategories(), ...this.customCategories];
  }

  memoryEntries(): MemoryEntry[] {
    return [...this.memory.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /** Classify every transaction in place and remember the result. */
  apply(txns: Txn[]): ClassifyResult {
    const r = classifyAll(txns, {
      categories: this.categories(),
      rules: this.rules,
      memory: this.memory,
      userLabels: this.userLabels,
      llmLabels: this.llmLabels,
    });
    for (const t of txns) {
      const c = r.byKey.get(txnKey(t.accountId, t.id));
      if (c) t.classification = c;
      else delete t.classification;
      const asset = this.assets.find((a) => a.linkedTxnIds.includes(txnKey(t.accountId, t.id)));
      if (asset && t.classification) t.classification = { ...t.classification, assetId: asset.id };
    }
    this.last = r;
    return r;
  }

  /** Transactions that look like `key`'s merchant and are not labelled by the user (FR-CLS-001). */
  similar(txns: readonly Txn[], key: string): string[] {
    const t = txns.find((x) => txnKey(x.accountId, x.id) === key);
    if (!t || !merchantKey(t)) return [];
    const probe = new Map<string, MemoryEntry>();
    remember(probe, t, 'probe');
    return txns
      .filter(
        (x) =>
          txnKey(x.accountId, x.id) !== key &&
          !x.supersededBy &&
          !x.transferPairId &&
          !this.userLabels.has(txnKey(x.accountId, x.id))
      )
      .filter((x) => recall(probe, x))
      .map((x) => txnKey(x.accountId, x.id));
  }

  /**
   * Set the category of transactions (FR-CLS-001). With `rememberMerchant`, the
   * correction is also remembered for this merchant, so similar transactions —
   * past and future — follow.
   */
  async correct(
    txns: readonly Txn[],
    keys: string[],
    categoryId: string,
    rememberMerchant: boolean
  ): Promise<void> {
    for (const k of keys) this.userLabels.set(k, { categoryId });
    if (rememberMerchant) {
      for (const k of keys) {
        const t = txns.find((x) => txnKey(x.accountId, x.id) === k);
        if (t) remember(this.memory, t, categoryId);
      }
    }
    await this.save();
  }

  async clearLabel(key: string): Promise<void> {
    this.userLabels.delete(key);
    await this.save();
  }

  async forgetMemory(id: string): Promise<void> {
    this.memory.delete(id);
    await this.save();
  }

  async addRule(rule: Omit<Rule, 'id'>): Promise<Rule> {
    const r: Rule = { ...rule, id: `rule-${Date.now().toString(36)}-${this.rules.length}` };
    this.rules.push(r);
    await this.save();
    return r;
  }

  async deleteRule(id: string): Promise<void> {
    this.rules = this.rules.filter((r) => r.id !== id);
    await this.save();
  }

  async moveRule(id: string, delta: number): Promise<void> {
    const i = this.rules.findIndex((r) => r.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.rules.length) return;
    [this.rules[i], this.rules[j]] = [this.rules[j]!, this.rules[i]!];
    await this.save();
  }

  async addCategory(c: { id: string; name: string }): Promise<Category> {
    const cat: Category = { id: c.id, name: c.name, kind: kindOfCategory(c.id), custom: true };
    this.customCategories = [...this.customCategories.filter((x) => x.id !== c.id), cat];
    await this.save();
    return cat;
  }

  /**
   * Confirm a CAPEX proposal (FR-CLS-002): link it to an existing asset, or
   * create one with the category's default life, flagged as assumed.
   */
  async confirmCapex(
    txns: readonly Txn[],
    key: string,
    opts: { assetId?: string; name?: string } = {}
  ): Promise<Asset> {
    const t = txns.find((x) => txnKey(x.accountId, x.id) === key);
    if (!t) throw new Error('Unknown transaction');
    const categoryId = t.classification?.categoryId ?? 'capex.other';
    const capexCategory =
      kindOfCategory(categoryId, this.categories()) === 'capex' ? categoryId : 'capex.other';
    this.userLabels.set(key, { categoryId: capexCategory, kind: 'capex' });
    let asset = opts.assetId ? this.assets.find((a) => a.id === opts.assetId) : undefined;
    if (asset) {
      if (!asset.linkedTxnIds.includes(key)) asset.linkedTxnIds.push(key);
      asset.purchasedAt = t.date > (asset.purchasedAt ?? '') ? t.date : asset.purchasedAt;
      asset.cost = { minor: -t.amount, ccy: t.currency };
      asset.status = 'owned';
    } else {
      const life = defaultLife(capexCategory);
      asset = {
        id: `asset-${Date.now().toString(36)}-${++assetSeq}`,
        name: opts.name ?? t.merchantName ?? t.description,
        categoryId: capexCategory,
        purchasedAt: t.date,
        cost: { minor: -t.amount, ccy: t.currency },
        life: { meanYears: life.meanYears, shape: life.shape },
        lifeAssumed: true,
        replace: true,
        status: 'owned',
        linkedTxnIds: [key],
        provenance: t.provenance,
      };
      this.assets.push(asset);
    }
    await this.save();
    return asset;
  }

  /** Not capital spending: keep the category, record it as operating spend. */
  async rejectCapex(txns: readonly Txn[], key: string): Promise<void> {
    const t = txns.find((x) => txnKey(x.accountId, x.id) === key);
    const categoryId = t?.classification?.categoryId ?? 'shopping.general';
    const opexCategory =
      kindOfCategory(categoryId, this.categories()) === 'capex' ? 'shopping.general' : categoryId;
    this.userLabels.set(key, { categoryId: opexCategory, kind: 'opex' });
    await this.save();
  }

  async updateAsset(id: string, patch: Partial<Omit<Asset, 'id'>>): Promise<void> {
    const a = this.assets.find((x) => x.id === id);
    if (!a) throw new Error('Unknown asset');
    Object.assign(a, patch);
    if (patch.life) a.lifeAssumed = false;
    await this.save();
  }

  /** Replace the assets imported from `file` (re-importing a sheet replaces, never duplicates). */
  async importAssets(file: string, assets: Asset[]): Promise<void> {
    this.assets = [...this.assets.filter((a) => a.source?.file !== file), ...assets];
    await this.save();
  }

  async addAsset(asset: Asset): Promise<void> {
    this.assets.push(asset);
    await this.save();
  }

  async deleteAsset(id: string): Promise<void> {
    this.assets = this.assets.filter((a) => a.id !== id);
    await this.save();
  }

  reviewQueue(txns: readonly Txn[]): string[] {
    return txns
      .filter((t) => !t.supersededBy && needsReview(t.classification))
      .map((t) => txnKey(t.accountId, t.id));
  }

  isUserLabelled(key: string): boolean {
    return this.userLabels.has(key);
  }
}
