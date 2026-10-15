# ADR 0041 — Schedules: run while open, catch up once, the AI only when allowed

- Status: accepted
- Date: 2026-10-15
- SPEC: §12 (Schedules), §12.2 FR-SCHED-001…003 (new), §13 (egress), NFR-PRIV-003
- Builds on: ADR 0021 (providers and the egress gate), ADR 0023 (the chat panel, cards), ADR 0038
  (the budget review)

## Context

People want Crux to do things on a schedule: check the budget each morning, run the plan each week,
a weekly review from the AI, reminders. Set by hand on a screen, or by asking the AI. Crux is a
static web app with no server; the API key lives in memory only (ADR 0021).

## Decision

1. **Run while open; catch up once.** A page can't run when it's closed (periodic background sync
   is Chrome-only, needs an installed app and runs at the browser's whim). The runner checks a few
   seconds after the app opens and every minute after; a schedule due since it last ran (or since
   it was made) runs once, however many times were missed. One runs per check, since the chat
   answers one thing at a time; if the chat is busy, it waits for the next check.
2. **A schedule asks the chat.** Its action is a question the chat already answers ("Review my
   budget", "Run my plan", "Where does my money go?", a review prompt for the AI) or a reminder
   shown as a note. The question is labelled `Scheduled · <name>`, so the person sees what ran.
   It never changes data; proposals stay cards (ADR 0023).
3. **The AI only when allowed.** A switch, off by default, lets schedules call the AI on their
   own. Off: AI schedules are skipped and say so. On: the run holds a standing consent
   (`withStandingConsent`) so its calls skip the consent dialog; they are redacted as always and
   logged with `scheduled: true`, shown as "(scheduled)" in the call log. No key in the session
   (after a reload) skips them, saying why; a local model needs none.
4. **Set by hand or by the AI.** The Schedules screen adds (from a form or ready-made presets),
   edits, pauses, runs now and deletes; it shows the next and last run and what happened. The AI
   gets `list_schedules` and `propose_schedule` (add, change or remove, as a card to save). It can't
   change the switch.
5. **Kept in the vault** (`schedules`: the list, the switch, notifications): encrypted, exported,
   removed by delete-all. Optional system notifications when a schedule runs in the background.

## Consequences

- Schedules are as private and as honest as the rest of the app: a schedule does exactly what the
  person could do by asking, and shows it.
- They don't run with the app closed. That is said on the screen and in the guide.
- The standing consent is held for the length of a scheduled run; a question the person types in
  the same seconds would share it. Accepted: the switch is the person's, and every call is logged.
- **Tests:** unit tests for when a schedule falls due (day, week, month, local time), catching up
  once, the checks and words, presets, and that the AI can't reach the switch; e2e for a preset run
  now with its result kept, a reminder from the form, pause and delete over a reload, an AI schedule
  skipped while off and run without a dialog when on (logged as scheduled), a missed time running
  on its own (with a fast-forwarded clock), and the AI proposing a schedule as a card.
