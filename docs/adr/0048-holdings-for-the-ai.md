# ADR 0048 — The AI sees each holding and every return model, and can propose one

- Status: accepted
- Date: 2026-10-23
- SPEC: §13.3 (advisor tools), FR-API-003, NFR-HON-002
- Builds on: ADR 0012 (the freedom simulation), ADR 0021 (the advisor), ADR 0026 (setup cards)

## Context

Asked "how could we factor Bitcoin into our assets and freedom number?", the AI said Crux had no
asset class for crypto and suggested adding Bitcoin to shares at a discount, or raising the shares'
volatility. Both were wrong. The plan has a Bitcoin kind (`btc`) with two fat-tailed return models,
and each holding is simulated with its own model. The AI couldn't know:

- `get_plan` gave totals by kind only;
- `explain_assumption` listed only the models in use;
- no tool could add or change a holding.

## Decision

1. **`get_plan` lists each holding** by number, kind, rounded value, return model and lock date.
   It never gives a holding's name, which may carry an account's name (FR-API-003). It also lists
   every return model the plan offers, by id and label, and keeps the totals by kind.
2. **`explain_assumption("returns")`** names the models in use and every model on offer. A price
   history imported in Settings becomes another.
3. **`propose_holding`** offers a card to add, change or remove one holding: kind, value, model
   and name. It goes through `changeHolding` (pure), which keeps the plan consistent:
   - a new holding joins the sell order by kind (Bitcoin after shares, before super);
   - a removed one leaves the sell order, new savings and `hold`;
   - a model the plan lacks gives way to the kind's default.

   The card is a plan change with Undo, like a plan check's fix (ADR 0026).

4. **The system prompt** says holdings are individual, and that Bitcoin is its own kind, never
   folded into shares.

## Consequences

- "Factor in my Bitcoin" is answered with the plan's own Bitcoin models and a card, not a
  workaround.
- The freedom screen's kinds and the AI's come from one list (`CLASS_LABELS`).
- Wider portfolio work (positions with units and prices, market data, property with rent and
  loans) is a separate decision.
