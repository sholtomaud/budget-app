import { BaseComponent, define } from '../../core/base-component.ts';
import style from './line-chart.css?raw';
import { ticks } from '../../chart-scale.ts';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  x: number[];
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  /** NFR-HON-001: shown with the chart. */
  provenance: string;
}

const W = 640;
const H = 280;
const M = { top: 12, right: 16, bottom: 36, left: 64 };
const SVG = 'http://www.w3.org/2000/svg';

const fmt = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 });

/** A hand-written SVG line chart (SPEC §15.1). Set `data` to render. */
export class LineChart extends BaseComponent {
  private _data: ChartData | null = null;

  constructor() {
    super('<figure><svg role="img"></svg><figcaption class="legend"></figcaption></figure>', style);
  }

  set data(d: ChartData | null) {
    this._data = d;
    if (this.isConnected) this.draw();
  }

  get data(): ChartData | null {
    return this._data;
  }

  override init(): void {
    this.draw();
  }

  private draw(): void {
    const svg = this.querySelector('svg');
    const legend = this.querySelector('.legend');
    const d = this._data;
    if (!svg || !legend) return;
    svg.replaceChildren();
    legend.replaceChildren();
    if (!d || d.x.length === 0) return;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute(
      'aria-label',
      `${d.yLabel} against ${d.xLabel}: ${d.series.map((s) => s.name).join(', ')} (${d.provenance})`
    );
    const all = d.series.flatMap((s) => s.values).filter(Number.isFinite);
    const yMin = Math.min(0, ...all);
    const yMax = Math.max(...all);
    const xMin = d.x[0]!;
    const xMax = d.x[d.x.length - 1]!;
    const yt = ticks(yMin, yMax);
    const y0 = Math.min(yMin, yt[0] ?? yMin);
    const y1 = Math.max(yMax, yt[yt.length - 1] ?? yMax);
    const sx = (v: number) => M.left + ((v - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
    const sy = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0 || 1)) * (H - M.top - M.bottom);

    const el = (name: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(SVG, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text !== undefined) e.textContent = text;
      return e;
    };

    const grid = el('g', { class: 'grid' });
    const axis = el('g', { class: 'axis' });
    for (const v of yt) {
      grid.append(el('line', { x1: M.left, x2: W - M.right, y1: sy(v), y2: sy(v) }));
      axis.append(el('text', { x: M.left - 8, y: sy(v) + 4, 'text-anchor': 'end' }, fmt.format(v)));
    }
    for (const v of ticks(xMin, xMax, 6)) {
      axis.append(el('line', { x1: sx(v), x2: sx(v), y1: H - M.bottom, y2: H - M.bottom + 4 }));
      axis.append(
        el('text', { x: sx(v), y: H - M.bottom + 16, 'text-anchor': 'middle' }, fmt.format(v))
      );
    }
    axis.append(el('line', { x1: M.left, x2: W - M.right, y1: H - M.bottom, y2: H - M.bottom }));
    axis.append(
      el('text', { x: (M.left + W - M.right) / 2, y: H - 4, 'text-anchor': 'middle' }, d.xLabel)
    );
    axis.append(
      el(
        'text',
        {
          x: 12,
          y: (M.top + H - M.bottom) / 2,
          'text-anchor': 'middle',
          transform: `rotate(-90 12 ${(M.top + H - M.bottom) / 2})`,
        },
        d.yLabel
      )
    );
    svg.append(grid, axis);

    const lines = el('g', { class: 'series' });
    d.series.forEach((s, i) => {
      const colour = `var(--series-${(i % 8) + 1})`;
      const path = s.values
        .map((v, j) => `${j === 0 ? 'M' : 'L'}${sx(d.x[j]!).toFixed(2)},${sy(v).toFixed(2)}`)
        .join('');
      const p = el('path', { d: path, stroke: colour });
      p.append(el('title', {}, s.name));
      lines.append(p);
      const key = document.createElement('span');
      key.style.setProperty('--swatch', colour);
      key.textContent = s.name;
      legend.append(key);
    });
    svg.append(lines);

    const prov = document.createElement('span');
    prov.className = 'prov';
    prov.dataset.prov = d.provenance;
    prov.textContent = d.provenance;
    legend.append(prov);
  }
}

define('line-chart', LineChart);
