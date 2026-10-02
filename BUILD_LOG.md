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

## 2026-10-02 — Step 3 features: episode rule, order audit, T3/T6 gates (Section 4.6)

**Files** — new `engine\sql\features_episode.sql` (replaces the deleted `features_alloc.sql`); edited `engine\sql\features.sql` (sections (b) flow and the hold CTE), `engine\features.py`, `engine\config.yaml`. `features` unchanged at 30 columns / 24,873 rows.

**Episode rule** — nothing is paired any more. Inflows whose forwarding windows (`windows.single_forward_max_minutes`, 3600 s) overlap form one **episode**; every outflow in the episode window counts against the episode's inflow TOTAL. Key names: temp tables `ep_inflow` / `ep_window` / `ep_out`; CTEs `ep_fwd` / `ep_flow` / `flow` / `inflow_hold`; `features.py: build_episodes` (replaces `allocate`). Built with one gaps-and-islands pass plus one ASOF join — **no Python loop at all** (the round loop is gone). `@@AUDIT` aborts on an outflow in two episodes, a lag outside the window, an inflow not in exactly one episode, or overlapping episodes: all four zero.
Removed the `valid` window filter in `features.sql` — that filter (split lag must be 3–15 min) was precisely what dropped out-of-order forwards. Split vs single is now a scoring question, as 4.6 intends.

**tx_key order** — audited every `ORDER BY` / window / `row_number` in `engine\` and `audits\`. Only one tie-break survives in the pipeline: `out_gaps ... ORDER BY ts_sec, tx_key` in `features.sql`. Proved harmless two ways: reversing the tie-break changes **0 of 24,020** `timing_regularity` values, and rebuilding all 30 columns from a randomly shuffled copy of `tx` differs only in `timing_regularity`, 27 accounts, max **3.3e-16** (float64 accumulation order in `stddev_samp`, not row order; ZP4 is weight 0 anyway). `ingest.py` uses tx_key only to define itself and to order the `rejects` listing. Note `audits\victim_chains.py:954` tie-breaks a *displayed* demo path on `out_tx_key` — read-only, not in the pipeline, left alone.

**Gates** — added `gate_balance_retention` (T3, `normal_population_median_hold_hours`, opens ≥ 6 h, **measured 0.5182**, p90 0.6833, max 1.0485, 0 accounts ≥ 24 h) and `gate_recurring_inflows` (T6, opens ≥ 0.05, **measured 0.0**, max 0.0411, 0 accounts ≥ 0.30), both measured on the 23,500 structurally-normal accounts, both **closed**. T3 and T6 → weight 0 / `enabled: false`. Their 20 points moved to T1/T4/T5 in proportion to 35:15:25 (+9.33/+4.00/+6.67, largest remainder → **+9/+4/+7**): T1 44, T4 19, T5 32, T7 5 = 100. 7 gates, all closed. Dropped the now-dead `feature_rules.max_alloc_rounds`.

**Results** — `features.py` **3.53 s** (episodes 0.69 s, SQL 2.43 s); 2,000,000 inflows → 1,580,425 episodes (median 1 inflow, max 10), **421,594** outflows inside an episode window (was 216,301 allocated). `check_features.py`: **14 passed, 0 failed**. Group-B accounts with `pass_through_share` < 0.9: **0 of 559** (was 2). Both former failures now clean: `IPOS10000921` 0.9600 / 0.9600, `SBIN10001076` 0.9600 / 0.9600. Group A 0.98 commission (min=max), 4 receivers, 9.0 min lag; group B 0.96 (min=max), 1, 16.8 min. Max `commission_ratio_median` **1.0**.

**Not done / deviations**
- **Flag for scoring:** the 1.0 cap now binds for **7,317** accounts, and the normal cohort's median commission is 0.8245 with **2,252 of 23,500** inside MP2's half band 0.90–0.99 (1,237 inside the full band 0.94–0.99). MP2 half feeds the two-signal rule, so MP2 needs a structural co-condition (e.g. require the episode to be a real split or a lone single forward) before scoring.py lands. MP1 is unaffected: 0 normal accounts reach 0.60 pass-through.
- 165,634 episodes send more than arrived (prior balance) — legitimate, ratio capped at 1.0, reported not failed.
- Re-seeded the **locked** `v1-verified` in place again; the context's own rule says a weight change should mint a new `profile_id`.
- `measure_before_burst: true` still unapplied. `in_cycle` NULL (TODO graph.py). `amount_diversity`'s T4 clause still passes all 24,873 accounts.
