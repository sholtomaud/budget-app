import { BaseComponent, define } from '../../core/base-component.ts';
import { ticks } from '../../chart-scale.ts';
import style from './fan-chart.css?raw';

export interface FanData {
  /** History, oldest first. */
  history: { months: string[]; values: number[] };
  months: string[];
  quantiles: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  /** Values are minor units; the axis shows dollars. */
  provenance: string;
  label: string;
  /** A horizontal line the values should stay above (the goal's floor), minor units. */
  floor?: number;
  /** Individual paths drawn faintly over the bands (example runs), minor units. */
  paths?: number[][];
  /** Axis labels: months (default) or years from the first month. */
  axis?: 'months' | 'years';
  /** Replaces the default caption text. */
  caption?: string;
  /** "a month" (default) or "" for stock values like capital. */
  unit?: string;
}

const SVG = 'http://www.w3.org/2000/svg';
const W = 520;
const H = 200;
const M = { top: 8, right: 8, bottom: 22, left: 52 };
const compact = new Intl.NumberFormat('en-AU', {
  notation: 'compact',
  maximumFractionDigits: 1,
  style: 'currency',
  currency: 'AUD',
});

/**
 * A forecast fan: history as a line, then P5–P95 and P25–P75 bands with the
 * P50 line (SPEC §12: uncertain values are bands, not single lines).
 */
export class FanChart extends BaseComponent {
  private _data: FanData | null = null;

  constructor() {
    super('<figure><svg role="img"></svg><figcaption></figcaption></figure>', style);
  }

  set data(d: FanData | null) {
    this._data = d;
    if (this.isConnected) this.draw();
  }

  override init(): void {
    this.draw();
  }

  private draw(): void {
    const svg = this.querySelector('svg');
    const cap = this.querySelector('figcaption');
    const d = this._data;
    if (!svg || !cap || !d) return;
    svg.replaceChildren();
    const hist = d.history.values;
    const all = [...hist, ...d.quantiles.p95, ...d.quantiles.p5, d.floor ?? 0].map((v) => v / 100);
    const yMax = Math.max(1, ...all);
    const yt = ticks(0, yMax, 4);
    const top = Math.max(yMax, yt.at(-1) ?? yMax);
    const n = hist.length + d.months.length;
    const sx = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - M.left - M.right));
    const sy = (v: number) => H - M.bottom - (v / 100 / top) * (H - M.top - M.bottom);
    const mk = (name: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(SVG, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text !== undefined) e.textContent = text;
      return e;
    };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const p50 = d.quantiles.p50;
    svg.setAttribute(
      'aria-label',
      `${d.label}: ${d.months.length}-month forecast, median ${compact.format((p50[0] ?? 0) / 100)} to ${compact.format((p50.at(-1) ?? 0) / 100)}${d.unit === undefined ? ' a month' : d.unit} (${d.provenance})`
    );
    const grid = mk('g', { class: 'grid' });
    for (const v of yt) {
      grid.append(mk('line', { x1: M.left, x2: W - M.right, y1: sy(v * 100), y2: sy(v * 100) }));
      grid.append(
        mk('text', { x: M.left - 4, y: sy(v * 100) + 3, 'text-anchor': 'end' }, compact.format(v))
      );
    }
    const labels = [...d.history.months, ...d.months];
    const every = Math.max(1, Math.ceil(n / 6));
    if (d.axis === 'years') {
      const step = Math.max(1, Math.ceil(n / 12 / 8));
      for (let y = 0; y * 12 < n; y += step)
        grid.append(mk('text', { x: sx(y * 12), y: H - 6, 'text-anchor': 'middle' }, `${y}y`));
    } else {
      labels.forEach((m, i) => {
        if (i % every === 0)
          grid.append(mk('text', { x: sx(i), y: H - 6, 'text-anchor': 'middle' }, m));
      });
    }
    svg.append(grid);
    const off = hist.length;
    // Bands start from the last history point so the fan joins the line.
    const lastX = off - 1;
    const lastY = hist.at(-1);
    const band = (lo: number[], hi: number[], cls: string) => {
      const pts: string[] = [];
      if (lastY !== undefined) pts.push(`${sx(lastX)},${sy(lastY)}`);
      hi.forEach((v, i) => pts.push(`${sx(off + i)},${sy(v)}`));
      for (let i = lo.length - 1; i >= 0; i--) pts.push(`${sx(off + i)},${sy(lo[i]!)}`);
      svg.append(mk('polygon', { class: cls, points: pts.join(' ') }));
    };
    band(d.quantiles.p5, d.quantiles.p95, 'outer');
    band(d.quantiles.p25, d.quantiles.p75, 'inner');
    const line = (vals: number[], start: number, cls: string, joinFrom?: number) => {
      const pts = vals.map((v, i) => `${sx(start + i)},${sy(v)}`);
      if (joinFrom !== undefined && lastY !== undefined) pts.unshift(`${sx(lastX)},${sy(lastY)}`);
      if (pts.length) svg.append(mk('polyline', { class: cls, points: pts.join(' ') }));
    };
    for (const p of d.paths ?? []) line(p, off, 'path');
    line(hist, 0, 'history');
    line(p50, off, 'median', lastX);
    if (d.floor !== undefined)
      svg.append(
        mk('line', {
          class: 'floor',
          x1: M.left,
          x2: W - M.right,
          y1: sy(d.floor),
          y2: sy(d.floor),
        })
      );
    if (off > 0)
      svg.append(
        mk('line', { class: 'split', x1: sx(lastX), x2: sx(lastX), y1: M.top, y2: H - M.bottom })
      );
    const prov = document.createElement('span');
    prov.className = 'prov';
    prov.dataset.prov = d.provenance;
    prov.textContent = d.provenance;
    cap.replaceChildren(d.caption ?? 'History, then median with 50 % and 90 % bands. ', prov);
  }
}

define('fan-chart', FanChart);
