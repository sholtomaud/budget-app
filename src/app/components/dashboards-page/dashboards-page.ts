/**
 * Dashboards (ADR 0036): named layouts of charts, drawn from today's data.
 * Charts come from the list on the left (built-in and saved), by dragging or
 * with Add; every drag has a button, for keyboards and phones.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { buildChart, loadCharts, type BuiltChart, type SavedChart } from '../../charts.ts';
import { DASHBOARDS_CHANGED, loadDashboards, saveDashboards } from '../../dashboards.ts';
import { data, ensureLoaded } from '../../data.ts';
import { el } from '../../format.ts';
import type { DataView } from '../../../data/service.ts';
import {
  addTile,
  duplicate,
  emptyDashboard,
  MAX_TILES,
  moveTile,
  removeTile,
  rename,
  setWide,
  type Dashboard,
  type Tile,
  type TileSource,
} from '../../../viz/dashboard.ts';
import { LIBRARY, libraryChart } from '../../../viz/library.ts';
import type { ChartSpec } from '../../../viz/spec.ts';
import type { ChatChart } from '../chat-chart/chat-chart.ts';
import '../chat-chart/chat-chart.ts';
import template from './dashboards-page.html?raw';
import style from './dashboards-page.css?raw';

const SOURCE = 'text/x-crux-source';
const TILE = 'text/x-crux-tile';

export class DashboardsPage extends BaseComponent {
  private list: Dashboard[] = [];
  private openId: string | null = null;
  private saved: SavedChart[] = [];
  private view: DataView | null = null;
  private dragging: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    this.$<HTMLSelectElement>('.pick').onchange = (e) => {
      this.openId = (e.target as HTMLSelectElement).value;
      void this.persist().then(() => this.renderGrid());
    };
    this.$<HTMLButtonElement>('.new').onclick = () => {
      const d = emptyDashboard('New dashboard');
      this.list = [...this.list, d];
      this.openId = d.id;
      void this.persist().then(() => {
        this.renderAll();
        this.askName();
      });
    };
    this.$<HTMLButtonElement>('.rename').onclick = () => this.askName();
    this.$<HTMLButtonElement>('.copy').onclick = () => {
      const d = this.current();
      if (!d) return;
      const c = duplicate(d);
      this.list = [...this.list, c];
      this.openId = c.id;
      void this.persist().then(() => {
        this.renderAll();
        this.say(`Made a copy: ${c.name}.`);
      });
    };
    const confirm = this.$('.confirm');
    this.$<HTMLButtonElement>('.delete').onclick = () => {
      const d = this.current();
      if (!d) return;
      this.$('.confirm-text').textContent =
        `Delete “${d.name}”? The charts it shows are not deleted.`;
      confirm.hidden = false;
      this.$<HTMLButtonElement>('.confirm .no').focus();
    };
    this.$<HTMLButtonElement>('.confirm .no').onclick = () => (confirm.hidden = true);
    this.$<HTMLButtonElement>('.confirm .yes').onclick = () => {
      const d = this.current();
      confirm.hidden = true;
      if (!d) return;
      this.list = this.list.filter((x) => x.id !== d.id);
      if (!this.list.length) this.list = [emptyDashboard('My dashboard')];
      this.openId = this.list[0]!.id;
      void this.persist().then(() => {
        this.renderAll();
        this.say(`Deleted ${d.name}.`);
      });
    };
    const form = this.$<HTMLFormElement>('.rename-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = (form.elements.namedItem('name') as HTMLInputElement).value;
      form.hidden = true;
      this.change((d) => rename(d, name));
    };
    this.$<HTMLButtonElement>('.rename-form .cancel').onclick = () => (form.hidden = true);
    const grid = this.$('.grid');
    grid.addEventListener('dragover', (e) => this.dragOver(e));
    grid.addEventListener('dragleave', (e) =>
      (e.target as Element).closest?.('li')?.classList.remove('over')
    );
    grid.addEventListener('drop', (e) => this.drop(e));
    window.addEventListener(DASHBOARDS_CHANGED, this.onChanged);
    void this.load();
  }

  override destroy(): void {
    this.unsubscribe?.();
    window.removeEventListener(DASHBOARDS_CHANGED, this.onChanged);
  }

  /** A dashboard saved or undone from the chat: show the list as stored now. */
  private readonly onChanged = () => {
    void Promise.all([loadDashboards(), loadCharts()]).then(([stored, saved]) => {
      this.list = stored.list;
      this.openId = stored.open ?? stored.list[0]?.id ?? null;
      this.saved = saved;
      this.renderAll();
    });
  };

  private async load(): Promise<void> {
    const [stored, saved, view] = await Promise.all([
      loadDashboards(),
      loadCharts(),
      ensureLoaded(),
    ]);
    this.list = stored.list;
    this.openId = stored.list.some((d) => d.id === stored.open) ? stored.open : stored.list[0]!.id;
    this.saved = saved;
    // The store's view is the newest; ensureLoaded's may predate an import.
    this.view = data.getState().view ?? view;
    this.renderAll();
    // New data (an import, a change elsewhere): redraw from it.
    this.unsubscribe = data.subscribe((s) => {
      if (!s.view || s.view === this.view) return;
      this.view = s.view;
      void this.renderRail();
      void this.renderGrid();
    });
  }

  private current(): Dashboard | undefined {
    return this.list.find((d) => d.id === this.openId);
  }

  private persist(): Promise<void> {
    return saveDashboards(this.list, this.openId);
  }

  private change(f: (d: Dashboard) => Dashboard, said?: string): void {
    const d = this.current();
    if (!d) return;
    const next = f(d);
    this.list = this.list.map((x) => (x.id === d.id ? next : x));
    void this.persist().then(() => {
      this.renderBar();
      this.renderGrid();
      if (said) this.say(said);
    });
  }

  private say(text: string): void {
    this.$('.status').textContent = text;
  }

  private askName(): void {
    const d = this.current();
    const form = this.$<HTMLFormElement>('.rename-form');
    const input = form.elements.namedItem('name') as HTMLInputElement;
    input.value = d?.name ?? '';
    form.hidden = false;
    input.focus();
    input.select();
  }

  private renderAll(): void {
    this.renderBar();
    void this.renderRail();
    void this.renderGrid();
  }

  private renderBar(): void {
    const pick = this.$<HTMLSelectElement>('.pick');
    pick.replaceChildren(
      ...this.list.map((d) => new Option(d.name, d.id, false, d.id === this.openId))
    );
  }

  /** The spec a tile shows, or why it can't be shown. */
  private specOf(s: TileSource): { spec: ChartSpec } | { gone: string } {
    if (s.kind === 'spec') return { spec: s.spec };
    if (s.kind === 'builtin') {
      const c = libraryChart(s.id);
      return c ? { spec: c.spec } : { gone: 'This built-in chart is no longer in the app.' };
    }
    const c = this.saved.find((x) => x.id === s.id);
    return c ? { spec: c.spec } : { gone: 'This saved chart was deleted.' };
  }

  private async draw(
    spec: ChartSpec
  ): Promise<{ ok: true; chart: BuiltChart } | { ok: false; error: string }> {
    if (!this.view) return { ok: false, error: 'Loading…' };
    return buildChart(this.view, spec);
  }

  private async renderRail(): Promise<void> {
    const item = async (source: TileSource, spec: ChartSpec) => {
      const add = el('button', { type: 'button', class: 'secondary small add' }, 'Add');
      add.setAttribute('aria-label', `Add “${spec.title}” to the dashboard`);
      add.onclick = () => this.add(source, spec.title);
      const li = el('li', { draggable: 'true', 'data-title': spec.title });
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(SOURCE, JSON.stringify(source));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      const r = await this.draw(spec);
      if (r.ok) {
        const chart = document.createElement('chat-chart') as ChatChart;
        chart.mode = 'thumb';
        chart.item = r.chart;
        li.append(chart);
      } else {
        li.append(
          el('p', { class: 'title' }, spec.title),
          el('p', { class: 'unavailable' }, r.error)
        );
      }
      li.append(add);
      return li;
    };
    this.$('.builtin').replaceChildren(
      ...(await Promise.all(LIBRARY.map((c) => item({ kind: 'builtin', id: c.id }, c.spec))))
    );
    const saved = this.saved.slice().reverse();
    this.$('.no-saved').hidden = saved.length > 0;
    this.$('.saved').replaceChildren(
      ...(await Promise.all(saved.map((c) => item({ kind: 'saved', id: c.id }, c.spec))))
    );
  }

  private add(source: TileSource, title: string, at?: number): void {
    const d = this.current();
    if (!d) return;
    if (d.tiles.length >= MAX_TILES) {
      this.say(
        `A dashboard holds up to ${MAX_TILES} charts. Remove one first, or start a new dashboard.`
      );
      return;
    }
    this.change((x) => addTile(x, source, at), `Added “${title}”.`);
  }

  private async renderGrid(): Promise<void> {
    const d = this.current();
    const grid = this.$('.grid');
    if (!d) return grid.replaceChildren();
    const tiles = await Promise.all(d.tiles.map((t, i) => this.tile(t, i, d.tiles.length)));
    // A later render may have started meanwhile; only the newest one draws.
    if (this.current() !== d) return;
    const end = el(
      'li',
      { class: 'end', 'data-at': String(d.tiles.length) },
      d.tiles.length
        ? 'Drop a chart here to add it at the end.'
        : 'This dashboard is empty. Drag a chart here, or use a chart’s Add button.'
    );
    grid.replaceChildren(...tiles, end);
  }

  private async tile(t: Tile, i: number, n: number): Promise<HTMLElement> {
    const s = this.specOf(t.source);
    const title = 'spec' in s ? s.spec.title : 'Chart';
    const li = el('li', {
      class: `tile${t.wide ? ' wide' : ''}`,
      draggable: 'true',
      'data-tile': t.id,
      'data-at': String(i),
    });
    li.addEventListener('dragstart', (e) => {
      this.dragging = t.id;
      e.dataTransfer?.setData(TILE, t.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => (this.dragging = null));
    if ('gone' in s) li.append(el('p', { class: 'problem' }, s.gone));
    else {
      const r = await this.draw(s.spec);
      if (r.ok) {
        const chart = document.createElement('chat-chart') as ChatChart;
        chart.mode = 'tile';
        chart.item = r.chart;
        li.append(chart);
      } else li.append(el('p', { class: 'problem' }, `${s.spec.title}: ${r.error}`));
    }
    const button = (text: string, label: string, on: () => void, disabled = false) => {
      const b = el('button', { type: 'button', class: 'secondary small' }, text);
      b.setAttribute('aria-label', `${label} “${title}”`);
      b.disabled = disabled;
      b.onclick = on;
      return b;
    };
    const wide = button(t.wide ? 'Narrow' : 'Wide', t.wide ? 'Make narrow:' : 'Make wide:', () =>
      this.change((d) => setWide(d, t.id, !t.wide))
    );
    li.append(
      el(
        'div',
        { class: 'controls' },
        button(
          '↑ Earlier',
          'Move earlier:',
          () => this.change((d) => moveTile(d, t.id, i - 1)),
          i === 0
        ),
        button(
          '↓ Later',
          'Move later:',
          () => this.change((d) => moveTile(d, t.id, i + 1)),
          i === n - 1
        ),
        wide,
        button('Remove', 'Remove', () =>
          this.change((d) => removeTile(d, t.id), `Removed “${title}”.`)
        )
      )
    );
    return li;
  }

  private dragOver(e: DragEvent): void {
    const li = (e.target as Element).closest?.('.grid > li');
    const types = e.dataTransfer?.types ?? [];
    if (!li || !(types.includes(SOURCE) || types.includes(TILE))) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes(TILE) ? 'move' : 'copy';
    for (const o of this.querySelectorAll('.grid > li.over'))
      if (o !== li) o.classList.remove('over');
    li.classList.add('over');
  }

  /** A drop on a tile puts the chart before it; on the end slot, at the end. */
  private drop(e: DragEvent): void {
    const li = (e.target as Element).closest?.('.grid > li');
    if (!li) return;
    e.preventDefault();
    li.classList.remove('over');
    const at = Number((li as HTMLElement).dataset.at);
    const tileId = e.dataTransfer?.getData(TILE) || this.dragging;
    const raw = e.dataTransfer?.getData(SOURCE);
    if (raw) {
      const source = JSON.parse(raw) as TileSource;
      const s = this.specOf(source);
      this.add(source, 'spec' in s ? s.spec.title : 'chart', at);
    } else if (tileId) {
      const d = this.current();
      const from = d?.tiles.findIndex((t) => t.id === tileId) ?? -1;
      if (from < 0) return;
      this.change((x) => moveTile(x, tileId, from < at ? at - 1 : at));
    }
    this.dragging = null;
  }
}

define('dashboards-page', DashboardsPage);
