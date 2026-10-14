import { BaseComponent, define } from '../../core/base-component.ts';
import { navigate } from '../../core/router.ts';
import { handOffSheets } from '../../sheet-handoff.ts';
import { isBudgetSheet } from '../../../budget/workbook.ts';

import {
  data,
  ensureLoaded,
  filesToInputs,
  importCsv,
  importFiles,
  previewCsv,
  suggestCsv,
  undoImport,
  type DataState,
} from '../../data.ts';
import { count, dateTime, day, el, money, prov } from '../../format.ts';
import type { ImportRecord } from '../../../domain/types.ts';
import type { InputFile } from '../../../ingest/service.ts';
import type { ColumnSuggestion, Suggestion } from '../../../ingest/csv/mapper.ts';
import type { CsvPreview } from '../../../ingest/csv/preview.ts';
import type { BankCsvSpec } from '../../../ingest/csv/read.ts';
import {
  FIELD_LABEL,
  FIELDS,
  UNSURE,
  type DateOrder,
  type Field,
} from '../../../ingest/csv/fields.ts';
import template from './import-page.html?raw';
import style from './import-page.css?raw';

const BY_TEXT: Record<ColumnSuggestion['by'], string> = {
  memory: 'remembered',
  preset: 'preset',
  model: 'suggested',
};

interface PendingCsv {
  input: InputFile;
  text: string;
  suggestion: Suggestion;
  spec: BankCsvSpec;
  preview: CsvPreview;
}

