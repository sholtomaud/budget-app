import { BaseComponent, define } from '../../core/base-component.ts';
import { suggestBudgetCategories, suggestMapping } from '../../llm-actions.ts';
import { asLineCategories, ruleMappings, type LineMapping } from '../../../budget/category-map.ts';
import {
  commitWorkbook,
  data,
  deleteLine,
  ensureLoaded,
  previewWorkbook,
  removeWorkbook,
  upsertLine,
  type DataState,
} from '../../data.ts';
import { count, el, money, prov } from '../../format.ts';
import { categorySelect } from '../../category-select.ts';
import { handOffSheets, takeSheets } from '../../sheet-handoff.ts';
import { askChat } from '../../chat-ask.ts';
import { activeProvider } from '../../egress.ts';
import { actualVsBudget, availableMonths } from '../../../budget/actuals.ts';
import { annualisedCapexPerWeek } from '../../../budget/capex.ts';
import { weeklyRate, type BudgetLine } from '../../../budget/model.ts';
import {
  editLine,
  linesIn,
  newLine,
  setCategoryBudget,
  type LineField,
} from '../../../budget/edit.ts';
import { perWeek, WEEKS_IN, type Span } from '../../../budget/periods.ts';
import {
  SHEET_LABEL,
  FIELDS,
  mappingFor,
  type Mapping,
  type SheetType,
  type WorkbookPreview,
} from '../../../budget/workbook.ts';
import { categoryName } from '../../../classify/categories.ts';
import type { DataView } from '../../../data/service.ts';
import { parseCsv } from '../../../lib/csv.ts';
import template from './budget-page.html?raw';
import style from './budget-page.css?raw';

const minor = (x: number) => BigInt(Math.round(x));

