# ADR 0018 — Monetisation, offers and the agentic layer

- Status: proposed (milestone M15, behind a legal review gate)
- Date: 2026-10-11
- SPEC: §1.1, §2 (NFR-MON-001…007), §22 (FR-OFR-…, FR-AGT-…), §20

## Context

The app learns things about a household that are valuable to sellers, and calibrated, not guessed:

- **when** a laptop is due (Weibull replacement windows, ADR 0010);
- **what it can afford** (budget headroom per tier);
- **what it wants** (the wish list);
- **what a purchase does to its freedom** (ΔpSuccess, ADR 0012).

With the Bayesian workflow (ADR 0015) these become posterior purchase probabilities with honest
uncertainty. This is exactly the advertiser's question: "what does this person want, when, and
which offer will land?" Real-time generative imagery makes creative personalisation cheap.

The obvious way to monetise that, selling or sharing user profiles with advertisers, would break
the app's founding promise (NFR-PRIV-001…003). It would also run into law:

- The **CDR Rules** restrict how CDR data may be used and disclosed. Selling it, using it for
  direct marketing, and disclosing de-identified data are all narrowly limited and
  consent-dependent.
- The **Privacy Act** (APP 7, direct marketing) applies.
- Steering users to **financial products** is financial product advice. It needs an AFSL (or a
  credit licence for loans), and conflicted remuneration is banned for personal advice to retail
  clients.

Those points are to be confirmed by legal review; the direction is clear.

## Decision

Capture the value **without the data leaving the device**: the user is the customer, and the
user's agent is the user's. Paths, in the order we would build them:

1. **User-paid (first; no data use).**
   - The core stays free and open.
   - A subscription covers hosted conveniences: sync relay and storage options (ADR 0016), the
     receipts app (ADR 0017), the live bank connector pass-through (M14), and hosted advisor
     credits (users can still bring their own key).
   - B2B: licensed financial planners running client scenarios, and employers offering it as a
     financial-wellbeing benefit.
2. **Private offers: relevance computed on the device** (M15, FR-OFR-001…008).
   - Retailers publish offers to a public, signed **offers feed**: product, price, validity,
     category and "intent" tags such as `capex.computing`, `replacement`, `wish:watch`, plus their
     bid per conversion.
   - Every device downloads the same feed, or the same coarse regional shard. Fetching it reveals
     nothing about the user.
   - Matching and ranking happen locally, against the wish list, open replacement windows, budget
     headroom and the freedom impact.
   - **Ranking is by user benefit:** expected saving × probability the user needs it soon, with
     the effect on pSuccess shown. Bids only break ties and set the order among equal-benefit
     offers.
   - Every placement says **Sponsored** and who paid.
   - Measurement uses the affiliate or coupon link the user chooses to follow, plus
     privacy-preserving aggregate counts: k-anonymous, differentially private, opt-in.
   - Personalised creative is generated from the _offer_ and a style the device picks. User
     attributes never go to an image service. AI-generated imagery is labelled.
