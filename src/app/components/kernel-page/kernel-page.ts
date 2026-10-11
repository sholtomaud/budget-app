import { BaseComponent, define } from '../../core/base-component.ts';
import { sim } from '../../sim-client.ts';
import '../line-chart/line-chart.ts';
import type { LineChart } from '../line-chart/line-chart.ts';
import template from './kernel-page.html?raw';
import style from './kernel-page.css?raw';

const MONEY_STORAGES = ['bank_account', 'super_fund', 'credit_card_debt'];

export class KernelPage extends BaseComponent {
  constructor() {
    super(template, style);
  }

  override init(): void {
    const status = this.$('.k-status');
    sim()
      .kernelInfo()
      .then((k) => {
        status.textContent = 'SHA-256 matches the pin';
        status.dataset.ok = 'true';
        this.$('.k-version').textContent = k.version;
        this.$('.k-source').textContent =
          `${k.pin.repo} @ ${k.pin.branch} ${k.pin.commit.slice(0, 12)}`;
        this.$('.k-sha').textContent = k.sha256;
      })
      .catch((err: unknown) => {
        status.textContent = `Refused: ${message(err)}`;
        status.dataset.ok = 'false';
      });

    const run = this.$<HTMLButtonElement>('.run');
    run.onclick = () => void this.runExample(run);
  }

  private async runExample(button: HTMLButtonElement): Promise<void> {
    const error = this.$('.error');
    const result = this.$('.result');
    button.disabled = true;
    button.textContent = 'Running…';
    error.hidden = true;
    try {
      const trace = await sim().runHouseholdExample({ track: MONEY_STORAGES });
      this.$('.summary').textContent =
        `${trace.modelName}: ${trace.steps} steps to t = ${Number(trace.times.at(-1)?.toPrecision(10))} ` +
        `in ${trace.ms.toFixed(1)} ms.`;
      this.$('.carriers tbody').replaceChildren(
        ...trace.carriers.map((c) => {
          const tr = document.createElement('tr');
          tr.dataset.carrier = c.id;
          for (const [text, cls] of [
            [c.id, ''],
            [c.conserved ? 'yes' : 'no', ''],
            [c.maxAbsError.toExponential(2), 'num'],
          ] as const) {
            const td = document.createElement('td');
            td.textContent = text;
            if (cls) td.className = cls;
            tr.append(td);
          }
          return tr;
        })
      );
      this.$<LineChart>('line-chart').data = {
        x: trace.times,
        series: MONEY_STORAGES.map((id) => ({ name: id, values: trace.series[id] ?? [] })),
        xLabel: 'Model time',
        yLabel: 'AUD',
        provenance: 'illustrative',
      };
      result.hidden = false;
      result.dataset.ready = 'true';
    } catch (err) {
      error.textContent = message(err);
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Run again';
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

define('kernel-page', KernelPage);
