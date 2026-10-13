/**
 * The import pipeline behind the Import screen (FR-ING-001…008).
 *
 * Accepted files are stored verbatim, one record per import. The ledger is
 * rebuilt by folding the stored imports in order, so undoing an import
 * (FR-ING-006) is "delete it and rebuild".
 */
import type { ImportCounts, ImportFileResult, ImportRecord } from '../domain/types.ts';
import { sha256Hex } from '../lib/hash.ts';
import { isZip, readZip } from '../lib/zip.ts';
import { parseCdrText } from './cdr/parse.ts';
import { csvParsedFiles } from './csv/preview.ts';
import type { BankCsvSpec } from './csv/read.ts';
import { applyImport, emptyLedger, reconcile, type Ledger, type ParsedFile } from './ledger.ts';
import type { LedgerView } from './view.ts';

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // NFR-SEC-002

export interface InputFile {
  name: string;
  bytes: Uint8Array;
  /** Epoch milliseconds, from File.lastModified. */
  lastModified?: number;
}

export interface StoredFile {
  name: string;
  sha256: string;
  text: string;
  lastModified?: string;
  /** Set for a transaction CSV: how its columns were mapped (ADR 0030). */
  csv?: BankCsvSpec;
}

export interface StoredImport {
  record: ImportRecord;
  files: StoredFile[];
}

export interface ImportStore {
  all(): Promise<StoredImport[]>;
  put(i: StoredImport): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryImportStore implements ImportStore {
  private readonly items = new Map<string, StoredImport>();
  async all() {
    return [...this.items.values()].map((i) => structuredClone(i));
  }
  async put(i: StoredImport) {
    this.items.set(i.record.id, structuredClone(i));
  }
  async delete(id: string) {
    this.items.delete(id);
  }
  async clear() {
    this.items.clear();
  }
}

const sumCounts = (rs: ImportFileResult[]): ImportCounts =>
  rs.reduce(
    (a, r) => ({
      new: a.new + r.counts.new,
      duplicate: a.duplicate + r.counts.duplicate,
      superseded: a.superseded + r.counts.superseded,
      rejected: a.rejected + r.counts.rejected,
    }),
    { new: 0, duplicate: 0, superseded: 0, rejected: 0 }
  );

let idCounter = 0;
function newImportId(now: Date): string {
  idCounter = (idCounter + 1) % 1e6;
  return `imp-${now.getTime().toString(36)}-${idCounter.toString(36)}`;
}

/** Expand ZIPs into their entries; reject oversized files. */
async function expand(
  inputs: InputFile[]
): Promise<{ files: InputFile[]; rejected: ImportFileResult[] }> {
  const files: InputFile[] = [];
  const rejected: ImportFileResult[] = [];
  for (const f of inputs) {
    if (f.bytes.length > MAX_FILE_BYTES) {
      rejected.push(rejectResult(f.name, '', 'File is larger than 50 MB'));
      continue;
    }
    if (isZip(f.bytes)) {
      try {
        for (const e of await readZip(f.bytes)) {
          files.push({
            name: `${f.name}/${e.name}`,
            bytes: e.data,
            ...(f.lastModified ? { lastModified: f.lastModified } : {}),
          });
        }
      } catch (e) {
        rejected.push(rejectResult(f.name, '', (e as Error).message));
      }
    } else files.push(f);
  }
  return { files, rejected };
}

function rejectResult(
  name: string,
  sha256: string,
  message: string,
  skipped = false
): ImportFileResult {
  return {
    name,
    sha256,
    kind: 'unknown',
    status: skipped ? 'skipped' : 'rejected',
    message,
    counts: { new: 0, duplicate: 0, superseded: 0, rejected: 0 },
  };
}

export class IngestService {
  private readonly store: ImportStore;
  private ledger: Ledger;
  private imports: ImportRecord[] = [];
  readonly timezone: string;

  constructor(store: ImportStore, timezone = 'Australia/Sydney') {
    this.store = store;
    this.timezone = timezone;
    this.ledger = emptyLedger(timezone);
  }

  /** Rebuild the ledger from every stored import, oldest first. */
  async load(): Promise<void> {
    const stored = (await this.store.all()).sort((a, b) =>
      a.record.at < b.record.at
        ? -1
        : a.record.at > b.record.at
          ? 1
          : a.record.id < b.record.id
            ? -1
            : 1
    );
    const ledger = emptyLedger(this.timezone);
    for (const s of stored) {
      const parsed: ParsedFile[] = [];
      for (const f of s.files) {
        if (f.csv) {
          parsed.push(...csvParsedFiles(f.name, f.sha256, f.text, f.csv, this.timezone).files);
          continue;
        }
        const r = parseCdrText(f.text);
        if (r.ok)
          parsed.push({
            name: f.name,
            sha256: f.sha256,
            ...(f.lastModified ? { lastModified: f.lastModified } : {}),
            payload: r.payload,
          });
      }
      await applyImport(ledger, s.record.id, parsed);
    }
    this.ledger = ledger;
    this.imports = stored.map((s) => s.record);
  }

