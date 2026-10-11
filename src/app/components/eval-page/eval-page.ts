import { BaseComponent, define } from '../../core/base-component.ts';
import { el } from '../../format.ts';
import { evaluate, type EvalResult } from '../../../classify/eval.ts';
import { IngestService, MemoryImportStore } from '../../../ingest/service.ts';
import { generate } from '../../../synth/generator.ts';
import { parsePersona, type Persona } from '../../../synth/persona.ts';
import template from './eval-page.html?raw';

const personas = import.meta.glob<Persona>('../../../../fixtures/personas/*.json', {
  eager: true,
  import: 'default',
});

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export class EvalPage extends BaseComponent {
  constructor() {
    super(template);
  }

  override init(): void {
    const btn = this.$<HTMLButtonElement>('.run');
    btn.onclick = () => void this.run(btn);
  }

  private async run(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    const status = this.$('.status');
    const results = this.$('.results');
    results.replaceChildren();
    for (const raw of Object.values(personas)) {
      const persona = parsePersona(structuredClone(raw));
      status.textContent = `Evaluating ${persona.name}…`;
      const out = await generate(persona, '42');
      const svc = new IngestService(new MemoryImportStore());
      const enc = new TextEncoder();
      await svc.importFiles(
        out.files
          .filter(
            (f) => f.path.endsWith('.json') && !['truth.json', 'manifest.json'].includes(f.path)
          )
          .map((f) => ({ name: f.path, bytes: enc.encode(f.content) }))
      );
      const txns = [...svc.current.txns.values()];
      const r0 = await evaluate(txns, out.truth.transactions, 0);
      const r50 = await evaluate(txns, out.truth.transactions, 50);
      results.append(this.card(persona.name, r0, r50));
    }
    status.textContent = 'Done.';
    btn.disabled = false;
  }

  private card(name: string, r0: EvalResult, r50: EvalResult): HTMLElement {
    const gate = (ok: boolean) => el('strong', { class: ok ? 'ok' : 'warn' }, ok ? 'pass' : 'FAIL');
    const row = (label: string, a: string, b: string, check?: boolean) =>
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, label),
        el('td', { class: 'num' }, a),
        el('td', { class: 'num' }, b),
        el('td', {}, check === undefined ? '' : gate(check))
      );
    const kinds = Object.keys(r50.confusion).sort();
    const predicted = [...new Set(kinds.flatMap((k) => Object.keys(r50.confusion[k]!)))].sort();
    return el(
      'article',
      { class: 'card', 'data-persona': name },
      el('h2', {}, name),
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Metric'),
            el('th', { class: 'num' }, '0 corrections'),
            el('th', { class: 'num' }, `${r50.corrections} corrections`),
            el('th', {}, 'Threshold')
          )
        ),
        el(
          'tbody',
          {},
          row('Transactions', String(r0.n), String(r50.n)),
          row(
            'Kind accuracy',
            pct(r0.kindAccuracy),
            pct(r50.kindAccuracy),
            name === 'default' ? r50.kindAccuracy >= 0.98 : undefined
          ),
          row(
            'Category accuracy',
            pct(r0.categoryAccuracy),
            pct(r50.categoryAccuracy),
            name === 'default' ? r50.categoryAccuracy >= 0.95 : undefined
          ),
          row(
            'CAPEX precision',
            pct(r0.capex.precision),
            pct(r50.capex.precision),
            name === 'high-capex-crypto' ? r50.capex.precision >= 0.9 : undefined
          ),
          row(
            'CAPEX recall',
            pct(r0.capex.recall),
            pct(r50.capex.recall),
            name === 'high-capex-crypto' ? r50.capex.recall >= 0.9 : undefined
          ),
          row('Review queue', String(r0.reviewQueue), String(r50.reviewQueue)),
          row('By stage', JSON.stringify(r0.byStage), JSON.stringify(r50.byStage))
        )
      ),
      el('h3', {}, 'Kind confusion after corrections (rows: truth, columns: predicted)'),
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el('tr', {}, el('th', {}, ''), ...predicted.map((p) => el('th', { class: 'num' }, p)))
        ),
        el(
          'tbody',
          {},
          ...kinds.map((k) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, k),
              ...predicted.map((p) =>
                el('td', { class: 'num' }, String(r50.confusion[k]![p] ?? ''))
              )
            )
          )
        )
      )
    );
  }
}

define('eval-page', EvalPage);
