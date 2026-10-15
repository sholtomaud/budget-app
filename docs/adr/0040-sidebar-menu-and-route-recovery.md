# ADR 0040 — One menu on the left; a screen that can't load never leaves a dead click

- Status: accepted
- Date: 2026-10-15
- SPEC: §12 (the menu), NFR-STO-005 (offline)
- Builds on: ADR 0001 (web components), ADR 0023 (the chat panel), ADR 0027 (the chat screen)

## Context

Two reports from using the deployed app:

1. **"The page couldn't change when I clicked a tab."** Screens are loaded on demand, each from
   its own file with a content hash in its name. After a deploy, a page loaded earlier still asks
   for the old file names; the new service worker has already deleted the old cache and the
   server no longer has them. The router awaited the import, the import failed, the error went
   unhandled, and the click did nothing. Separately, two quick clicks could finish out of order,
   the slower screen replacing the newer one.
2. **"The hamburger menu isn't quite right for all the pages."** Every screen had a top bar of
   tabs that scrolled sideways on narrow screens, except the chat screen, which hid it and showed
   its own left menu with a Menu button on phones. Twelve screens no longer fit a bar.

## Decision

1. **Routing.** Each render takes a number; a render that finishes after a newer one has started
   draws nothing. When a screen's code fails to load, the router reloads the page once onto that
   screen (a session flag stops a loop), which fetches the new version; if it fails again, the
   screen says it couldn't open, why that usually is, and offers Reload. Other screens keep
   working.
2. **One menu, on the left, on every screen** (`app-nav`): an icon and a name per screen, the
   brand at the top, Chat and the theme at the foot.
   - **Pinned** (the default): wide, with names; the page sits beside it.
   - **Unpinned:** a rail of icons; hovering it, or tabbing into it, opens it over the page with
     names. Links keep their names for screen readers either way.
   - The choice is remembered on the device (`localStorage`, a layout preference, not data).
   - **Phones:** a bar with a Menu button opens the menu as a drawer over a dimmed page; choosing
     a screen, Escape or a tap outside closes it.
3. **The chat screen** keeps its setup steps beside the conversation (behind a Steps button on
   phones) and no longer has its own copy of the screen links or the theme button.
4. Icons are in-house single-path SVGs (`src/app/icons.ts`, ADR 0007).

## Consequences

- A deploy no longer strands an open tab; at worst the page reloads once.
- The same menu everywhere, room for more screens (Schedules is next), and a compact rail for
  people who want the space.
- **Tests:** e2e for a screen whose file 404s (the error screen, other screens still open), the
  rail and its hover, remembered over a reload, the phone drawer and its closing; the chat-screen
  tests now find the screens in the shared menu.
