# BUILD_LOG.md

Append-only log of build steps. Spec lives in PROJECT_CONTEXT.md — never edited from here.

## 2026-10-02 — Features step: fixes from the features review (Section 4.6)

**Files** — new `engine\sql\features_alloc.sql`; rewritten `engine\sql\features.sql`, `engine\features.py`, `audits\check_features.py`; edited `engine\config.yaml`. `features` is now 30 columns / 24,873 rows.

**Key functions** (`features.py`): `active_profile` · `sql_params` (validates every cut-off is an int before interpolation) · `split_sections` (splits the `-- @@INIT/ROUND/SETTLE/AUDIT` markers) · `allocate` (round loop + invariant audit) · `main` (`--db`, default `data\case.duckdb`).

**Allocation** — rewritten to 4.6: each outflow takes the earliest in-window inflow with room for it; a full inflow is skipped and the outflow re-offered, never dropped. Applied set-based in rounds (loop over rounds, never rows). `@@AUDIT` aborts the build on double-allocation, overdrawn inflow, or a still-placeable outflow.

**Definitions fixed** — `median_hold_hours` NULL when the account never forwards (no imputed `max(ts)`); `device_consistency` = spec boolean, 1 only if one device family AND no foreign/reserved IP; `recurring_sender_share` = senders on ≥3 distinct **days**; `split_count_median` = `count(DISTINCT to_acct)` per inflow. Added `burst_fan_in`, `ip_churn`.

**New config/profile keys** — `feature_rules.victim_like_max_outflows` (3), `.recurring_min_days` (3), `.odd_hour_from` (1), `.odd_hour_to` (5), `.round_unit_paise` (100000), `.max_alloc_rounds` (25); `reliability_gates[].id = gate_reciprocity` (opens `> 0.05`, measured 0.0, closed, gates `[T2, MP6]`). Weights: T1 25→35, T2 20→0 + `enabled: false`, T5 15→25 (sum 100); MP6 rule → `full if is_send_only or is_receive_only, else 0`.

**Verification** — alloc 0.46 s (472,980 candidates → 216,301 allocated, 3 rounds, **+433 re-offered in round 2**, audit all zeros) + SQL 2.06 s = **2.96 s total**. `check_features.py`: **14 passed, 0 failed**. Group A 0.98 commission / 3–6 distinct receivers / 9.0 min lag; group B 0.96 / 1 / 16.8 min. Group-B accounts under 0.9 pass-through: **2 of 559** (was 5). All 19 NULL columns are not-applicable cases; script flags any other NULL.

**Not done / deviations**
- 2 group-B accounts (22448 → 0.5457, 12426 → 0.6842) stay low: greedy earliest-first mis-pairs two inflows overlapping one window, so one outflow finds no inflow with room. Rule-as-specified, not a bug; an amount-aware tie-break would fix both.
- `measure_before_burst: true` still unapplied — trust features are lifetime totals (documented limitation, 4.6).
- Re-seeded the **locked** `v1-verified` in place as instructed; the context's own rule says a change should mint a new `profile_id`.
- `in_cycle` NULL (TODO graph.py). `pass_through_share` now NULL (was 0.0) for send-only, per 4.6.
- Unreachable on this dataset: **T6** (max `recurring_sender_share` 0.0411, 0 accounts ≥ 0.30) and `amount_diversity`'s T4 clause (min 0.9655, all 24,873 pass). **T7** = 1 only for the 300 send-only accounts.
