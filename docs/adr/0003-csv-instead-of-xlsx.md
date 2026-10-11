# ADR 0003 — Budget workbooks are imported as CSV, not xlsx

- Status: accepted
- Date: 2026-10-11
- SPEC: amended to match in Draft 2
- Deviates from: SPEC §6.2 (FR-ING-010…014), §7.1 (`workbook.xlsx`), §14 NFR-SEC-002, §15.1 (SheetJS), §16.4

## Context

SPEC §6.2 parses `.xlsx` workbooks in the browser with SheetJS. SheetJS community edition is
distributed from its own CDN, not npm (the npm `xlsx` package is a stale 0.18.5). The project
owner decided not to use xlsx at all.

## Decision

- The workbook importer accepts **CSV**: one CSV per sheet (OPEX budget, CAPEX register, wish
  list, renewals, goal), exported by the user from their spreadsheet. The mapping wizard and
  presets in §6.2 apply per CSV file. FR-ING-011 becomes trivial, because CSV holds values, not
  formulas. Error literals (`#DIV/0!`, `#REF!`) are still reported and skipped.
- FR-ING-013 provenance becomes `source: { file, row }`.
- The synthetic generator (§7.1) emits `workbook/<sheet>.csv` instead of `workbook.xlsx`.
- Data hygiene (§16.4): `.xlsx`/`.xls` are git-ignored and rejected everywhere. CSV is
  git-ignored outside `fixtures/`, and every fixture CSV must start with a `# x-synthetic: …`
  line.
- No SheetJS dependency.

## Consequences

Users export each sheet to CSV before importing. Totals-line checks (FR-ING-014) compare against
the totals row of the exported CSV.
