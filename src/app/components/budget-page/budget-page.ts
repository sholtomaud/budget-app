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
import { actualVsBudget, availableMonths } from '../../../budget/actuals.ts';
import { annualisedCapexPerWeek } from '../../../budget/capex.ts';
import { weeklyRate } from '../../../budget/model.ts';
import { perWeek, WEEKS_IN, type Span } from '../../../budget/periods.ts';
import {
  SHEET_LABEL,
  FIELDS,
  mappingFor,
  parseMoney,
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

  constructor() {
    super(template, style);
  }

  override init(): void {
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
      const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
      const cost = parseMoney(v('cost'));
      if (cost === undefined) return;
      const tiers = data.getState().view?.budget.tiers ?? [];
      void upsertLine({
        id: `manual-${Date.now().toString(36)}`,
        categoryId: v('categoryId'),
        item: v('item'),
        cost,
        ccy: 'AUD',
        period: v('period'),
        tierMultiplier: Object.fromEntries(tiers.map((t) => [t.id, 1])),
      }).then(() => f.reset());
    };
    this.unsubscribe = data.subscribe((s) => this.render(s));
    this.render(data.getState());
    void ensureLoaded();
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private render(s: DataState): void {
    const v = s.view;
    if (!v) return;
    this.renderControls(v);
    this.renderReport(v);
    this.renderLines(v);
    this.renderSheets(v);
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
      ...r.rows.map((row) => {
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
        return el(
          'tr',
          { class: row.budgeted ? '' : 'unbudgeted', 'data-category': row.categoryId },
          el('th', { scope: 'row' }, link),
          el('td', { class: 'num' }, row.budgeted ? money(minor(row.budget)) : '–'),
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
      const parts: (Node | null)[] = [
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
