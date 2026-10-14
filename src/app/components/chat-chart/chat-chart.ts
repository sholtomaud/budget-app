/**
 * A chart in the chat (FR-VIZ-002, ADR 0028), drawn from a spec and the table
 * the app computed for it: line, grouped bar, stacked bar or table. Colours
 * are the theme's; downloads resolve them so files look the same elsewhere.
 * Every string the spec carries is set as text, never parsed as markup.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { ticks } from '../../chart-scale.ts';
import { saveChart } from '../../charts.ts';
import { el } from '../../format.ts';
import type { ChartSpec } from '../../../viz/spec.ts';
import { tableCsv, type ChartTable } from '../../../viz/query.ts';
import style from './chat-chart.css?raw';

export interface ChartItem {
  spec: ChartSpec;
  table: ChartTable;
  /** When the values were computed (ISO time). */
  at: string;
}

const SVG = 'http://www.w3.org/2000/svg';
// Drawn small and scaled up, so the text stays readable in the narrow chat panel.
const W = 400;
const H = 220;
const M = { top: 10, right: 8, bottom: 40, left: 50 };

const money = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const plain = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });

const svgEl = (name: string, attrs: Record<string, string | number>, text?: string) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};

const colour = (i: number) => `var(--series-${(i % 8) + 1})`;

/** Each series' colour: one per hue key, in order of first appearance (ADR 0035). */
export function seriesColours(t: ChartTable): string[] {
  const keys = new Map<string, number>();
  return t.series.map((s, i) => {
    const k = s.hueKey ?? `#${i}`;
    if (!keys.has(k)) keys.set(k, keys.size);
    return colour(keys.get(k)!);
  });
}

/** How a look draws: a lighter shade, or dashed. */
const LIGHT = 0.45;
const DASH = '5 3';