  async importFiles(
    inputs: InputFile[],
    opts: { label?: string; now?: Date } = {}
  ): Promise<ImportRecord> {
    const now = opts.now ?? new Date();
    const id = newImportId(now);
    const { files, rejected } = await expand(inputs);
    const results: ImportFileResult[] = [...rejected];
    const parsed: ParsedFile[] = [];
    const stored: StoredFile[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });

    for (const f of files) {
      const sha256 = await sha256Hex(f.bytes as BufferSource);
      if (/\.csv$/i.test(f.name)) {
        results.push(
          rejectResult(
            f.name,
            sha256,
            'CSV files are read column by column: transactions on the Import screen, budget sheets on the Budget screen',
            true
          )
        );
        continue;
      }
      let text: string;
      try {
        text = decoder.decode(f.bytes);
      } catch {
        results.push(rejectResult(f.name, sha256, 'Not UTF-8 text'));
        continue;
      }
      const r = parseCdrText(text);
      if (!r.ok) {
        const res = rejectResult(f.name, sha256, r.message, r.skipped);
        res.kind = r.kind;
        results.push(res);
        continue;
      }
      const lastModified = f.lastModified ? new Date(f.lastModified).toISOString() : undefined;
      parsed.push({
        name: f.name,
        sha256,
        ...(lastModified ? { lastModified } : {}),
        payload: r.payload,
      });
      stored.push({ name: f.name, sha256, text, ...(lastModified ? { lastModified } : {}) });
    }

    const applied = await applyImport(this.ledger, id, parsed);
    results.push(...applied);
    const synthetic = parsed.length > 0 && parsed.every((p) => p.payload.synthetic);
    const record: ImportRecord = {
      id,
      at: now.toISOString(),
      label: opts.label ?? (inputs.length === 1 ? inputs[0]!.name : `${inputs.length} files`),
      synthetic,
      files: results,
      counts: sumCounts(results),
    };
    const kept = new Set(applied.filter((r) => r.status === 'imported').map((r) => r.sha256));
    const keptFiles = stored.filter((s) => kept.has(s.sha256));
    if (keptFiles.length) {
      await this.store.put({ record, files: keptFiles });
      this.imports.push(record);
    }
    return record;
  }

  /**
   * Import one bank or accounting CSV with a confirmed mapping spec (ADR
   * 0030). It goes through the same ledger as CDR files (FR-ING-004…008).
   */
  async importCsv(
    input: InputFile,
    spec: BankCsvSpec,
    opts: { label?: string; now?: Date } = {}
  ): Promise<ImportRecord> {
    const now = opts.now ?? new Date();
    const id = newImportId(now);
    const sha256 = await sha256Hex(input.bytes as BufferSource);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    } catch {
      throw new Error(`${input.name} is not UTF-8 text`);
    }
    const { files, rejected, message } = csvParsedFiles(
      input.name,
      sha256,
      text,
      spec,
      this.timezone
    );
    const applied = await applyImport(this.ledger, id, files);
    const main = applied.find((r) => r.sha256 === sha256)!;
    if (main.status === 'imported') {
      main.counts.rejected += rejected;
      if (message) main.message = message;
    }
    const synthetic = files[1]!.payload.synthetic;
    const record: ImportRecord = {
      id,
      at: now.toISOString(),
      label: opts.label ?? input.name,
      synthetic,
      files: [main],
      counts: sumCounts([main]),
    };
    if (main.status === 'imported') {
      const lastModified = input.lastModified
        ? new Date(input.lastModified).toISOString()
        : undefined;
      await this.store.put({
        record,
        files: [
          { name: input.name, sha256, text, csv: spec, ...(lastModified ? { lastModified } : {}) },
        ],
      });
      this.imports.push(record);
    }
    return record;
  }

  /** Undo an import as a unit (FR-ING-006). */
  async undo(importId: string): Promise<void> {
    await this.store.delete(importId);
    await this.load();
  }

  async clear(): Promise<void> {
    await this.store.clear();
    await this.load();
  }

  view(): LedgerView {
    return {
      timezone: this.timezone,
      accounts: [...this.ledger.accounts.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      txns: [...this.ledger.txns.values()].sort((a, b) =>
        a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1
      ),
      balances: [...this.ledger.balances.values()].sort(
        (a, b) => Date.parse(a.asAt) - Date.parse(b.asAt)
      ),
      reconciliation: reconcile(this.ledger),
      imports: [...this.imports],
    };
  }

  /** The ledger itself, for tests and later milestones. */
  get current(): Ledger {
    return this.ledger;
  }
}
