# ADR 0005 — What GSSK's conservation error measures, and how FR-SIM-003 is checked

- Status: accepted (M0 finding; to revisit in M5)
- Date: 2026-10-11
- SPEC: amended to match in Draft 2
- Refines: FR-SIM-003; proposes KR-6

## Finding

In GSSK 5.3.0, `GSSK_GetCarrierConservationError(inst, c)` is the **relative change in the total
storage** of carrier `c` over the last step (`gssk.h`). For a closed model it measures numerical
leakage and sits at machine precision. For an **open** model (one with sources or sinks) it
measures net inflow or outflow. A kernel test confirms this exactly: wages 8200 in and spending
6100 out on 262000 of storage gives 2100/262000.

The freedom model (§11.1) is open by construction: wages, market gains and income are sources;
OPEX, CAPEX, tax and market losses are sinks. So "|conservation error| ≤ 1e-9 at every step",
read literally, would fail every valid run.

## Decision

- M0 tests FR-SIM-003 on a closed money model (≤ 1e-9 at every step), and pins the open-model
  semantics with a separate test.
- M5 implements FR-SIM-003 as an app-side **balance check**: per step,
  `ΔΣ storage(money) − Σ boundary flows × dt` must be within 1e-9 of zero, with boundary flows
  read through `GSSK_GetFlows` (sources → storages, storages → sinks). Before relying on it, M5
  must confirm which RK4 stage `GSSK_GetFlows` reports for state-dependent edges. If the stage
  makes the check inexact, the fallback closes the model: sources and sinks become storages
  that start at 0, so the plain conservation error applies.
- The kernel-check screen labels the household model's figures as net flow, not leakage.

## Proposed kernel request

**KR-6**: a per-carrier boundary-flux accessor (cumulative or per-step inflow and outflow
across sources and sinks, consistent with the integrator's stages), so open-system conservation
can be checked inside the kernel.

## Related M0 finding

GSSK 5.3.0 rejects a `sink` node without `value` (`GSSK_ERR_SCHEMA_VIOLATION`). SPEC Appendix B
omits it, so `modelgen` must emit `"value": 0` for sinks.
