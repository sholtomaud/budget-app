import { BaseComponent, define } from '../../core/base-component.ts';
import {
  addAsset,
  data,
  deleteAsset,
  ensureLoaded,
  setSettings,
  updateAsset,
  type DataState,
} from '../../data.ts';
import { day, el, money, prov } from '../../format.ts';
import { categorySelect } from '../../category-select.ts';
import { annualisedCapexPerWeek, capexSummary, type AssetView } from '../../../budget/capex.ts';
import { weeklyRate } from '../../../budget/model.ts';
import { perWeek } from '../../../budget/periods.ts';
import { parseMoney } from '../../../budget/workbook.ts';
import { defaultLife } from '../../../classify/service.ts';
import { categoryName } from '../../../classify/categories.ts';
import type { DataView } from '../../../data/service.ts';
import type { Asset } from '../../../domain/types.ts';
import { addDays, isoDate } from '../../../lib/dates.ts';
import template from './capex-page.html?raw';
import style from './capex-page.css?raw';

const SVG = 'http://www.w3.org/2000/svg';
const minor = (x: number) => BigInt(Math.round(x));

function today(): string {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const yearsLater = (from: string, years: number) => addDays(from, Math.round(years * 365.25));

export class CapexPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    const f = this.$<HTMLFormElement>('.assumptions');
    f.onchange = () => {
      const cpi = Number((f.elements.namedItem('cpi') as HTMLInputElement).value) / 100;
      const horizonYears = Math.round(
        Number((f.elements.namedItem('horizon') as HTMLInputElement).value)
      );
      if (cpi >= 0 && horizonYears >= 1) void setSettings({ cpi, horizonYears });
    };
    f.onsubmit = (e) => e.preventDefault();
    this.$<HTMLFormElement>('.add-asset').onsubmit = (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
      const cost = parseMoney(v('cost'));
      if (cost === undefined) return;
      const categoryId = v('categoryId');
      const def = defaultLife(categoryId);
      const life = Number(v('life'));
      const status = v('status') as Asset['status'];
      const asset: Asset = {
        id: `asset-${Date.now().toString(36)}`,
        name: v('name'),
        categoryId,
        cost: { minor: cost, ccy: 'AUD' },
        life: { meanYears: life > 0 ? life : def.meanYears, shape: def.shape },
        lifeAssumed: !(life > 0),
        replace: true,
        status,
        linkedTxnIds: [],
        provenance: 'budgeted',
      };
      if (v('purchasedAt')) asset.purchasedAt = v('purchasedAt');
      if (status !== 'owned') asset.forecastCost = { minor: cost, ccy: 'AUD' };
      void addAsset(asset).then(() => form.reset());
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
    const { cpi, horizonYears } = v.budget.settings;
    const f = this.$<HTMLFormElement>('.assumptions');
    const cpiIn = f.elements.namedItem('cpi') as HTMLInputElement;
    const hIn = f.elements.namedItem('horizon') as HTMLInputElement;
    if (document.activeElement !== cpiIn) cpiIn.value = String(Math.round(cpi * 1000) / 10);
    if (document.activeElement !== hIn) hIn.value = String(horizonYears);

    const now = today();
    const summary = capexSummary(v.assets, now, { cpi, horizonYears });
    this.$('.sinking').textContent = `${money(minor(summary.sinkingFundPerWeek))} a week`;
    this.$('.sinking-note').textContent =
      `Set aside from today, in today's dollars, this funds the expected replacements over the next ${horizonYears} years.`;

    this.$('.tier-totals tbody').replaceChildren(
      ...v.budget.tiers.map((t) => {
        const opex = v.budget.lines.reduce(
          (acc, l) => acc + weeklyRate(l, t.id, (c) => perWeek(c, v.budget.periods)),
          0
        );
        const capex = annualisedCapexPerWeek(v.assets, t.id, v.budget.tiers);
        return el(
          'tr',
          { 'data-tier': t.id },
          el('th', { scope: 'row' }, t.name),
          el('td', { class: 'num' }, money(minor(opex))),
          el('td', { class: 'num' }, money(minor(capex))),
          el('td', { class: 'num' }, money(minor(opex + capex)))
        );
      })
    );

    const has = v.assets.length > 0;
    this.$('.empty').hidden = has;
    this.$('.register-card').hidden = !has;
    this.$('.timeline-card').hidden = !summary.assets.some((a) => a.replacement);
    this.renderRegister(v, summary.assets, now);
    this.renderTimeline(summary.assets, now, horizonYears);

    const form = this.$<HTMLFormElement>('.add-asset');
    const sel = categorySelect(v.categories.filter((c) => c.kind === 'capex'));
    sel.name = 'categoryId';
    (form.elements.namedItem('categoryId') as HTMLSelectElement).replaceWith(sel);
  }

  private renderRegister(v: DataView, views: AssetView[], now: string): void {
    const sorted = [...views].sort(
      (a, b) =>
        (a.replacement?.p50 ?? 99) - (b.replacement?.p50 ?? 99) ||
        a.asset.name.localeCompare(b.asset.name)
    );
    this.$('.register tbody').replaceChildren(
      ...sorted.map((av) => {
        const a = av.asset;
        const life = el('input', {
          type: 'number',
          step: '0.5',
          min: '0.5',
          'aria-label': `Expected life of ${a.name}`,
        }) as HTMLInputElement;
        life.value = String(a.life.meanYears);
        life.onchange = () => {
          const n = Number(life.value);
          if (n > 0) void updateAsset(a.id, { life: { ...a.life, meanYears: n } });
        };
        const tier = document.createElement('select');
        tier.setAttribute('aria-label', `Lowest tier that includes ${a.name}`);
        for (const t of v.budget.tiers) tier.append(new Option(t.name, t.id));
        tier.value = a.tier ?? v.budget.tiers[0]?.id ?? '';
        tier.onchange = () => void updateAsset(a.id, { tier: tier.value });

        let decision: HTMLElement = el(
          'span',
          { class: 'muted' },
          a.replace ? 'replace when due' : 'not replaced'
        );
        if (a.status === 'wish' || a.status === 'planned') {
          const action = document.createElement('select');
          action.setAttribute('aria-label', `Decision for ${a.name}`);
          action.append(
            new Option('Undecided', ''),
            new Option('Buy by…', 'buy'),
            new Option('Defer', 'defer'),
            new Option('Drop', 'drop')
          );
          action.value = a.decision?.action ?? '';
          const by = el('input', {
            type: 'date',
            'aria-label': `Buy ${a.name} by`,
          }) as HTMLInputElement;
          by.value = a.decision?.by ?? '';
          by.hidden = action.value !== 'buy';
          const save = () => {
            const act = action.value as 'buy' | 'defer' | 'drop' | '';
            by.hidden = act !== 'buy';
            void updateAsset(
              a.id,
              act
                ? {
                    decision: {
                      action: act,
                      ...(act === 'buy' && by.value ? { by: by.value } : {}),
                    },
                  }
                : { decision: undefined }
            );
          };
          action.onchange = save;
          by.onchange = save;
          decision = el('div', {}, action, by);
        }
        const del = el(
          'button',
          { type: 'button', class: 'small secondary', 'aria-label': `Delete ${a.name}` },
          'Delete'
        );
        del.onclick = () => {
          if (confirm(`Delete ${a.name} from the register?`)) void deleteAsset(a.id);
        };
        const r = av.replacement;
        const when = r
          ? el(
              'span',
              {},
              `${day(yearsLater(now, r.p10))} · `,
              el('strong', {}, day(yearsLater(now, r.p50))),
              ` · ${day(yearsLater(now, r.p90))}`,
              el(
                'div',
                { class: 'muted' },
                `~${r.expectedRemainingYears.toFixed(1)} years left on average`
              )
            )
          : el('span', { class: 'muted' }, a.status === 'owned' ? 'needs a purchase date' : '–');
        return el(
          'tr',
          { 'data-asset': a.name },
          el(
            'th',
            { scope: 'row' },
            a.name,
            el('div', { class: 'muted' }, categoryName(a.categoryId, v.categories))
          ),
          el('td', {}, a.status),
          el('td', {}, a.purchasedAt ? day(a.purchasedAt) : '–'),
          el(
            'td',
            { class: 'num' },
            money((a.forecastCost ?? a.cost).minor),
            el('div', {}, prov(a.provenance))
          ),
          el(
            'td',
            {},
            life,
            a.lifeAssumed
              ? el(
                  'div',
                  {},
                  el('span', { class: 'prov assumed', 'data-prov': 'assumed' }, 'assumed')
                )
              : null
          ),
          el('td', { class: 'num' }, r ? r.ageYears.toFixed(1) : '–'),
          el('td', {}, when),
          el(
            'td',
            { class: 'num' },
            money(av.costReal),
            el('div', { class: 'muted' }, `${money(av.costNominal)} nominal`)
          ),
          el('td', { class: 'num' }, money(minor(av.perWeek))),
          el('td', {}, tier),
          el('td', {}, decision),
          el('td', {}, del)
        );
      })
    );
  }

  /** P10–P90 replacement windows as horizontal bars, with the P50 marked (FR-CAP-001). */
  private renderTimeline(views: AssetView[], now: string, horizon: number): void {
    const items = views
      .filter((v) => v.replacement)
      .sort((a, b) => a.replacement!.p50 - b.replacement!.p50);
    const box = this.$('.timeline');
    box.replaceChildren();
    if (!items.length) return;
    const maxYears = Math.max(
      horizon,
      ...items.map((v) => Math.min(v.replacement!.p90, horizon * 2))
    );
    const W = 760;
    const rowH = 22;
    const left = 150;
    const right = 16;
    const top = 8;
    const H = top + items.length * rowH + 28;
    const sx = (y: number) => left + (Math.min(y, maxYears) / maxYears) * (W - left - right);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `Replacement windows (P10 to P90) for ${items.length} items over ${Math.round(maxYears)} years`
    );
    const mk = (name: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(SVG, name);
      for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
      if (text) e.textContent = text;
      return e;
    };
    const grid = mk('g', { class: 'grid' });
    const step = maxYears > 20 ? 5 : maxYears > 8 ? 2 : 1;
    const y0 = Number(now.slice(0, 4));
    for (let y = 0; y <= maxYears + 1e-9; y += step) {
      grid.append(mk('line', { x1: sx(y), x2: sx(y), y1: top, y2: H - 22 }));
      grid.append(mk('text', { x: sx(y), y: H - 6, 'text-anchor': 'middle' }, String(y0 + y)));
    }
    svg.append(grid, mk('line', { class: 'now', x1: sx(0), x2: sx(0), y1: top, y2: H - 22 }));
    items.forEach((v, i) => {
      const r = v.replacement!;
      const y = top + i * rowH;
      svg.append(
        mk('text', { x: left - 8, y: y + 15, 'text-anchor': 'end' }, v.asset.name.slice(0, 22))
      );
      const bar = mk('rect', {
        class: 'bar',
        x: sx(r.p10),
        y: y + 4,
        width: Math.max(2, sx(r.p90) - sx(r.p10)),
        height: rowH - 8,
        rx: 3,
      });
      bar.append(
        mk(
          'title',
          {},
          `${v.asset.name}: P10 ${r.p10.toFixed(1)}, P50 ${r.p50.toFixed(1)}, P90 ${r.p90.toFixed(1)} years`
        )
      );
      svg.append(
        bar,
        mk('line', { class: 'p50', x1: sx(r.p50), x2: sx(r.p50), y1: y + 3, y2: y + rowH - 3 })
      );
    });
    box.append(svg);
  }
}

define('capex-page', CapexPage);