export class BudgetPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;
  private tier = 'secure';
  /** Categories opened to show their lines (FR-BUD-003). */
  private readonly opened = new Set<string>();
  /** The line last deleted, for Undo. */
  private deleted: BudgetLine | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    this.$<HTMLButtonElement>('.review').onclick = () => askChat('Review my budget');
    const controls = this.$<HTMLFormElement>('.controls');
    controls.onchange = () => this.renderReport(data.getState().view);
    this.$<HTMLInputElement>('.pick-csv').onchange = (e) => {
      const input = e.target as HTMLInputElement;
      for (const f of input.files ?? []) void this.openSheet(f);
      input.value = '';
    };
    this.$<HTMLFormElement>('.add-line').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
      const categoryId = v('categoryId');
      void this.add({ categoryId, item: v('item'), cost: v('cost'), period: v('period') }, () => {
        f.reset();
        this.opened.add(categoryId);
      });
    };
    this.unsubscribe = data.subscribe((s) => this.render(s));
    this.render(data.getState());
    // Budget sheets chosen on the Import screen open here, once the data is in.
    void ensureLoaded().then(() => {
      for (const f of takeSheets()) void this.openSheet(f);
    });
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private render(s: DataState): void {
    const v = s.view;
    if (!v) return;
    const active = document.activeElement as HTMLInputElement | null;
    const focus = active?.dataset?.focus;
    const typed = active instanceof HTMLInputElement ? active.value : null;
    this.renderControls(v);
    this.renderReport(v);
    this.renderLines(v);
    this.renderSheets(v);
    // A cell being edited keeps its place when a save re-draws the table.
    if (focus) {
      const again = this.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focus)}"]`);
      if (again instanceof HTMLInputElement && typed !== null) again.value = typed;
      again?.focus();
    }
  }

  private renderControls(v: DataView): void {
    const fs = this.$('.tiers');
    if (!fs.querySelector('input')) {
      for (const t of v.budget.tiers) {
        const input = el('input', { type: 'radio', name: 'tier', value: t.id }) as HTMLInputElement;
        input.checked = t.id === this.tier;
        input.onchange = () => (this.tier = t.id);
        fs.append(el('label', { title: t.description }, input, ` ${t.name}`));
      }
    }
    const end = this.$<HTMLFormElement>('.controls').elements.namedItem('end') as HTMLSelectElement;
    const cur = end.value;
    const months = availableMonths(v.txns);
    end.replaceChildren(
      ...months.map(
        (m) =>
          new Option(
            new Date(`${m}T00:00:00Z`).toLocaleDateString('en-AU', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }),
            m
          )
      )
    );
    if (months.includes(cur)) end.value = cur;
    else if (months.length > 1) end.value = months[1]!; // the latest complete month
  }

  private renderReport(v: DataView | null): void {
    if (!v) return;
    const f = this.$<HTMLFormElement>('.controls');
    const span = ((f.elements.namedItem('span') as RadioNodeList).value || 'month') as Span;
    const end = (f.elements.namedItem('end') as HTMLSelectElement).value;
    const tierName = v.budget.tiers.find((t) => t.id === this.tier)?.name ?? this.tier;
    const weeks = WEEKS_IN[span];
    const synthetic = v.txns.some((t) => t.provenance === 'illustrative');
    const capexWeek = annualisedCapexPerWeek(v.assets, this.tier, v.budget.tiers);
    this.$('.no-budget').hidden = v.budget.lines.length > 0;
    if (!end) {
      this.$('.vs tbody').replaceChildren();
      this.$('.vs tfoot').replaceChildren();
      this.$('.opex-budget').textContent = money(minor(this.opexWeekly(v) * weeks));
      this.$('.capex-budget').textContent = money(minor(capexWeek * weeks));
      this.$('.total-budget').textContent = money(minor((this.opexWeekly(v) + capexWeek) * weeks));
      return;
    }
    const r = actualVsBudget(v.txns, v.budget.lines, {
      tier: this.tier,
      span,
      end,
      periods: v.budget.periods,
    });
    this.$('.table-title').textContent = `Actual vs budget: ${tierName}, ${r.window.label}`;
    this.$('.opex-budget').textContent = money(minor(r.totals.budget));
    this.$('.opex-actual').textContent = `Actual ${money(r.totals.actual)} for ${r.window.label}`;
    this.$('.capex-budget').textContent = money(minor(capexWeek * weeks));
    this.$('.capex-actual').textContent = `Actual capital spend ${money(r.capexActual)}`;
    this.$('.total-budget').textContent = money(minor(r.totals.budget + capexWeek * weeks));

    const base = import.meta.env.BASE_URL;
    const pctCell = (p: number | null) =>
      el('td', { class: 'num' }, p === null ? '–' : `${Math.round(p * 100)}%`);
    this.$('.vs tbody').replaceChildren(
      ...r.rows.flatMap((row) => {
        const uncategorised = row.categoryId === 'uncategorised';
        const route = uncategorised
          ? '/ledger?tab=review'
          : `/ledger?category=${encodeURIComponent(row.categoryId)}`;
        const link = el(
          'a',
          { href: base + route.slice(1), 'data-route': route },
          uncategorised
            ? 'Uncategorised: review in the Ledger'
            : categoryName(row.categoryId, v.categories)
        );
        const over = row.budgeted && row.variance < 0;
        const lines = linesIn(v.budget.lines, row.categoryId);
        const isOpen = this.opened.has(row.categoryId);
        const toggle = uncategorised
          ? el('span', { class: 'toggle-gap' })
          : el(
              'button',
              {
                type: 'button',
                class: 'toggle',
                'aria-expanded': String(isOpen),
                'aria-label': `${isOpen ? 'Hide' : 'Show'} items in ${categoryName(row.categoryId, v.categories)}`,
                title: `${lines.length} item${lines.length === 1 ? '' : 's'}`,
              },
              isOpen ? '▾' : '▸'
            );
        if (toggle instanceof HTMLButtonElement)
          toggle.onclick = () => {
            if (isOpen) this.opened.delete(row.categoryId);
            else this.opened.add(row.categoryId);
            this.renderReport(data.getState().view);
          };
        const head = el(
          'tr',
          {
            class: `cat ${row.budgeted ? '' : 'unbudgeted'}`,
            'data-category': row.categoryId,
          },
          el(
            'th',
            { scope: 'row' },
            toggle,
            link,
            lines.length ? el('span', { class: 'muted n-items' }, ` ${lines.length}`) : null
          ),
          el(
            'td',
            { class: 'num' },
            uncategorised
              ? '–'
              : this.budgetCell(v, row.categoryId, row.budgeted ? row.budget : 0, span)
          ),
          el(
            'td',
            { class: 'num' },
            money(row.actual),
            el('div', { class: 'muted' }, `${count(row.txnCount)} txns`)
          ),
          el(
            'td',
            { class: `num ${row.budgeted ? (over ? 'over' : 'under') : ''}` },
            row.budgeted ? money(minor(row.variance)) : '–'
          ),
          pctCell(row.variancePct),
          el('td', { class: 'num' }, money(minor(row.runRate.m3))),
          el('td', { class: 'num' }, money(minor(row.runRate.m6))),
          el('td', { class: 'num' }, money(minor(row.runRate.m12)))
        );
        if (!isOpen) return [head];
        return [
          head,
          ...lines.map((l) => this.lineRow(v, l, weeks)),
          this.addRow(v, row.categoryId),
        ];
      })
    );
    this.$('.vs tfoot').replaceChildren(
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, 'Total operating'),
        el('td', { class: 'num' }, money(minor(r.totals.budget))),
        el('td', { class: 'num' }, money(r.totals.actual)),
        el(
          'td',
          { class: `num ${r.totals.variance < 0 ? 'over' : 'under'}` },
          money(minor(r.totals.variance))
        ),
        pctCell(r.totals.budget > 0 ? r.totals.variance / r.totals.budget : null),
        el('td', {}),
        el('td', {}),
        el('td', {})
      )
    );
    this.$('.legend').replaceChildren(
      'Budget ',
      prov(synthetic ? 'illustrative' : 'budgeted'),
      ' · actual ',
      prov(synthetic ? 'illustrative' : 'actual'),
      ' · positive variance means under budget. Click a category to see its transactions.'
    );
  }

  /** One budget line as a sub-row of its category: every cell editable (FR-BUD-003). */
  private lineRow(v: DataView, l: BudgetLine, weeks: number): HTMLElement {
    const tierName = v.budget.tiers.find((t) => t.id === this.tier)?.name ?? this.tier;
    const rate = weeklyRate(l, this.tier, (c) => perWeek(c, v.budget.periods)) * weeks;
    const item = this.cell(l, 'item', l.item, `Item name`);
    item.title = l.sheet
      ? `Changed here. ${l.source!.file}, row ${l.source!.row} says ${l.sheet.item}, ${money(l.sheet.cost, l.ccy)} ${v.budget.periods[l.sheet.period]?.label ?? l.sheet.period}; re-importing it unchanged keeps your change.`
      : l.source
        ? `From ${l.source.file}, row ${l.source.row}`
        : 'Added here';
    if (l.sheet) item.classList.add('changed');
    const cost = this.cell(l, 'cost', (Number(l.cost) / 100).toFixed(2), `Amount for ${l.item}`);
    cost.inputMode = 'decimal';
    cost.classList.add('num');
    const period = this.periodSelect(v, l.period);
    this.wire(period, l, 'period', `How often for ${l.item}`);
    const share = this.cell(
      l,
      'multiplier',
      String(l.tierMultiplier[this.tier] ?? 1),
      `Share of ${l.item} at ${tierName} (1 = all of it, 0 = none)`
    );
    share.inputMode = 'decimal';
    share.classList.add('share');
    const cat = categorySelect(
      v.categories.filter((c) => c.kind === 'opex' || c.kind === 'fee'),
      l.categoryId
    );
    this.wire(cat, l, 'categoryId', `Category for ${l.item}`);
    const del = el(
      'button',
      { type: 'button', class: 'small secondary del', 'aria-label': `Delete ${l.item}` },
      'Delete'
    );
    del.onclick = () => void this.deleteLine(l);
    return el(
      'tr',
      { class: 'line', 'data-line': l.id },
      el('th', { scope: 'row' }, item),
      el('td', { class: 'num' }, money(minor(rate))),
      el(
        'td',
        { colspan: '6' },
        el(
          'div',
          { class: 'line-cells' },
          el('label', {}, el('span', { class: 'muted' }, '$'), cost),
          period,
          el(
            'label',
            { title: `Share at ${tierName}` },
            el('span', { class: 'muted' }, '×'),
            share
          ),
          cat,
          del
        )
      )
    );
  }

  /** The row under a category's lines to add one more. */
  private addRow(v: DataView, categoryId: string): HTMLElement {
    const key = (f: string) => `new:${categoryId}:${f}`;
    const item = el('input', {
      placeholder: 'New item',
      'aria-label': `New item in ${categoryName(categoryId, v.categories)}`,
      'data-focus': key('item'),
    });
    const cost = el('input', {
      placeholder: '0.00',
      inputmode: 'decimal',
      class: 'num',
      'aria-label': 'Amount for the new item',
      'data-focus': key('cost'),
    });
    const period = this.periodSelect(v, 'm');
    period.setAttribute('aria-label', 'How often for the new item');
    period.dataset.focus = key('period');
    const add = el('button', { type: 'button', class: 'small', 'data-focus': key('add') }, 'Add');
    const go = () =>
      void this.add(
        { categoryId, item: item.value, cost: cost.value, period: period.value },
        () => {
          item.value = cost.value = '';
          // The next item goes in the same place.
          item.focus();
        }
      );
    add.onclick = go;
    for (const i of [item, cost])
      i.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          go();
        }
      };
    return el(
      'tr',
      { class: 'line add-item', 'data-add': categoryId },
      el('th', { scope: 'row' }, item),
      el('td', {}),
      el(
        'td',
        { colspan: '6' },
        el(
          'div',
          { class: 'line-cells' },
          el('label', {}, el('span', { class: 'muted' }, '$'), cost),
          period,
          add
        )
      )
    );
  }

  private periodSelect(v: DataView, value: string): HTMLSelectElement {
    const s = el('select', {});
    for (const [code, p] of Object.entries(v.budget.periods))
      s.append(new Option(p.label, code, false, code === value));
    if (!v.budget.periods[value]) s.append(new Option(value, value, false, true));
    return s;
  }

  /** A text cell of a line. */
  private cell(l: BudgetLine, field: LineField, value: string, label: string): HTMLInputElement {
    const i = el('input', { value, 'data-field': field });
    this.wire(i, l, field, label);
    i.onkeydown = (e) => {
      if (e.key === 'Escape') {
        i.value = value;
        i.removeAttribute('aria-invalid');
        i.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Like a spreadsheet: save, and on to the same cell of the next line.
        const all = [
          ...this.querySelectorAll<HTMLInputElement>(`.vs input[data-field="${field}"]`),
        ];
        const next = all[all.indexOf(i) + 1];
        if (next) next.focus();
        else i.blur();
      }
    };
    return i;
  }

  /** Save a cell when it changes; a bad value is refused, with the reason. */
  private wire(
    x: HTMLInputElement | HTMLSelectElement,
    l: BudgetLine,
    field: LineField,
    label: string
  ): void {
    x.setAttribute('aria-label', label);
    x.dataset.focus = `${l.id}:${field}`;
    x.onchange = () => {
      const v = data.getState().view!;
      const r = editLine(l, field, x.value, { tier: this.tier, periods: v.budget.periods });
      if (!r.ok) {
        x.setAttribute('aria-invalid', 'true');
        this.status(r.error);
        return;
      }
      x.removeAttribute('aria-invalid');
      this.status('');
      void upsertLine(r.line);
    };
  }

  private async add(
    input: { categoryId: string; item: string; cost: string; period: string },
    done: () => void
  ): Promise<void> {
    const v = data.getState().view!;
    const r = newLine(input, {
      tiers: v.budget.tiers,
      periods: v.budget.periods,
      id: `manual-${Date.now().toString(36)}`,
    });
    if (!r.ok) {
      this.status(r.error);
      return;
    }
    this.status(`Added ${r.line.item}.`);
    done();
    await upsertLine(r.line);
  }

  private async deleteLine(l: BudgetLine): Promise<void> {
    this.deleted = l;
    await deleteLine(l.id);
    const undo = el('button', { type: 'button', class: 'small secondary undo' }, 'Undo');
    undo.onclick = async () => {
      undo.disabled = true;
      if (this.deleted) await upsertLine(this.deleted);
      this.deleted = null;
      this.status(`${l.item} is back.`);
    };
    this.status(`Deleted ${l.item}. `, undo);
  }

  /**
   * A category's budget for the period shown, as a cell: a new amount scales
   * its items, or adds one when it has none (FR-BUD-003).
   */
  private budgetCell(v: DataView, categoryId: string, now: number, span: Span): HTMLInputElement {
    const name = categoryName(categoryId, v.categories);
    const shown = now > 0 ? (now / 100).toFixed(2) : '';
    const i = el('input', {
      value: shown,
      placeholder: 'Set',
      inputmode: 'decimal',
      class: 'budget-cell',
      'aria-label': `Budget for ${name}, per ${span}`,
      'data-focus': `cat:${categoryId}:budget`,
      'data-field': 'budget',
      title:
        now > 0 ? 'Type a new amount: its items scale to it' : 'Type an amount to add a budget',
    });
    i.onkeydown = (e) => {
      if (e.key === 'Escape') {
        i.value = shown;
        i.removeAttribute('aria-invalid');
        i.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const all = [...this.querySelectorAll<HTMLInputElement>('.vs input.budget-cell')];
        const next = all[all.indexOf(i) + 1];
        if (next) next.focus();
        else i.blur();
      }
    };
    i.onchange = async () => {
      if (!i.value.trim()) {
        i.value = shown;
        return;
      }
      const r = setCategoryBudget(v.budget.lines, categoryId, i.value, {
        tier: this.tier,
        tiers: v.budget.tiers,
        periods: v.budget.periods,
        span,
        id: `manual-${Date.now().toString(36)}`,
        name,
      });
      if (!r.ok) {
        i.setAttribute('aria-invalid', 'true');
        this.status(r.error);
        return;
      }
      i.removeAttribute('aria-invalid');
      if (!r.upsert.length) return;
      const before = r.upsert.map((l) => v.budget.lines.find((x) => x.id === l.id));
      for (const l of r.upsert) await upsertLine(l);
      const undo = el('button', { type: 'button', class: 'small secondary undo' }, 'Undo');
      undo.onclick = async () => {
        undo.disabled = true;
        for (const [k, l] of r.upsert.entries()) {
          const was = before[k];
          if (was) await upsertLine(was);
          else await deleteLine(l.id);
        }
        this.status(`${name} is back as it was.`);
      };
      this.status(`${r.summary}. `, undo);
    };
    return i;
  }

  private status(text: string, ...extra: Node[]): void {
    this.$('.edit-status').replaceChildren(text, ...extra);
  }

  private opexWeekly(v: DataView): number {
    return v.budget.lines.reduce(
      (s, l) => s + weeklyRate(l, this.tier, (c) => perWeek(c, v.budget.periods)),
      0
    );
  }

  private renderLines(v: DataView): void {
    const tiers = v.budget.tiers;
    this.$('.lines thead tr').replaceChildren(
      el('th', {}, 'Item'),
      el('th', {}, 'Category'),
      el('th', { class: 'num' }, 'Cost'),
      el('th', {}, 'Per'),
      ...tiers.map((t) => el('th', { class: 'num' }, `${t.name} /wk`)),
      el('th', {}, 'Source'),
      el('th', {}, '')
    );
    const lines = [...v.budget.lines].sort((a, b) =>
      a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : a.item < b.item ? -1 : 1
    );
    this.$('.lines tbody').replaceChildren(
      ...lines.map((l) => {
        const del = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Delete ${l.item}` },
          'Delete'
        );
        del.onclick = () => void deleteLine(l.id);
        return el(
          'tr',
          {},
          el('td', {}, l.item),
          el('td', {}, categoryName(l.categoryId, v.categories)),
          el('td', { class: 'num' }, money(l.cost, l.ccy)),
          el('td', {}, v.budget.periods[l.period]?.label ?? l.period),
          ...tiers.map((t) =>
            el(
              'td',
              { class: 'num' },
              money(minor(weeklyRate(l, t.id, (c) => perWeek(c, v.budget.periods))))
            )
          ),
          el(
            'td',
            { class: 'muted' },
            l.source ? `${l.source.file} row ${l.source.row}` : 'added here'
          ),
          el('td', {}, del)
        );
      })
    );
    const form = this.$<HTMLFormElement>('.add-line');
    const catSel = categorySelect(
      v.categories.filter((c) => c.kind === 'opex' || c.kind === 'fee')
    );
    catSel.name = 'categoryId';
    (form.elements.namedItem('categoryId') as HTMLSelectElement).replaceWith(catSel);
    const per = form.elements.namedItem('period') as HTMLSelectElement;
    if (!per.options.length)
      for (const [code, p] of Object.entries(v.budget.periods))
        per.append(new Option(p.label, code, code === 'm', code === 'm'));
  }

  private renderSheets(v: DataView): void {
    this.$('.no-sheets').hidden = v.budget.imports.length > 0;
    this.$('.sheets').replaceChildren(
      ...v.budget.imports.map((i) => {
        const del = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Remove ${i.file}` },
          'Remove'
        );
        del.onclick = () => void removeWorkbook(i.file);
        return el(
          'li',
          { 'data-sheet': i.file },
          `${i.file} — ${SHEET_LABEL[i.type]}: ${i.lines} lines, ${i.assets} assets${i.issues ? `, ${i.issues} issues` : ''} `,
          del
        );
      })
    );
  }

  /** The mapping wizard for one CSV sheet (FR-ING-010, FR-ING-014). */
  private async openSheet(file: File): Promise<void> {
    const text = await file.text();
    const name = file.name;
    const panel = el('div', { class: 'sheet', 'data-file': name });
    this.$('.wizard').append(panel);
    let mapping: Mapping | undefined;
    let categoryMap: Record<string, string> = {};
    let suggestedBy: string | null = null;
    /** Budget lines' categories by row (FR-ING-019): sheet, rules, AI or you. */
    let lineMaps: LineMapping[] | null = null;
    let lineStatus = '';
    const rows = parseCsv(text);

    const draw = async () => {
      const v = data.getState().view!;
      // The lines as the sheet names them, for the rules and the AI.
      const raw: WorkbookPreview = await previewWorkbook(name, text, {
        ...(mapping ? { mapping } : {}),
      });
      if (raw.mapping.type === 'opex' && lineMaps === null)
        lineMaps = ruleMappings(raw.lines, v.categories);
      const opex = raw.mapping.type === 'opex';
      const p: WorkbookPreview = await previewWorkbook(name, text, {
        ...(mapping ? { mapping } : {}),
        categoryMap,
        ...(opex && lineMaps ? { lineCategories: asLineCategories(lineMaps) } : {}),
      });
      mapping = p.mapping;
      const typeSel = document.createElement('select');
      typeSel.setAttribute('aria-label', 'Sheet type');
      for (const t of Object.keys(SHEET_LABEL) as SheetType[])
        typeSel.append(new Option(SHEET_LABEL[t], t, false, t === p.mapping.type));
      typeSel.onchange = () => {
        mapping = mappingFor(rows, typeSel.value as SheetType, mapping!.headerRow);
        void draw();
      };
      const fieldSelects = FIELDS[p.mapping.type].map((f) => {
        const s = document.createElement('select');
        s.append(new Option('(none)', ''));
        p.headers.forEach((h, i) => s.append(new Option(h || `column ${i + 1}`, String(i))));
        s.value = p.mapping.columns[f.key] !== undefined ? String(p.mapping.columns[f.key]) : '';
        s.onchange = () => {
          const cols = { ...mapping!.columns };
          if (s.value === '') delete cols[f.key];
          else cols[f.key] = Number(s.value);
          mapping = { ...mapping!, columns: cols };
          void draw();
        };
        return el('label', {}, `${f.label}${f.required ? ' *' : ''}`, s);
      });
      const tierInfo =
        p.mapping.type === 'opex'
          ? el(
              'p',
              { class: 'muted' },
              `Tier columns: ${
                Object.entries(p.mapping.tierColumns)
                  .map(([i, t]) => `${p.headers[Number(i)]} → ${t}`)
                  .join(', ') || 'none found (every line counts fully in every tier)'
              }`
            )
          : null;
      const totals =
        p.mapping.type === 'opex'
          ? el(
              'table',
              { class: 'totals' },
              el(
                'thead',
                {},
                el(
                  'tr',
                  {},
                  el('th', {}, 'Tier'),
                  el('th', { class: 'num' }, 'Per week (imported)'),
                  el('th', { class: 'num' }, "Sheet's own total"),
                  el('th', {}, 'Check')
                )
              ),
              el(
                'tbody',
                {},
                ...Object.entries(p.totals).map(([tier, t]) =>
                  el(
                    'tr',
                    { 'data-tier': tier },
                    el('td', {}, tier),
                    el('td', { class: 'num' }, money(minor(t.computed))),
                    el('td', { class: 'num' }, t.file !== undefined ? money(minor(t.file)) : '–'),
                    el(
                      'td',
                      { class: t.matches === false ? 'warn' : 'ok' },
                      t.matches === undefined
                        ? 'no totals row'
                        : t.matches
                          ? 'within 0.5 %'
                          : 'MISMATCH'
                    )
                  )
                )
              )
            )
          : null;
      const known = new Set(v.categories.map((c) => c.id));
      const BY: Record<string, string> = {
        sheet: 'the sheet',
        rules: 'rules',
        ai: 'AI',
        you: 'you',
      };
      const byRow = new Map((lineMaps ?? []).map((m) => [m.row, m]));
      const rawByRow = new Map(raw.lines.map((l) => [l.source?.row, l]));
      const lineRows = opex
        ? p.lines.map((l) => {
            const row = l.source!.row;
            const original = rawByRow.get(row);
            const m = byRow.get(row);
            const sel = categorySelect(
              v.categories,
              known.has(l.categoryId) ? l.categoryId : undefined,
              known.has(l.categoryId) ? [] : [[l.categoryId, `Not matched: ${l.categoryId}`]]
            );
            sel.setAttribute('aria-label', `Category for ${l.item}`);
            sel.onchange = () => {
              lineMaps = [
                ...(lineMaps ?? []).filter((x) => x.row !== row),
                { row, categoryId: sel.value, by: 'you' },
              ];
              void draw();
            };
            return el(
              'tr',
              { 'data-row': String(row), 'data-by': m?.by ?? 'none' },
              el('td', {}, l.item),
              el('td', { class: 'muted' }, original?.categoryId.replace('.', ' / ') ?? ''),
              el('td', {}, sel),
              el('td', { class: 'muted by' }, m ? BY[m.by]! : 'not matched')
            );
          })
        : [];
      const unmatched = opex ? raw.lines.filter((l) => !byRow.has(l.source!.row)) : [];
      const matchAi = el(
        'button',
        { type: 'button', class: 'secondary small match-ai' },
        `Match the other ${count(unmatched.length)} with AI`
      );
      matchAi.disabled = unmatched.length === 0;
      matchAi.onclick = async () => {
        matchAi.disabled = true;
        lineStatus = 'Asking…';
        void draw();
        try {
          const r = await suggestBudgetCategories(unmatched, v.categories, name);
          lineMaps = [...(lineMaps ?? []), ...r.mappings];
          lineStatus = `${r.by} matched ${count(r.mappings.length)} of ${count(unmatched.length)}: check them before importing.`;
        } catch (err) {
          lineStatus = err instanceof Error ? err.message : String(err);
        }
        void draw();
      };
      const catRows = (opex ? [] : p.categoryIds).map((id) => {
        const sel = categorySelect(
          v.categories,
          known.has(id) ? id : undefined,
          known.has(id) ? [] : [[id, `New: ${id}`]]
        );
        sel.value = categoryMap[id] ?? id;
        sel.onchange = () => {
          categoryMap = { ...categoryMap, [id]: sel.value };
          void draw();
        };
        return el('tr', {}, el('td', {}, id), el('td', {}, sel));
      });
      const commit = el(
        'button',
        { type: 'button' },
        `Import ${p.lines.length + p.assets.length + p.renewals.length + Object.keys(p.goal).length} rows`
      );
      commit.onclick = () =>
        void commitWorkbook(name, text, {
          mapping: mapping!,
          categoryMap,
          ...(opex && lineMaps ? { lineCategories: asLineCategories(lineMaps) } : {}),
        }).then(() => panel.remove());
      const cancel = el('button', { type: 'button', class: 'secondary' }, 'Cancel');
      cancel.onclick = () => panel.remove();
      const ai = el(
        'button',
        { type: 'button', class: 'secondary small' },
        'Ask AI to map columns'
      );
      const aiStatus = el(
        'span',
        { class: 'muted', role: 'status' },
        suggestedBy ? `Mapping suggested by ${suggestedBy}: check it before importing.` : ''
      );
      ai.onclick = async () => {
        ai.disabled = true;
        aiStatus.textContent = 'Asking…';
        try {
          const r = await suggestMapping(
            rows,
            v.budget.tiers.map((t) => t.id),
            name
          );
          mapping = r.mapping;
          suggestedBy = r.by;
          void draw();
        } catch (err) {
          aiStatus.textContent = err instanceof Error ? err.message : String(err);
          ai.disabled = false;
        }
      };
      // What rules and detection left undone goes to the AI; without one, say how to set it up.
      const missing = FIELDS[p.mapping.type].some(
        (f) => f.required && p.mapping.columns[f.key] === undefined
      );
      const ap = await activeProvider();
      let aiHint: HTMLElement | null = null;
      if (!ap.ok) {
        ai.disabled = true;
        matchAi.disabled = true;
        if (missing || unmatched.length) {
          const base = import.meta.env.BASE_URL;
          const settings = el(
            'a',
            { href: `${base}settings`, 'data-route': '/settings' },
            'Set up AI in Settings'
          );
          // The sheet reopens here when the person comes back.
          settings.addEventListener('click', () => handOffSheets([file]));
          aiHint = el(
            'p',
            { class: 'ai-hint', role: 'note' },
            `${missing ? 'Some columns were not recognised' : `${count(unmatched.length)} ${unmatched.length === 1 ? 'line was' : 'lines were'} not matched to a category`}: pick them yourself below, or let the AI do it. ${ap.reason} `,
            settings,
            '; this sheet opens again when you come back to Budget.'
          );
        }
      }
      const parts: (Node | null)[] = [
        aiHint,
        el('p', { class: 'ai-map' }, ai, ' ', aiStatus),
        el('label', {}, 'Sheet type ', typeSel),
        el('div', { class: 'grid' }, ...fieldSelects),
        tierInfo,
        el(
          'p',
          {},
          `${count(p.lines.length)} budget lines, ${count(p.assets.length)} assets, ${count(p.renewals.length)} renewals, ${count(Object.keys(p.goal).length)} goal values.`
        ),
        totals,
        p.issues.length
          ? el(
              'ul',
              { class: 'issues' },
              ...p.issues.map((i) =>
                el('li', {}, `Row ${i.row}${i.column ? `, ${i.column}` : ''}: ${i.message}`)
              )
            )
          : null,
        lineRows.length
          ? el(
              'details',
              { class: 'line-categories', open: '' },
              el(
                'summary',
                {},
                `Categories: ${count(lineRows.length - unmatched.length)} of ${count(lineRows.length)} lines matched`
              ),
              el('p', {}, matchAi, ' ', el('span', { class: 'muted', role: 'status' }, lineStatus)),
              el(
                'div',
                { class: 'scroll' },
                el(
                  'table',
                  {},
                  el(
                    'thead',
                    {},
                    el(
                      'tr',
                      {},
                      el('th', {}, 'Item'),
                      el('th', {}, 'In the sheet'),
                      el('th', {}, 'Category'),
                      el('th', {}, 'By')
                    )
                  ),
                  el('tbody', {}, ...lineRows)
                )
              )
            )
          : null,
        catRows.length
          ? el(
              'details',
              {},
              el('summary', {}, `Categories (${catRows.length})`),
              el('table', {}, el('tbody', {}, ...catRows))
            )
          : null,
        el('div', { class: 'actions' }, commit, cancel),
      ];
      panel.replaceChildren(el('h3', {}, name), ...parts.filter((x): x is Node => x !== null));
    };
    await draw();
  }
}

define('budget-page', BudgetPage);
