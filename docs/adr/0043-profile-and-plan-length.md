# ADR 0043 — A profile without personal data sets how long the plan runs; a shorter Freedom form

- Status: accepted
- Date: 2026-10-15
- SPEC: §11.3 FR-GOAL-020…022 (new), §12 (Profile, Freedom), NFR-PRIV-002, NFR-PRIV-003,
  NFR-HON-001
- Builds on: ADR 0012 (the freedom simulation), ADR 0031 (earliest freedom)

## Context

"Years of freedom" was a bare number on the Freedom screen. People don't know it; what they know is
roughly how old they are. The plan should last as long as they are likely to live, plus a margin,
and the years left to work follow from that. People also asked for the country to be detected
from their IP address so they need not enter it, and for less on the Freedom screen.

## Decision

1. **A profile, not personal data.** A Profile screen keeps an age in whole years and the date it
   was given (it moves on by itself), never a date of birth; a country; a sex for the life table
   only if the person gives one (otherwise the average of both); and, optionally, a partner's age.
   It lives in the vault with everything else, and is never sent to an AI provider: the advisor's
   tools don't read it (a unit test checks), so the chat can't talk about the person's age. Only
   the plan's years of freedom, which it sets, are part of the plan the advisor sees.
2. **The country from the device, not the network.** An IP lookup would send the person's address to
   a third party, which NFR-PRIV-003 forbids. The device's time zone (`Australia/Sydney` → AU), else
   its language region (`en-NZ` → NZ), gives the same answer offline. The screen says where it came
   from and that nothing was looked up, and the person can change it.
3. **A life table with sources, and a curve for the spread.** `data-tables/life-expectancy.json`
   holds life expectancy at birth by sex for the countries whose figures we could check, with each
   source and year; a country not listed takes the person's own figures. A mean alone can't say how
   long to plan for: half of people outlive it. A Gompertz curve with a dispersion of 10 years
   (assumed, typical of long-lived countries) is fitted to each figure, giving survival from the
   person's present age. The plan runs to the age that 1 in 4 people that age live past
   (suggested), or 1 in 2, or 1 in 10. For a couple it runs until the last of them. Labelled
   `assumed`, with its source.
4. **Freedom follows.** Unless the person switches it off, the plan's years of freedom are the
   plan-to age less their age when freedom starts, and change when the start date does; the field
   is read-only and says where the number comes from. The Profile screen shows the timeline: age
   now, when freedom starts and at what age, years left to work, years to fund.
5. **A shorter Freedom form.** The form shows tier, freedom date, years of freedom, take-home pay and
   paid work until. Floor, target, project income, spending levers, salaries, cash buffer,
   withdrawal strategy, tax and return uncertainty sit under More settings.

## Consequences

- The plan's length has a reason a person can check, and the hardest number on the Freedom screen
  is no longer theirs to guess.
- The table is short. Countries are added with a sourced figure in a PR; until then, own figures.
- The curve assumes most deaths come at old ages. Where many people die young (South Africa, life
  expectancy at birth in the 60s), a curve fitted to the figure at birth sets the planning age for
  a 40-year-old several years too early, the dangerous direction. Such countries are left out of
  the table until the model takes life expectancy at the person's age, not at birth.
- A Gompertz curve ignores deaths in youth and the flattening of mortality at very old ages; both
  move the planning age by well under a year from 40 on, against a margin of several years.
