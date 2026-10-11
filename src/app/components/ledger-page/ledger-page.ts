import { BaseComponent, define } from '../../core/base-component.ts';
import { suggestCategories } from '../../llm-actions.ts';
import {
  addRule,
  confirmCapex,
  correct,
  data,
  deleteRule,
  ensureLoaded,
  forgetMemory,
  moveRule,
  rejectCapex,
  similarTo,
  type DataState,
} from '../../data.ts';
import { count, day, el, money, prov } from '../../format.ts';
import { categoryName } from '../../../classify/categories.ts';
import { categorySelect, KINDS } from '../../category-select.ts';
import { merchantKey } from '../../../classify/normalise.ts';
import type { DataView } from '../../../data/service.ts';
import type { Txn } from '../../../domain/types.ts';
import template from './ledger-page.html?raw';
import style from './ledger-page.css?raw';

type Tab = 'all' | 'review' | 'capex' | 'transfers' | 'refunds';

const PAGE = 100;
const BY_LABEL: Record<string, string> = {
  user: 'you',
  structural: 'bank data',
  rule: 'rule',
  memory: 'remembered',
  mcc: 'merchant code',
  model: 'model',
  llm: 'LLM',
};

const keyOf = (t: Txn) => `${t.accountId}\u001f${t.id}`;
const domKey = (t: Txn) => `${t.accountId}/${t.id}`;