3. **An intent marketplace: reverse offers, opt-in per want** (FR-OFR-009…011).
   - The user publishes a specific, anonymous, expiring want ("laptop, A$2–3k, within 3 months,
     Sydney"). It goes through a relay to subscribed retailers, who answer with offers.
   - The user's agent compares them and the user picks. Retailers pay per qualified offer or per
     sale.
   - The want is authored by the user, minimal and revocable: the opposite of profile harvesting.
4. **The agentic layer: the user's agent acts on mandates** (FR-AGT-001…008).
   - **Price watch and buy-within-mandate** for planned CAPEX: "buy this laptop if ≤ A$2 400
     before March". The agent negotiates with merchant agents (MCP or agent-to-agent protocols) and
     checks out through the merchant's own checkout. The user approves, unless the mandate is
     pre-approved with a spend cap.
   - **Selective disclosure:** a merchant agent may ask "would you buy X at Y?". The user's agent
     answers yes, no or a counter-offer from local data, without revealing that data.
   - **Bill switching** (energy, mobile, insurance) with referral fees. Credit and insurance
     referrals only once licensing is resolved (NFR-MON-005).
   - Agents never get write access to bank accounts (§1.1). Payments happen in the merchant's
     checkout under the user's mandate.
   - Revenue: affiliate commission or a success fee on purchases the user approved, disclosed in
     the mandate.
5. **Aggregate insights (last, maybe never).**
   - Retailers and advertisers would value anonymised demand signals: category spend trends,
     CAPEX cycles, freedom-number distributions.
   - Only as an **opt-in data cooperative**: differential privacy, k-anonymity thresholds, no
     CDR-derived data unless the CDR rules and the user's consent permit it, and revenue shared
     back with contributing users ("data dividend").
   - Not built until 1–4 prove out and legal review approves it.

## Amendment (2026-10-11): broker model, revenue share, certification, mission

Accepted direction from the project owner:

- **The app is a broker or matchmaker.** Value comes from matching on the device. Partners pay for
  relevance and timing, and never receive the data.
- **Users share the revenue** (§22.2a, FR-RWD), as Brave does with ad revenue:
  - **Rewards never reward spending.** They accrue for evaluating offers, answering intents or
    contributing to the co-op, never for buying. Otherwise the revenue share would pull users
    against the mission.
  - Payout is in money or straight into a savings goal. No speculative tokens.
  - Co-op members also receive a dividend from the co-op's aggregates.
- **Partner certification** (§22.2b, FR-PTN):
  - verified identity, and a binding charter;
  - signed feed entries, with revocation;
  - automated and human offer review;
  - user reports;
  - a published transparency report and an annual independent audit.
- **The mission is the first principle** (NFR-MISSION-001, AGENTS.md non-negotiable 0). The app is
  a cybernetic controller whose purpose is to move people out of financial stress. The guardrails
  below are the mission applied to commerce, and no revenue argument overrides them.

## Guardrails (NFR-MON-001…007)

1. **No sale or sharing of personal, transaction or CDR data.** No profile leaves the device.
2. **Relevance is computed on the device.** Feeds are the same for everyone in a coarse shard.
3. **Ranking by user benefit.** Paid placement is always disclosed. The advisor's figures and
   recommendations are never influenced by payment, and the advisor cannot see bids.
4. **No targeting on vulnerability.** Shortfall, debt, gambling or hardship signals are excluded
   from offer matching. Credit, buy-now-pay-later and gambling offers are not carried.
5. **No financial product recommendations or referrals** until licensing (AFSL or credit licence;
   general vs personal advice; conflicted remuneration) has been reviewed and resolved.
6. **Off by default.** The app is complete without monetisation features. The privacy e2e test
   asserts that offer matching sends nothing.
7. **Legal review gate before M15**:
   - Privacy Act and the APPs;
   - CDR Rules (use, disclosure, de-identification, direct marketing);
   - the Spam Act;
   - the Australian Consumer Law (misleading conduct, AI-generated creative, "sponsored" disclosure);
   - financial services and credit licensing;
   - GDPR if offered in the EU.

## Why this captures more value, not less

Advertisers pay for conversions, and conversions come from relevance and timing: exactly what the
device knows and a data broker doesn't. A placement that fits an open replacement window and the
user's budget, ranked honestly, converts better than a profile-targeted banner. Users who trust the
app keep it. Trust is the asset, and on-device matching keeps it.

## Consequences

- Retailers integrate through a public offers API (feed publishing, conversion postbacks, intent
  responses). They never receive user data.
- New components, all without user data at rest: a feed CDN, an intent relay, and an aggregate
  reporting endpoint.
- §1.1 non-goals are revised: still no financial advice, no account write access and no sale of
  data. Opt-in commerce features become allowed.
