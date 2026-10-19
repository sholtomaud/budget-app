# ADR 0044 — Super locked until preservation age from the profile; the bridge outside super

- Status: accepted
- Date: 2026-10-19
- SPEC: §11.3 FR-GOAL-023 (new), FR-GOAL-020, NFR-HON-001
- Builds on: ADR 0012 (the freedom simulation), ADR 0043 (the profile)

## Context

Someone with super available in about seven years asked why the plan needed about $1.6 million.
Their reasoning: super keeps growing until it unlocks and then pays for the last 20 or so years,
so savings outside super only have to last until about 60. That is roughly $50k of Secure
spending a year for 7–10 years, about $500k. What were they missing?

The code showed two things:

1. **Super was never locked by default.** The simulation honours a holding's `accessibleFrom`
   date (it draws nothing from a holding before it), but the only way to set it was the "locked
   until" field on the Freedom screen. The profile knew the person's age, and the tax table knew
   the preservation age (60), but nothing joined them. So unless the person typed a date, super
   was spendable from the first month of freedom: optimistic, and not the plan they described.
2. **The freedom number is everything, super included.** The number at the target scales all of
   today's holdings, super too, by one factor until the plan reaches the target. It must fund all
   of freedom (31 years here), not just the years until super unlocks. It isn't the "outside
   super" figure the person was estimating, and the screen didn't say so.

## Decision

1. **Super locks from the profile.** With an age on the Profile screen, each super holding the
   person hasn't dated by hand is locked until its owner (the partner for `p2`, the person
   otherwise) reaches the tax table's preservation age. The age is in whole years, so the date can
   be up to a year late, never early. The holding is marked `lockedBy: 'profile'`. It follows the
   age and clears once the age is past preservation; a date typed on the Freedom screen replaces
   it and stays. Applied when the profile is saved and when the Freedom screen opens, the same way
   as the years of freedom (ADR 0043).
2. **The bridge.** When super is locked past the freedom date, the full run also finds the
   smallest capital outside super (bank plus holdings spendable at the start) that reaches the
   target, with super at today's value. Super grows while locked and is drawn once it unlocks. The
   same bisection and common random numbers as the freedom number; only the spendable holdings are
   scaled. The Freedom screen, the chat's full run, and the run facts the AI gets all show it
   next to the total, and say which is which.

## Consequences

- The plan now matches how super works, and the number people reason about ("how much do I need
  outside super?") is on the screen. It is usually well above years-to-60 × yearly spending: it
  must also cover the futures where returns are poor or spending runs high, and super has to last
  from 60 to the end of the plan on its own.
- Super is counted at today's value at the freedom date, not grown to it: a little conservative
  when freedom is some years away.
- **The run facts carry super's unlock date**, so the AI can explain the bridge. With the freedom
  date, it implies the person's age to within a year. Like the years of freedom (ADR 0043), it is
  part of the plan, not the profile; the profile itself is still never sent.
- The full run does one more bisection (about 12 runs of 200 futures) when super is locked.
