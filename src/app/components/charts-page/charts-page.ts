/**
 * Saved charts (FR-VIZ-005, ADR 0028): charts kept from the chat, shown as
 * they were saved or redrawn from today's data.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { buildChart, deleteChart, loadCharts, type SavedChart } from '../../charts.ts';
import { ensureLoaded } from '../../data.ts';
import { dateTime, el } from '../../format.ts';
import type { ChatChart } from '../chat-chart/chat-chart.ts';
import '../chat-chart/chat-chart.ts';
import template from './charts-page.html?raw';
import style from './charts-page.css?raw';

export class ChartsPage extends BaseComponent {
  constructor() {
    super(template, style);
  }

  override init(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const list = (await loadCharts()).slice().reverse();
    this.$('.empty').hidden = list.length > 0;
    this.$('.list').replaceChildren(...list.map((c) => this.entry(c)));
  }

  private entry(c: SavedChart): HTMLElement {
    const chart = document.createElement('chat-chart') as ChatChart;
    chart.saveable = false;
    chart.item = c;
    const status = el('span', { role: 'status' });
    const live = el(
      'button',
      { type: 'button', class: 'secondary small live' },
      "Show with today's data"
    );
    let showingLive = false;
    live.onclick = async () => {
      live.disabled = true;
      try {
        if (showingLive) {
          chart.item = c;
          status.textContent = '';
        } else {
          const r = await buildChart(await ensureLoaded(), c.spec);
          if (!r.ok) {
            status.textContent = r.error;
            return;
          }
          chart.item = r.chart;
          status.textContent = "Today's data.";
        }
        showingLive = !showingLive;
        live.textContent = showingLive ? 'Show as saved' : "Show with today's data";
      } finally {
        live.disabled = false;
      }
    };
    const del = el('button', { type: 'button', class: 'secondary small delete' }, 'Delete');
    del.onclick = async () => {
      del.disabled = true;
      await deleteChart(c.id);
      await this.render();
    };
    return el(
      'li',
      { 'data-id': c.id },
      chart,
      el('div', { class: 'meta' }, `Saved ${dateTime(c.savedAt)}`, live, del, status)
    );
  }
}

define('charts-page', ChartsPage);