export class LedgerPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;
  private tab: Tab = 'all';
  private shown = PAGE;
  private selected = new Set<string>();
  private pendingCorrection: { key: string; categoryId: string; similar: string[] } | null = null;
  /** From ?category=, applied once the category list exists. */
  private initialCategory = '';

  constructor() {
    super(template, style);
  }

  override init(): void {
    this.$<HTMLButtonElement>('.suggest').onclick = async () => {
      const v = data.getState().view;
      if (!v) return;
      const b = this.$<HTMLButtonElement>('.suggest');
      const status = this.$('.ai-status');
      b.disabled = true;
      status.textContent = 'Asking…';
      try {
        status.textContent = await suggestCategories(v);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        b.disabled = false;
      }
    };
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    if (t && ['all', 'review', 'capex', 'transfers', 'refunds'].includes(t)) this.tab = t as Tab;
    this.initialCategory = params.get('category') ?? '';
    const q = params.get('q');
    if (q)
      (this.$<HTMLFormElement>('.filters').elements.namedItem('q') as HTMLInputElement).value = q;

    for (const b of this.querySelectorAll<HTMLButtonElement>('.tabs button')) {
      b.onclick = () => {
        this.tab = b.dataset.tab as Tab;
        this.shown = PAGE;
        this.render(data.getState());
      };
    }
    const filters = this.$<HTMLFormElement>('.filters');
    filters.oninput = () => {
      this.shown = PAGE;
      this.renderRows(data.getState().view);
    };
    filters.onsubmit = (e) => e.preventDefault();
    this.$('.more').onclick = () => {
      this.shown += PAGE;
      this.renderRows(data.getState().view);
    };
    this.$<HTMLInputElement>('.select-all').onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      for (const cb of this.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]')) {
        cb.checked = on;
        const k = cb.dataset.key!;
        if (on) this.selected.add(k);
        else this.selected.delete(k);
      }
      this.renderBulk(data.getState().view);
    };
    this.$('.bulk-clear').onclick = () => {
      this.selected.clear();
      this.renderRows(data.getState().view);
    };
    this.$('.bulk-apply').onclick = () => {
      const cat = this.$<HTMLSelectElement>('.bulk-category').value;
      const remember = this.$<HTMLInputElement>('.bulk-remember').checked;
      const keys = [...this.selected];
      this.selected.clear();
      void correct(keys, cat, remember).catch(() => {});
    };
    this.setupDialogs();
    this.unsubscribe = data.subscribe((s) => this.render(s));
    this.render(data.getState());
    void ensureLoaded();
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private setupDialogs(): void {
    const dlg = this.$<HTMLDialogElement>('.correct-dialog');
    dlg.onclose = () => {
      const p = this.pendingCorrection;
      this.pendingCorrection = null;
      if (!p) return;
      if (dlg.returnValue === 'similar')
        void correct([p.key, ...p.similar], p.categoryId, true).catch(() => {});
      else if (dlg.returnValue === 'one')
        void correct([p.key], p.categoryId, false).catch(() => {});
      else if (dlg.returnValue === 'rule') this.openRuleDialog(p.key, p.categoryId);
      else this.renderRows(data.getState().view);
    };
    const rule = this.$<HTMLDialogElement>('.rule-dialog');
    rule.onclose = () => {
      if (rule.returnValue !== 'save') return;
      const f = this.$<HTMLFormElement>('.rule-form');
      const v = (n: string) =>
        (f.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement).value.trim();
      const match: Record<string, string> = {};
      if (v('merchant')) match.merchant = v('merchant');
      if (v('description')) match.description = v('description');
      if (v('direction')) match.direction = v('direction');
      if (!Object.keys(match).length) return;
      void addRule({ name: v('name'), categoryId: v('categoryId'), match }).catch(() => {});
    };
  }

  private openRuleDialog(key: string, categoryId: string): void {
    const v = data.getState().view;
    const t = v?.txns.find((x) => keyOf(x) === key);
    if (!v || !t) return;
    const f = this.$<HTMLFormElement>('.rule-form');
    f.reset();
    const merchant = (t.merchantName || t.billerName || t.description).toUpperCase();
    (f.elements.namedItem('name') as HTMLInputElement).value =
      `${merchant.slice(0, 30)} → ${categoryName(categoryId, v.categories)}`;
    (f.elements.namedItem('merchant') as HTMLInputElement).value = merchant
      .replace(/\d+/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ');
    (f.elements.namedItem('direction') as HTMLSelectElement).value =
      t.amount < 0n ? 'debit' : 'credit';
    const sel = categorySelect(v.categories, categoryId);
    sel.name = 'categoryId';
    sel.className = 'rule-category';
    this.$('.rule-category').replaceWith(sel);
    this.$<HTMLDialogElement>('.rule-dialog').showModal();
  }

  private async askCorrection(t: Txn, categoryId: string): Promise<void> {
    const v = data.getState().view;
    if (!v) return;
    const key = keyOf(t);
    const similar = await similarTo(key);
    this.pendingCorrection = { key, categoryId, similar };
    const who = t.merchantName || t.billerName || t.description;
    this.$('.correct-text').textContent =
      `Set "${who}" (${day(t.date)}, ${money(t.amount, t.currency)}) to ${categoryName(categoryId, v.categories)}.`;
    this.$('.correct-similar').textContent = similar.length
      ? `${count(similar.length)} similar transaction${similar.length === 1 ? '' : 's'} from this merchant can follow, and future ones will too.`
      : 'Future transactions from this merchant will follow if you apply to similar.';
    this.$('.apply-similar').textContent = similar.length
      ? `Apply to ${count(similar.length + 1)}`
      : 'Remember this merchant';
    this.$<HTMLDialogElement>('.correct-dialog').showModal();
  }

  private render(s: DataState): void {
    const v = s.view;
    const has = !!v && v.txns.length > 0;
    this.$('.empty').hidden = has;
    this.$('.body').hidden = !has;
    if (!v || !has) {
      this.$('.summary').textContent = '';
      return;
    }
    const live = v.txns.filter((t) => !t.supersededBy).length;
    this.$('.summary').textContent =
      `${count(live)} transactions across ${count(v.accounts.length)} accounts. ` +
      `${count(v.reviewQueue.length)} to review, ${count(v.capexProposals.length)} CAPEX proposal${v.capexProposals.length === 1 ? '' : 's'}.`;
    const counts: Record<Tab, number> = {
      all: live,
      review: v.reviewQueue.length,
      capex: v.capexProposals.length,
      transfers: v.txns.filter((t) => t.transferPairId).length,
      refunds: v.refunds.length,
    };
    for (const b of this.querySelectorAll<HTMLButtonElement>('.tabs button')) {
      const tab = b.dataset.tab as Tab;
      b.setAttribute('aria-selected', String(tab === this.tab));
      b.textContent = `${b.textContent!.replace(/\s*\(\d[\d,]*\)$/, '')} (${count(counts[tab])})`;
    }
    this.$('.ai-suggest').hidden = this.tab !== 'review' || v.reviewQueue.length === 0;
    this.renderFilters(v);
    this.renderRows(v);
    this.renderManage(v);
  }

  private renderFilters(v: DataView): void {
    const f = this.$<HTMLFormElement>('.filters');
    const acct = f.elements.namedItem('account') as HTMLSelectElement;
    const cur = acct.value;
    acct.replaceChildren(
      new Option('All', ''),
      ...v.accounts.map((a) => new Option(a.displayName, a.id))
    );
    acct.value = cur;
    const cat = f.elements.namedItem('category') as HTMLSelectElement;
    const curCat = cat.value;
    const used = new Set(
      v.txns.map((t) => t.classification?.categoryId).filter((x): x is string => !!x)
    );
    const sel = categorySelect(
      v.categories.filter((c) => used.has(c.id)),
      undefined,
      [['', 'All']]
    );
    for (const id of used) {
      if (!v.categories.some((c) => c.id === id))
        sel.append(new Option(categoryName(id, v.categories), id));
    }
    sel.name = 'category';
    cat.replaceWith(sel);
    sel.value = curCat;
    if (this.initialCategory) {
      if (![...sel.options].some((o) => o.value === this.initialCategory))
        sel.append(
          new Option(categoryName(this.initialCategory, v.categories), this.initialCategory)
        );
      sel.value = this.initialCategory;
      this.initialCategory = '';
    }
    const kind = f.elements.namedItem('kind') as HTMLSelectElement;
    const curKind = kind.value;
    kind.replaceChildren(new Option('All', ''), ...KINDS.map((k) => new Option(k, k)));
    kind.value = curKind;
    const bulk = categorySelect(
      v.categories,
      this.$<HTMLSelectElement>('.bulk-category').value || undefined
    );
    bulk.className = 'bulk-category';
    this.$('.bulk-category').replaceWith(bulk);
  }

  private filtered(v: DataView): Txn[] {
    const f = this.$<HTMLFormElement>('.filters');
    const val = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement).value;
    const q = val('q').trim().toLowerCase();
    const account = val('account');
    const category = val('category');
    const kind = val('kind');
    const review = new Set(v.reviewQueue);
    const capex = new Set(v.capexProposals);
    const refunds = new Set(v.refunds.flat());
    const rows = v.txns.filter((t) => {
      const k = keyOf(t);
      switch (this.tab) {
        case 'all':
          if (t.supersededBy) return false;
          break;
        case 'review':
          if (!review.has(k)) return false;
          break;
        case 'capex':
          if (!capex.has(k)) return false;
          break;
        case 'transfers':
          if (!t.transferPairId) return false;
          break;
        case 'refunds':
          if (!refunds.has(k)) return false;
          break;
      }
      if (account && t.accountId !== account) return false;
      if (category && t.classification?.categoryId !== category) return false;
      if (kind && t.classification?.kind !== kind) return false;
      if (q) {
        const hay =
          `${t.description} ${t.merchantName ?? ''} ${t.billerName ?? ''} ${t.reference ?? ''} ${money(t.amount)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (this.tab === 'review') {
      // Largest merchant groups first: one correction there covers the most transactions.
      const group = (t: Txn) => `${t.amount < 0n ? '-' : '+'}${merchantKey(t)}`;
      const sizes = new Map<string, number>();
      for (const t of rows) sizes.set(group(t), (sizes.get(group(t)) ?? 0) + 1);
      rows.sort(
        (a, b) =>
          sizes.get(group(b))! - sizes.get(group(a))! ||
          (group(a) < group(b) ? -1 : group(a) > group(b) ? 1 : a.date < b.date ? 1 : -1)
      );
    }
    return rows;
  }

  private renderRows(v: DataView | null): void {
    if (!v) return;
    const rows = this.filtered(v);
    const shown = rows.slice(0, this.shown);
    const capex = new Set(v.capexProposals);
    const review = new Set(v.reviewQueue);
    const accounts = new Map(v.accounts.map((a) => [a.id, a.displayName]));
    this.$('.txns tbody').replaceChildren(
      ...shown.map((t) =>
        this.row(
          t,
          v,
          capex.has(keyOf(t)),
          review.has(keyOf(t)),
          accounts.get(t.accountId) ?? t.accountId
        )
      )
    );
    this.$('.shown').textContent = `Showing ${count(shown.length)} of ${count(rows.length)}`;
    this.$<HTMLButtonElement>('.more').hidden = shown.length >= rows.length;
    this.$<HTMLInputElement>('.select-all').checked = false;
    this.renderBulk(v);
  }

  private row(
    t: Txn,
    v: DataView,
    isCapexProposal: boolean,
    isReview: boolean,
    accountName: string
  ): HTMLTableRowElement {
    const key = keyOf(t);
    const c = t.classification;
    const cb = el('input', {
      type: 'checkbox',
      'aria-label': `Select ${t.description}`,
    }) as HTMLInputElement;
    cb.dataset.key = key;
    cb.checked = this.selected.has(key);
    cb.onchange = () => {
      if (cb.checked) this.selected.add(key);
      else this.selected.delete(key);
      this.renderBulk(v);
    };
    const sel = categorySelect(
      v.categories,
      c?.categoryId,
      c?.categoryId === 'uncategorised' ? [['uncategorised', 'Uncategorised']] : []
    );
    sel.setAttribute('aria-label', `Category for ${t.description}`);
    sel.onchange = () => void this.askCorrection(t, sel.value);
    if (t.transferPairId) sel.disabled = c?.by !== 'user' && c?.kind === 'transfer';

    let kindCell: HTMLElement = el(
      'span',
      { class: 'kind', 'data-kind': c?.kind ?? '' },
      c?.kind ?? ''
    );
    if (isCapexProposal) {
      const yes = el('button', { type: 'button', class: 'small' }, 'Confirm asset');
      yes.onclick = () => void confirmCapex(key).catch(() => {});
      const no = el('button', { type: 'button', class: 'small secondary' }, 'Not capital');
      no.onclick = () => void rejectCapex(key).catch(() => {});
      const link = document.createElement('select');
      link.className = 'small';
      link.setAttribute('aria-label', 'Link to an existing asset');
      link.append(new Option('…or link to', ''), ...v.assets.map((a) => new Option(a.name, a.id)));
      link.hidden = v.assets.length === 0;
      link.onchange = () =>
        link.value && void confirmCapex(key, { assetId: link.value }).catch(() => {});
      kindCell = el('div', {}, kindCell, el('div', { class: 'capex-actions' }, yes, no, link));
    }
    const asset = c?.assetId ? v.assets.find((a) => a.id === c.assetId) : undefined;
    const cls = [
      t.supersededBy ? 'superseded' : '',
      t.transferPairId ? 'transfer' : '',
      isReview ? 'review' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return el(
      'tr',
      { class: cls, 'data-txn': domKey(t), 'data-kind': c?.kind ?? '' },
      el('td', {}, cb),
      el(
        'td',
        {},
        day(t.date),
        t.status === 'PENDING'
          ? el('div', { class: 'muted' }, t.supersededBy ? 'pending, replaced' : 'pending')
          : null
      ),
      el('td', {}, accountName),
      el(
        'td',
        { class: 'desc' },
        t.merchantName || t.billerName || t.description,
        t.merchantName || t.billerName ? el('div', { class: 'raw' }, t.description) : null,
        asset ? el('div', { class: 'raw' }, `Asset: ${asset.name}`) : null
      ),
      el(
        'td',
        { class: `num amount ${t.amount < 0n ? 'out' : 'in'}` },
        money(t.amount, t.currency)
      ),
      el('td', { class: 'cat' }, sel),
      el('td', {}, kindCell),
      el(
        'td',
        { class: 'src' },
        !c || c.categoryId === 'uncategorised'
          ? 'not classified'
          : `${BY_LABEL[c.by] ?? c.by}${c.by !== 'user' && c.confidence < 1 ? ` ${Math.round(c.confidence * 100)}%` : ''}`,
        el('div', {}, prov(t.provenance))
      )
    );
  }

  private renderBulk(v: DataView | null): void {
    const n = this.selected.size;
    this.$('.bulk').hidden = n === 0 || !v;
    this.$('.bulk-count').textContent = `${count(n)} selected`;
  }

  private renderManage(v: DataView): void {
    this.$('.no-rules').hidden = v.rules.length > 0;
    this.$('.rules').replaceChildren(
      ...v.rules.map((r, i) => {
        const up = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Move ${r.name} up` },
          '↑'
        );
        up.onclick = () => void moveRule(r.id, -1).catch(() => {});
        (up as HTMLButtonElement).disabled = i === 0;
        const down = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Move ${r.name} down` },
          '↓'
        );
        down.onclick = () => void moveRule(r.id, 1).catch(() => {});
        (down as HTMLButtonElement).disabled = i === v.rules.length - 1;
        const del = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Delete rule ${r.name}` },
          'Delete'
        );
        del.onclick = () => void deleteRule(r.id).catch(() => {});
        const cond = Object.entries(r.match)
          .map(([k, val]) => `${k}: ${val}`)
          .join(', ');
        return el(
          'li',
          { 'data-rule': r.id },
          `${r.name} — ${cond} → ${categoryName(r.categoryId, v.categories)} `,
          up,
          ' ',
          down,
          ' ',
          del
        );
      })
    );
    this.$('.no-memory').hidden = v.memory.length > 0;
    this.$('.memory').replaceChildren(
      ...v.memory.map((m) => {
        const del = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Forget ${m.key}` },
          'Forget'
        );
        del.onclick = () => void forgetMemory(`${m.direction}|${m.key}`).catch(() => {});
        return el(
          'li',
          {},
          `${m.key} (${m.direction === 'debit' ? 'money out' : 'money in'}) → ${categoryName(m.categoryId, v.categories)} `,
          del
        );
      })
    );
  }
}

define('ledger-page', LedgerPage);