/** Shorten a long axis label so bars stay readable. */
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class ChatChart extends BaseComponent {
  private _item: ChartItem | null = null;
  /** Hide Save (on the Saved charts screen). */
  saveable = true;

  constructor() {
    super('<figure></figure>', style);
  }

  set item(c: ChartItem | null) {
    this._item = c;
    if (this.isConnected) this.draw();
  }

  get item(): ChartItem | null {
    return this._item;
  }

  override init(): void {
    this.draw();
  }

  private draw(): void {
    const fig = this.querySelector('figure');
    const c = this._item;
    if (!fig || !c) return;
    const { spec, table } = c;
    fig.replaceChildren(el('p', { class: 'title' }, spec.title));
    if (spec.kind === 'table') fig.append(this.tableView(table));
    else fig.append(this.svg(spec, table));
    fig.append(this.legend(table, spec.kind));
    const caption = [
      spec.caption ?? '',
      ...(table.notes ?? []),
      table.window
        ? `${table.perMonth ? 'Monthly averages, ' : ''}${table.window.from} to ${table.window.to}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (caption) fig.append(el('figcaption', {}, caption));
    fig.append(this.tools(c));
  }

  private legend(t: ChartTable, kind: ChartSpec['kind']): HTMLElement {
    const box = el('div', { class: 'legend' });
    if (kind === 'fan') {
      for (const [label, k] of [
        ['Typical future', 0],
        ['Half of futures', 0],
        ['9 in 10 futures', 0],
      ] as const) {
        const key = el('span', { class: 'key' }, label);
        key.style.setProperty('--swatch', colour(k));
        box.append(key);
      }
      if (t.floor) box.append(el('span', {}, `Floor ${money.format(t.floor)} (dashed)`));
      box.append(el('span', { class: 'prov', 'data-prov': 'forecast' }, 'forecast'));
      return box;
    }
    const hues = seriesColours(t);
    t.series.forEach((s, i) => {
      const key = el('span', { class: `key ${s.look ?? 'solid'}` }, s.label);
      key.style.setProperty('--swatch', hues[i]!);
      box.append(key);
    });
    for (const p of new Set(t.series.map((s) => s.provenance)))
      box.append(el('span', { class: 'prov', 'data-prov': p }, p));
    return box;
  }

  private tableView(t: ChartTable): HTMLElement {
    const unit = (i: number) => (t.series[i]!.unit === 'count' ? plain : money);
    const exact = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
    const head = el(
      'tr',
      {},
      el('th', { scope: 'col' }, ''),
      ...t.series.map((s) => el('th', { scope: 'col', class: 'num' }, s.label))
    );
    const rows = t.labels.map((l, r) =>
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, l),
        ...t.series.map((s, i) =>
          el(
            'td',
            { class: 'num' },
            s.unit === 'count' ? unit(i).format(s.values[r]!) : exact.format(s.values[r]!)
          )
        )
      )
    );
    return el(
      'div',
      { class: 'scroll' },
      el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows))
    );
  }

  private svg(spec: ChartSpec, t: ChartTable): SVGSVGElement {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      xmlns: SVG,
    }) as SVGSVGElement;
    svg.setAttribute(
      'aria-label',
      `${spec.title}: ${t.series.map((s) => s.label).join(', ')} by ${t.labels.length} ${spec.groupBy}${t.labels.length === 1 ? '' : 's'}`
    );
    const stacked = spec.kind === 'stacked-bar';
    const fmt = t.series.every((s) => s.unit === 'count') ? plain : money;
    const n = t.x.length;
    const tops = stacked
      ? t.x.map((_, i) => t.series.reduce((a, s) => a + Math.max(0, s.values[i]!), 0))
      : t.series.flatMap((s) => s.values);
    const lows = stacked
      ? t.x.map((_, i) => t.series.reduce((a, s) => a + Math.min(0, s.values[i]!), 0))
      : t.series.flatMap((s) => s.values);
    if (t.floor !== undefined) tops.push(t.floor);
    const yt = ticks(Math.min(0, ...lows), Math.max(0, ...tops));
    const y0 = Math.min(0, yt[0] ?? 0, ...lows);
    const y1 = Math.max(yt[yt.length - 1] ?? 1, ...tops, y0 + 1);
    const plotW = W - M.left - M.right;
    const band = plotW / Math.max(1, n);
    const cx = (i: number) => M.left + band * (i + 0.5);
    const sy = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0)) * (H - M.top - M.bottom);

    const grid = svgEl('g', {});
    for (const v of yt) {
      grid.append(
        svgEl('line', {
          x1: M.left,
          x2: W - M.right,
          y1: sy(v),
          y2: sy(v),
          stroke: 'var(--border)',
        })
      );
      grid.append(
        svgEl(
          'text',
          {
            x: M.left - 6,
            y: sy(v) + 4,
            'text-anchor': 'end',
            fill: 'var(--text-muted)',
            'font-size': 11,
          },
          fmt.format(v)
        )
      );
    }
    grid.append(
      svgEl('line', {
        x1: M.left,
        x2: W - M.right,
        y1: sy(0),
        y2: sy(0),
        stroke: 'var(--border-strong)',
      })
    );
    // Time reads left to right: about six level labels. Categories: up to eight, slanted.
    const time = ['month', 'quarter', 'year'].includes(spec.groupBy);
    const every = Math.max(1, Math.ceil(n / (time ? 6 : 8)));
    const rotate = !time && n > 6;
    t.labels.forEach((l, i) => {
      if (i % every) return;
      const x = cx(i);
      const y = H - M.bottom + 14;
      grid.append(
        svgEl(
          'text',
          {
            x,
            y,
            'text-anchor': rotate ? 'end' : 'middle',
            fill: 'var(--text-muted)',
            'font-size': 11,
            ...(rotate ? { transform: `rotate(-30 ${x} ${y})` } : {}),
          },
          short(l, 16)
        )
      );
    });
    svg.append(grid);

    const marks = svgEl('g', {});
    const role = (r: string) => t.series.find((s) => s.role === r)?.values;
    if (spec.kind === 'fan') {
      // Bands between quantiles of the simulated futures, and the typical one as a line.
      const area = (lo: number[], hi: number[], fill: string, title: string) => {
        const top = hi.map((v, i) => `${cx(i).toFixed(1)},${sy(v).toFixed(1)}`);
        const bottom = lo.map((v, i) => `${cx(i).toFixed(1)},${sy(v).toFixed(1)}`).reverse();
        const poly = svgEl('polygon', {
          points: [...top, ...bottom].join(' '),
          fill,
          'fill-opacity': 0.25,
          class: 'band',
        });
        poly.append(svgEl('title', {}, title));
        marks.append(poly);
      };
      const [p5, p25, p50, p75, p95] = ['p5', 'p25', 'p50', 'p75', 'p95'].map(role);
      if (p5 && p95) area(p5, p95, colour(0), '9 in 10 futures fall in this range');
      if (p25 && p75) area(p25, p75, colour(0), 'Half of the futures fall in this range');
      if (p50) {
        const d = p50
          .map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${sy(v).toFixed(1)}`)
          .join('');
        const path = svgEl('path', { d, fill: 'none', stroke: colour(0), 'stroke-width': 2 });
        path.append(svgEl('title', {}, 'Typical future'));
        marks.append(path);
      }
    } else if (spec.kind === 'line') {
      const hues = seriesColours(t);
      const many = t.series.length > 4;
      t.series.forEach((s, k) => {
        const d = s.values
          .map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${sy(v).toFixed(1)}`)
          .join('');
        const path = svgEl('path', {
          d,
          fill: 'none',
          stroke: hues[k]!,
          'stroke-width': 2,
          'data-look': s.look ?? 'solid',
          ...(s.look === 'light' ? { 'stroke-opacity': LIGHT } : {}),
          ...(s.look === 'dashed' ? { 'stroke-dasharray': DASH } : {}),
        });
        path.append(svgEl('title', {}, s.label));
        marks.append(path);
        s.values.forEach((v, i) => {
          const dot = svgEl('circle', {
            cx: cx(i),
            cy: sy(v),
            r: n > 24 || many ? 1.5 : 3,
            fill: hues[k]!,
            ...(s.look === 'light' ? { 'fill-opacity': LIGHT } : {}),
          });
          dot.append(svgEl('title', {}, `${s.label}, ${t.labels[i]}: ${fmt.format(v)}`));
          marks.append(dot);
        });
      });
    } else {
      const inner = band * 0.8;
      const each = stacked ? inner : inner / t.series.length;
      const base = t.x.map(() => [0, 0]);
      const hues = seriesColours(t);
      t.series.forEach((s, k) => {
        s.values.forEach((v, i) => {
          const left = cx(i) - inner / 2 + (stacked ? 0 : each * k);
          const from = stacked ? (v >= 0 ? base[i]![0]! : base[i]![1]!) : 0;
          const to = from + v;
          if (stacked) base[i]![v >= 0 ? 0 : 1] = to;
          const rect = svgEl('rect', {
            x: left.toFixed(1),
            y: Math.min(sy(from), sy(to)).toFixed(1),
            width: Math.max(1, each - 1).toFixed(1),
            height: Math.abs(sy(from) - sy(to)).toFixed(1),
            fill: hues[k]!,
            'data-look': s.look ?? 'solid',
            ...(s.look && s.look !== 'solid' ? { 'fill-opacity': LIGHT } : {}),
            ...(s.look === 'dashed'
              ? { stroke: hues[k]!, 'stroke-dasharray': '3 2', 'stroke-width': 1 }
              : {}),
          });
          rect.append(svgEl('title', {}, `${s.label}, ${t.labels[i]}: ${fmt.format(v)}`));
          marks.append(rect);
        });
      });
    }
    if (t.floor !== undefined && t.floor > 0) {
      const floor = svgEl('line', {
        x1: M.left,
        x2: W - M.right,
        y1: sy(t.floor),
        y2: sy(t.floor),
        stroke: 'var(--bad)',
        'stroke-dasharray': '4 3',
        class: 'floor',
      });
      floor.append(svgEl('title', {}, `Floor: ${money.format(t.floor)}`));
      marks.append(floor);
    }
    svg.append(marks);
    return svg;
  }

  private tools(c: ChartItem): HTMLElement {
    const note = el('span', { class: 'note', role: 'status' });
    const box = el('div', { class: 'tools' });
    if (this.saveable) {
      const save = el('button', { type: 'button', class: 'secondary small save' }, 'Save chart');
      save.onclick = async () => {
        save.disabled = true;
        try {
          await saveChart(c);
          note.textContent = 'Saved. Find it under Saved charts.';
        } catch (err) {
          note.textContent = err instanceof Error ? err.message : String(err);
          save.disabled = false;
        }
      };
      box.append(save);
    }
    const file =
      c.spec.title
        .replace(/[^\w -]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase() || 'chart';
    const svgBtn = el('button', { type: 'button', class: 'secondary small' }, 'SVG');
    svgBtn.onclick = () =>
      download(new Blob([this.svgText()], { type: 'image/svg+xml' }), `${file}.svg`);
    const pngBtn = el('button', { type: 'button', class: 'secondary small' }, 'PNG');
    pngBtn.onclick = () =>
      void this.png().then(
        (b) => download(b, `${file}.png`),
        (err: unknown) =>
          (note.textContent = `No PNG: ${err instanceof Error ? err.message : String(err)}`)
      );
    const csvBtn = el('button', { type: 'button', class: 'secondary small' }, 'CSV');
    csvBtn.onclick = () =>
      download(new Blob([tableCsv(c.table)], { type: 'text/csv' }), `${file}.csv`);
    if (c.spec.kind !== 'table') box.append(svgBtn, pngBtn);
    box.append(csvBtn, note);
    return box;
  }

  /** The drawn SVG with the theme's colours written in, for a file. */
  svgText(): string {
    const src = this.querySelector('svg');
    if (!src) return '';
    const copy = src.cloneNode(true) as SVGSVGElement;
    const css = getComputedStyle(this);
    const resolve = (v: string) =>
      v.replace(
        /var\((--[\w-]+)\)/g,
        (_, name: string) => css.getPropertyValue(name).trim() || '#888'
      );
    for (const e of [copy, ...copy.querySelectorAll('*')])
      for (const a of ['fill', 'stroke'])
        if (e.getAttribute(a)?.includes('var(')) e.setAttribute(a, resolve(e.getAttribute(a)!));
    copy.setAttribute('font-family', 'system-ui, sans-serif');
    copy.insertBefore(
      svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: resolve('var(--surface)') }),
      copy.firstChild
    );
    return new XMLSerializer().serializeToString(copy);
  }

  private png(): Promise<Blob> {
    const text = this.svgText();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W * 2;
        canvas.height = H * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('could not draw it'))),
          'image/png'
        );
      };
      img.onerror = () => reject(new Error('could not draw it'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    });
  }
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

define('chat-chart', ChatChart);
