# ADR 0039 — Dashboard templates: a file that holds the layout, never the data

- Status: accepted
- Date: 2026-10-15
- SPEC: FR-VIZ-010 (new), NFR-PRIV-003, ADR 0007 (no backend)
- Builds on: ADR 0028 (chart specs), ADR 0036 (dashboards), ADR 0037 (the AI lays them out)

## Context

A dashboard someone has worked out ("Monthly check-in", "Freedom at a glance") is useful to others,
and to the same person on another device. Crux has no server, so sharing has to be a file; and the
file must not carry anything about the household it came from.

## Decision

1. **The file** (`schemas/dashboard-template.schema.json`, `src/viz/template.ts`): a kind and
   version, the name, and the charts in order, each a built-in chart's id or a chart spec, and
   whether it is wide. No ids. A saved chart becomes its spec, because the saved chart won't
   exist elsewhere; one that was deleted is left out, and the export says so. Specs carry no
   values (ADR 0028), so the file can't either.
2. **Read before sharing.** Export shows everything in the file that someone wrote: the name,
   chart titles and captions, series labels, and words a chart looks for in transactions (a
   merchant's name can say something personal). Then **Download template** saves
   `<name>.crux-dashboard.json`.
3. **Import** reads a file (at most 200 kB, refused before parsing if larger), checks the kind,
   the schema (so nothing else, such as values, can ride along), that every built-in exists in
   this version, and every chart through `checkSpec`. A file that fails is refused in words and
   nothing is added. One that passes becomes a new dashboard with new ids, named "(imported)"
   when the name is taken, and opens drawn from this household's data.
4. **No gallery yet.** A shared, hosted collection of templates would need a server. Files cover
   sharing between people and devices without one.

## Consequences

- A template shares a way of looking at money, not the money.
- Category filters name the app's standard categories; a chart filtered on a category another
  household doesn't use draws with a note that nothing matches, as it would anywhere.
- **Tests:** unit tests for the schema file, export (built-ins, saved charts to specs, deleted ones
  counted, no ids), the words shown, the round trip and every refusal (not JSON, not a template,
  another version, values in a chart, an unknown built-in, a chart that can't be drawn, too big);
  e2e for export with its preview, the downloaded file, import into a new dashboard, and a refused
  file.