const STATUS_TEXT: Record<string, string> = {
  imported: 'Imported',
  'duplicate-file': 'Already imported',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

export class ImportPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;
  private csvQueue: PendingCsv[] = [];

  constructor() {
    super(template, style);
  }

  override init(): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
      a.href = import.meta.env.BASE_URL + (a.dataset.route ?? '/').replace(/^\//, '');
    }
    const pickFiles = this.$<HTMLInputElement>('.pick-files');
    const pickFolder = this.$<HTMLInputElement>('.pick-folder');
    for (const input of [pickFiles, pickFolder]) {
      input.onchange = () => {
        if (input.files?.length) void this.importList([...input.files]);
        input.value = '';
      };
    }
    const drop = this.$('.drop');
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer) void this.importDrop(e.dataTransfer);
    };
    this.$<HTMLInputElement>('.csv-account').onchange = (e) =>
      this.updateSpec({ account: (e.target as HTMLInputElement).value.trim() || 'Account' });
    this.$<HTMLSelectElement>('.csv-dates').onchange = (e) =>
      this.updateSpec({ dateOrder: (e.target as HTMLSelectElement).value as DateOrder });
    this.$<HTMLInputElement>('.csv-invert').onchange = (e) =>
      this.updateSpec({ invert: (e.target as HTMLInputElement).checked });
    this.$<HTMLButtonElement>('.csv-import').onclick = () => void this.importCurrentCsv();
    this.$<HTMLButtonElement>('.csv-skip').onclick = () => {
      this.csvQueue.shift();
      this.renderCsv();
    };
    this.unsubscribe = data.subscribe((s) => this.render(s));
    this.render(data.getState());
    void ensureLoaded();
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private async importList(files: File[]): Promise<void> {
    if (!files.length) return;
    // A CSV chosen on its own goes to the column mapper; CSVs inside a folder are
    // usually the workbook sheets of an export and are reported as skipped.
    const csvs = files.length === 1 || files.every((f) => /\.csv$/i.test(f.name));
    const mapped = csvs ? files.filter((f) => /\.csv$/i.test(f.name)) : [];
    const rest = files.filter((f) => !mapped.includes(f));
    // A budget sheet (tier columns: Fin. Secure, Fin. Indepnt…) is not a bank
    // statement: it goes to the Budget screen's wizard instead of the column mapper.
    const sheets: File[] = [];
    try {
      const inputs = await filesToInputs(mapped);
      for (const [k, input] of inputs.entries()) {
        const text = new TextDecoder().decode(input.bytes);
        if (isBudgetSheet(text)) {
          sheets.push(mapped[k]!);
          continue;
        }
        const { suggestion, preview } = await suggestCsv(input.name, text);
        this.csvQueue.push({ input, text, suggestion, spec: suggestion.spec, preview });
      }
      this.renderCsv();
      if (rest.length) await importFiles(await filesToInputs(rest));
      if (sheets.length) this.offerSheets(sheets);
    } catch (e) {
      if (!rest.length) data.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Budget sheets: straight to the Budget screen, or a link when other files are still here. */
  private offerSheets(sheets: File[]): void {
    handOffSheets(sheets);
    if (!this.csvQueue.length) {
      navigate('/budget');
      return;
    }
    const names = sheets.map((f) => f.name).join(', ');
    const open = el('button', { type: 'button', class: 'secondary' }, 'Open on the Budget screen');
    open.onclick = () => navigate('/budget');
    this.$('.sheets').hidden = false;
    this.$('.sheets').replaceChildren(
      `${names} ${sheets.length === 1 ? 'is a budget sheet' : 'are budget sheets'}, not a bank statement. `,
      open
    );
  }

  private async updateSpec(patch: Partial<BankCsvSpec>): Promise<void> {
    const c = this.csvQueue[0];
    if (!c) return;
    c.spec = { ...c.spec, ...patch };
    c.preview = await previewCsv(c.text, c.spec);
    this.renderCsv();
  }

  private async importCurrentCsv(): Promise<void> {
    const c = this.csvQueue[0];
    if (!c || c.preview.summary.invalid) return;
    try {
      await importCsv(c.input, c.spec);
      this.csvQueue.shift();
      this.renderCsv();
    } catch {
      // Shown through the store's error.
    }
  }

  /** The column mapper for the first CSV in the queue (FR-ING-015, FR-ING-018). */
  private renderCsv(): void {
    const card = this.$('.csv-map');
    const c = this.csvQueue[0];
    card.hidden = !c;
    if (!c) return;
    const { spec, preview, suggestion } = c;
    const more = this.csvQueue.length - 1;
    this.$('.csv-name').textContent = c.input.name;
    this.$('.csv-source').textContent =
      `Columns suggested from ${suggestion.source}. Check each one, then import.` +
      (more ? ` ${more} more CSV file${more === 1 ? '' : 's'} after this one.` : '');
    this.$<HTMLInputElement>('.csv-account').value = spec.account;
    this.$<HTMLSelectElement>('.csv-dates').value = spec.dateOrder;
    this.$<HTMLInputElement>('.csv-invert').checked = spec.invert;

    const width = spec.columns.length;
    this.$('.csv-fields').replaceChildren(
      ...spec.columns.map((field, j) => {
        const header = preview.headers[j]?.trim();
        const select = el('select', {
          'aria-label': `Column ${j + 1}${header ? ` (${header})` : ''}`,
          'data-column': String(j),
        });
        select.append(...FIELDS.map((f) => el('option', { value: f }, FIELD_LABEL[f])));
        select.value = field;
        select.onchange = () => {
          const columns = [...spec.columns];
          columns[j] = select.value as Field;
          void this.updateSpec({ columns });
        };
        const s = suggestion.columns[j];
        const changed = s && s.field !== field;
        const by = el(
          'span',
          { class: 'by muted' },
          changed
            ? 'changed by you'
            : s
              ? s.by === 'model'
                ? `${BY_TEXT.model} (${Math.round(s.confidence * 100)} %)`
                : BY_TEXT[s.by]
              : ''
        );
        if (!changed && s?.by === 'model' && s.confidence < UNSURE) by.setAttribute('data-low', '');
        return el('th', { scope: 'col' }, select, by);
      })
    );
    this.$('.csv-headers').replaceChildren(
      ...Array.from({ length: width }, (_, j) =>
        el('th', { scope: 'col' }, preview.headers[j] ?? '')
      )
    );
    this.$('.csv-headers').hidden = preview.headers.length === 0;
    this.$('.csv-table tbody').replaceChildren(
      ...preview.sample.map((r) =>
        el('tr', {}, ...Array.from({ length: width }, (_, j) => el('td', {}, r[j] ?? '')))
      )
    );

    const sum = preview.summary;
    const out = this.$('.csv-summary');
    const button = this.$<HTMLButtonElement>('.csv-import');
    button.disabled = !!sum.invalid || sum.transactions === 0;
    out.className = `csv-summary${sum.invalid ? ' warn' : ''}`;
    if (sum.invalid) {
      out.replaceChildren(
        `${sum.invalid}. If this is a budget sheet, import it on the Budget screen instead.`
      );
    } else {
      out.replaceChildren(
        `${count(sum.transactions)} transactions in ${sum.accounts.join(', ')}`,
        sum.from ? `, ${day(sum.from)} – ${day(sum.to!)}` : '',
        `. Money in ${money(sum.moneyIn)}, money out ${money(sum.moneyOut)}. `,
        sum.balanced
          ? 'The balance column agrees with the amounts, so the account can be reconciled. '
          : '',
        sum.skipped ? `${count(sum.skipped)} rows can't be read and will be skipped. ` : '',
        prov(sum.synthetic ? 'illustrative' : 'actual')
      );
    }
    this.$('.csv-issues').replaceChildren(
      ...sum.issues.map((i) => el('li', {}, `Line ${i.row}: ${i.message}`))
    );
  }

  private async importDrop(dt: DataTransfer): Promise<void> {
    const entries = [...dt.items]
      .map((i) => i.webkitGetAsEntry?.())
      .filter((e): e is FileSystemEntry => !!e);
    const files: File[] = [];
    const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
      if (entry.isFile) {
        const f = await new Promise<File>((res, rej) =>
          (entry as FileSystemFileEntry).file(res, rej)
        );
        files.push(new File([f], path + f.name, { type: f.type, lastModified: f.lastModified }));
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e, `${path}${entry.name}/`);
        } while (batch.length);
      }
    };
    if (entries.length) for (const e of entries) await walk(e, '');
    else files.push(...dt.files);
    await this.importList(files);
  }

  private render(s: DataState): void {
    this.$('.status').textContent = s.busy ?? '';
    const err = this.$('.error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';
    this.renderLast(s.lastImport);
    this.renderAccounts(s);
    this.renderHistory(s);
  }

  private renderLast(rec: ImportRecord | null): void {
    const card = this.$('.last');
    card.hidden = !rec;
    if (!rec) return;
    const c = rec.counts;
    this.$('.last-summary').replaceChildren(
      `${rec.label}: ${count(c.new)} new, ${count(c.duplicate)} duplicate, ${count(c.superseded)} superseded, ${count(c.rejected)} rejected. `,
      prov(rec.synthetic ? 'illustrative' : 'actual')
    );
    const byStatus = (st: string) => rec.files.filter((f) => f.status === st).length;
    const parts = [
      `${byStatus('imported')} imported`,
      byStatus('duplicate-file') ? `${byStatus('duplicate-file')} already imported` : '',
      byStatus('skipped') ? `${byStatus('skipped')} skipped` : '',
      byStatus('rejected') ? `${byStatus('rejected')} rejected` : '',
    ].filter(Boolean);
    this.$('.file-count').textContent =
      `${rec.files.length} file${rec.files.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
    this.$<HTMLDetailsElement>('.file-details').open =
      byStatus('rejected') > 0 || rec.files.length <= 5;
    this.$('.files tbody').replaceChildren(
      ...rec.files.map((f) =>
        el(
          'tr',
          { 'data-status': f.status },
          el(
            'td',
            { class: 'file' },
            f.name,
            f.message ? el('div', { class: 'muted' }, f.message) : null
          ),
          el('td', {}, f.kind),
          el(
            'td',
            { class: f.status === 'rejected' ? 'warn' : '' },
            STATUS_TEXT[f.status] ?? f.status
          ),
          el('td', { class: 'num' }, count(f.counts.new)),
          el('td', { class: 'num' }, count(f.counts.duplicate)),
          el('td', { class: 'num' }, count(f.counts.superseded)),
          el('td', { class: 'num' }, count(f.counts.rejected))
        )
      )
    );
  }

  private renderAccounts(s: DataState): void {
    const v = s.view;
    const table = this.$<HTMLTableElement>('.accounts');
    const has = !!v && v.accounts.length > 0;
    table.hidden = !has;
    this.$('.empty').hidden = has;
    if (!v || !has) return;
    const rows = v.accounts.map((a) => {
      const txns = v.txns.filter((t) => t.accountId === a.id);
      const posted = txns.filter((t) => t.status === 'POSTED');
      const pending = txns.filter((t) => t.status === 'PENDING' && !t.supersededBy).length;
      const dates = posted.map((t) => t.date).sort();
      const cps = v.balances.filter((b) => b.accountId === a.id);
      const latest = cps.at(-1);
      const rec = v.reconciliation.find((r) => r.accountId === a.id);
      let recCell: HTMLElement;
      if (!rec || rec.checkpoints < 2)
        recCell = el('span', { class: 'muted' }, 'Needs two balance checkpoints');
      else if (rec.gaps.length === 0)
        recCell = el('span', { class: 'ok' }, `Reconciled over ${rec.intervals} periods`);
      else {
        recCell = el(
          'div',
          { class: 'warn' },
          `${rec.gaps.length} gap${rec.gaps.length === 1 ? '' : 's'}: missing transactions?`,
          el(
            'ul',
            { class: 'gaps' },
            ...rec.gaps.map((g) =>
              el('li', {}, `${day(g.from)} – ${day(g.to)}: off by ${money(g.drift, a.currency)}`)
            )
          )
        );
      }
      return el(
        'tr',
        { 'data-account': a.id },
        el(
          'th',
          { scope: 'row' },
          a.displayName,
          a.maskedNumber ? el('div', { class: 'muted' }, a.maskedNumber) : null
        ),
        el('td', {}, a.role),
        el(
          'td',
          { class: 'num' },
          count(posted.length),
          pending ? el('div', { class: 'muted' }, `+${count(pending)} pending`) : null
        ),
        el('td', {}, dates.length ? `${day(dates[0]!)} – ${day(dates.at(-1)!)}` : '–'),
        el(
          'td',
          { class: 'num' },
          latest ? money(latest.current, latest.currency) : '–',
          latest
            ? el('div', {}, prov(latest.asAtSource === 'assumed' ? 'assumed' : a.provenance))
            : null,
          cps.some((c) => c.asAtSource === 'assumed')
            ? el('div', { class: 'muted' }, 'balance times taken from file dates')
            : null
        ),
        el('td', {}, recCell)
      );
    });
    this.$('.accounts tbody').replaceChildren(...rows);
  }

  private renderHistory(s: DataState): void {
    const imports = [...(s.view?.imports ?? [])].reverse();
    const table = this.$<HTMLTableElement>('.history');
    table.hidden = imports.length === 0;
    this.$('.none').hidden = imports.length > 0;
    this.$('.history tbody').replaceChildren(
      ...imports.map((i) => {
        const undo = el('button', { type: 'button', class: 'secondary small' }, 'Undo');
        undo.setAttribute('aria-label', `Undo import ${i.label}`);
        undo.onclick = () => {
          if (confirm(`Undo "${i.label}"? Its transactions and balances are removed.`))
            void undoImport(i.id).catch(() => {});
        };
        return el(
          'tr',
          { 'data-import': i.id },
          el('td', {}, dateTime(i.at)),
          el('td', {}, i.label, ' ', prov(i.synthetic ? 'illustrative' : 'actual')),
          el('td', { class: 'num' }, count(i.files.filter((f) => f.status === 'imported').length)),
          el('td', { class: 'num' }, count(i.counts.new)),
          el('td', { class: 'num' }, count(i.counts.duplicate)),
          el('td', {}, undo)
        );
      })
    );
  }
}

define('import-page', ImportPage);
