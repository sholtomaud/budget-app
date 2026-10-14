# ADR 0036 — Dashboards: named layouts of charts, by dragging or with buttons

- Status: accepted
- Date: 2026-10-15
- SPEC: §12 (Dashboards), FR-VIZ-008 (new), NFR-PRIV-003, NFR-HON-001
- Builds on: ADR 0028 (charts in the chat, saved charts), ADR 0035 (chart encodings)

## Context

Saved charts are a list of snapshots, each as it was when saved. People want the charts they look at
most on one page, arranged their way, current, and several such pages ("Monthly check-in",
"Freedom", "Big purchases"). Later they want the AI to build one ("I need a dashboard that shows…")
and to share a layout with other Crux users as a template.

## Decision

1. **A dashboard is a named list of tiles** (`src/viz/dashboard.ts`), at most 12. A tile names its
   chart, never its values: a **built-in** chart by id (`src/viz/library.ts`, so it improves with
   the app), a **saved** chart by id (its spec; a deleted one says so), or a **chart spec**. A tile
   is one column or wide (the whole row). Changes are pure functions (add at a position, move,
   widen, remove, rename, duplicate) that return a new dashboard.
2. **Always today's data.** Each tile is built with `buildChart` from the current data and redrawn
   when the data changes; a chart that can't be drawn says why in its place (no run yet, nothing
   matches). Saved charts keep their snapshots on the Saved charts screen.
3. **The Dashboards screen**: a list of charts on the left (built-in and saved, as thumbnails), the
   dashboard on the right in one or two columns. Drag a thumbnail onto a tile to put it before that
   tile, or onto the end slot; drag a tile to move it. **Every drag has a button**: Add on each
   thumbnail; Earlier, Later, Wide and Remove on each tile; HTML drag and drop works neither with a
   keyboard nor on most phones. On a phone the dashboard comes first and the list follows.
4. **Named dashboards**: new, rename, duplicate, delete (asked once more, in the page), switch. A
   first visit makes an **Overview** dashboard. The open one is remembered.
5. **Kept in the vault** under `dashboards`: encrypted, in exports, removed by delete-all.
6. **Ready for the AI and templates.** `DASHBOARD_SCHEMA` and `checkDashboard` check a dashboard
   from outside the app: the schema (no values can be carried), known built-ins, and every chart
   spec through `checkSpec`. The next steps use them: AI tools to create and change dashboards
   (shown as a proposal to accept), then export and import of a dashboard as a template file.
   Because a dashboard holds specs and ids only, a template shares nothing about the household.

## Consequences

- Dashboards are as private as the rest of the data, and as honest: every value is the app's.
- A saved chart on a dashboard is drawn from today's data, not its snapshot; that is the point of a
  dashboard, and the Saved charts screen still shows the snapshot.
- A template's saved-chart tiles won't resolve in another household; templates will carry specs.
- `ensureLoaded()` can return the data as first loaded; the screen (and Saved charts' "today's
  data") now read the store's current view, so a chart drawn just after an import is current.
- **Tests:** unit tests for the built-ins, every change, names, copies, the starter and the checks
  (unknown built-ins, invalid specs, values refused); e2e for dragging from the list and between
  tiles, every button, naming, switching, deleting, and keeping it all over a reload.
