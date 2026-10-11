import { BaseComponent, define } from '../../core/base-component.ts';

import {
  data,
  ensureLoaded,
  filesToInputs,
  importFiles,
  undoImport,
  type DataState,
} from '../../data.ts';
import { count, dateTime, day, el, money, prov } from '../../format.ts';
import type { ImportRecord } from '../../../domain/types.ts';
import template from './import-page.html?raw';
import style from './import-page.css?raw';

const STATUS_TEXT: Record<string, string> = {
  imported: 'Imported',
  'duplicate-file': 'Already imported',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

export class ImportPage extends BaseComponent {
  private unsubscribe: (() => void) | null = null;

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
    this.unsubscribe = data.subscribe((s) => this.render(s));
    this.render(data.getState());
    void ensureLoaded();
  }

  override destroy(): void {
    this.unsubscribe?.();
  }

  private async importList(files: File[]): Promise<void> {
    if (!files.length) return;
    try {
      await importFiles(await filesToInputs(files));
    } catch {
      // Shown through the store's error.
    }
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
