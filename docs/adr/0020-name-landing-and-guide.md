# ADR 0020 — The name Crux, a landing page, and a getting-started guide

- Status: accepted
- Date: 2026-10-11
- SPEC: §12 (screens) amended

## Context

User feedback: technical users manage, but newcomers find the app hard to start. The name
`budget-app` says nothing, the Start screen opened with jargon ("freedom capital", "CAPEX",
"synthetic", "kernel"), and nothing said which screen to visit next.

## Decisions

1. **The product is called Crux**, chosen by the project owner, for "the crux of the matter". It
   also fits an Australian app: Crux is the constellation of the Southern Cross, which people
   navigate by. That suits steering towards freedom (NFR-MISSION-001).
   - User-facing text only: the title, the menu, the docs and the export file name
     (`crux-YYYY-MM-DD.budgetapp`).
   - The repository, package, IndexedDB database, storage keys and the `.budgetapp` format keep
     `budget-app`, so existing data and exports keep working.
   - A trademark and domain check is needed before a public launch.
2. **The Start screen is a landing page**, in short plain sentences:
   - one line of what Crux does, and one paragraph of how;
   - two clear starts: _Try it with a sample household_ or _Use my own data_;
   - four "what Crux does" points and four "how it works" steps;
   - the privacy promise in plain words.

   Sample households get friendly names. The seed moves under "Advanced". When data exists, a
   "Welcome back" card shows the next step.

3. **A getting-started guide** sits under the menu on every screen. It has seven steps in the
   order a newcomer needs them: add data, check transactions, compare with the budget, plan big
   purchases, see the forecast, find the freedom number, compare plans.
   - On a step's screen it explains that screen in one sentence and offers **Next**. Elsewhere it
     points to the next unfinished step.
   - A step is done when there is data and its screen has been opened.
   - The guide hides when finished, or on request, and can be restarted from Start or Settings.
   - Progress lives in `localStorage` (UX state, not financial data), and delete-all clears it.
4. **Plain menu names:**
   - Ledger → **Transactions**;
   - CAPEX → **Big purchases**;
   - the technical Kernel check → **Engine check**, out of the menu and linked from Settings and
     Start.

   Routes are unchanged, so links and bookmarks keep working.

## Not done here

A plain-language pass inside each screen: tab names such as "CAPEX proposals", kind labels such as
"OPEX", and the forecast method names. It follows as its own change, screen by screen.
