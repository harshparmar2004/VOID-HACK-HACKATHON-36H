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

## 2026-10-02 — Step 4a: pass-1 scoring

**Files** — new `engine\scoring.py`, `engine\sql\scoring.sql`; edited `engine\sql\features.sql`, `engine\features.py`, `engine\config.yaml`. `features` now 32 columns (added `commission_ratio_iqr`, `forwarding_episodes`).

**Key functions** (`scoring.py`): `active_profile` · `num` / `lit` (every profile value proven numeric before it enters SQL) · `Builder.points` (rule types `threshold_desc/asc`, `ratio_to_population_median_asc`, `boolean`, `commission_pattern`, `compound`) · `Builder.phrase` (plain-English reasons) · `build_sql` · `report` · `main` (`--db`, `--pass`).

**Profile keys used** — `mule_index.parameters[]` / `zero_weight_parameters[]` / `trust_index.parameters[]` (`rule`, `weight`, `enabled`, `gate`, `pass`), `trust_index.min_tx_for_trust`, `windows.*`, `reliability_gates[].status`, `final.trust_discount_factor`, `final.override.{floor,conditions}`, `final.flag.{threshold,two_signal_rule}`, `final.bands`, `final.review_rule`. New MP2 rule shape: `type: commission_pattern` with `pattern.any_of[]` (`split` 3–6 receivers / `single` 1 receiver, named lag windows), `full`/`half` `{ratio, iqr_max}`, `null_iqr_passes`.

**Results** — 0.71 s. 24,873 rows. Flagged **688** (129 + 559 forwarders); **0 of 23,500** accounts with `tx_count` ≥ 50. Bands: suspected 688, clean 24,185. Final bins: 0–10 23,500 · 30–40 300 · 40–50 385 · 70–80 564 · 80–90 124. Override condition met by 688, lifted Final for 89. MP7 and T5 left NULL (need `neighbour_risk`).

**Verification** (`reports\scoring_review.md`, run on a copy) — weights/thresholds/gates PASS (stored JSON vs `config.yaml`: 0 differing keys); NULL features and two-signal PASS (0 NULL measurements scoring; half-count vs `is_flagged` 0 disagreements); reasons match points PASS (0 mismatches over 24,873 accounts).

**Deviations / open items**
- Added the two MP2 features and rewrote the MP2 rule (Section 4.1 / 4.6) although the task named only `scoring.py`; re-seeded the **locked** `v1-verified` in place.
- **T7 `full_at` is missing in the profile**, so T7 scores 0 for everyone (changes no decision: 0 accounts have `device_consistency` 1 and `tx_count` ≥ 5).
- Override: the 3–15 min window is applied to the split branch only; a single forward is tested on commission 0.94–0.99.
- Band `review` also covers Final ≥ 65 failing two-signal (0 accounts). `measure_before_burst` still unapplied.

## 2026-10-02 — Step 4b: layer links

**Files** — new `engine\links.py`, `engine\sql\links.sql` (sections `@@CANDIDATES` / `@@LINKS` / `@@PAIRS` / `@@CHECK`). Reuses `features.py`: `active_profile`, `sql_params`, `build_episodes`, `split_sections`.

**Key names** — `link_params` (windows + candidate receiver ranges from the MP2 pattern) · temp tables `link_cand`, `link_build` · CTEs `mule_out`, `timed`, `mule_links`, `victim_links`.

**Rules** — candidate roles, behaviour only: L1 = flagged + 3–6 receivers per inflow, L2 = flagged + 1 receiver, L3 = receive-only, VICTIM = unflagged send-only with ≤ `victim_like_max_outflows` payments. Timing: some inflow of the same EPISODE arrived inside the sender's window (L1 3–15 min, L2 ≤ 60 min); `lag_seconds` = shortest such lag. Amount: transfer ≤ episode inflow total; `share_of_inflow` = transfer ÷ episode total. No ORDER BY / tie-break on `tx_key`.

**Profile keys used** — `windows.split_forward_minutes`, `windows.single_forward_max_minutes`, `feature_rules.victim_like_max_outflows`, MP2 `rule.pattern.any_of[].receivers`.

**Results** — 1.22 s (episodes 0.70 s, link SQL 0.04 s). **2,954 links**: VICTIM_L1 300 (Rs 84,766,805) · L1_L2 1,327 (lag 180–898 s) · L2_L2 0 · L2_L3 1,327 (lag 123–1,799 s). Every transaction between two candidates became a link (2,954 of 2,954).

**Verification** — lag outside window **0**; re-derived from `tx` without episodes: 0 with no arrival in window, 0 lag disagreements, 0 shares outside (0, 1]. `scoring_review.md` confirms the same four zeros and 0 link identity changes under the +3% amount / +7 min robustness run.

**Deviations / open items**
- A receive-only sink may END a link although pass 1 does not flag it (otherwise no L2_L3 links exist).
- VICTIM_L1 links carry NULL lag and share (a victim has no inflow).
- `scores.candidate_roles` is not written here; `from_role` / `to_role` hold the candidates.

## 2026-10-02 — Step 4c: pass 2, roles, rings

**Files** — new `engine\sql\pass2.sql` (`@@RELATIONS` / `@@SOURCE` / `@@ROLES`), `engine\rings.py`, `engine\sql\rings.sql`; edited `engine\scoring.py`, `engine\sql\scoring.sql`, `engine\config.yaml`.

**Key functions** — `scoring.py`: `run_pass2`, `build_roles_sql`, `sink_link_types`, `report_roles`; `--pass 1|2` (default 2; pass 2 recomputes pass 1 in a temp table, so it is rerunnable). `rings.py`: `ring_params`, `accounts_on_cycles` (SciPy strong components), min-label propagation over rounds (`@@STEP` / `@@CHANGED`).

**Definitions** — `neighbour_risk` = amount-weighted mean PASS-1 Final of counterparties, both directions; `upstream_l1_share` / `upstream_l2_share` = share of inflow arriving through layer links from L1 / L2 candidates (all three written back into `features`). Role = best role score ≥ threshold, clear of the tie margin, AND a confirming link; else `UNCLASSIFIED_MULE`. Ring fingerprint = SHA-256 of sorted `tx_key`s.

**Profile keys used / added** — `roles.{role_threshold,tie_margin,victim_threshold,requires_confirming_link,scores.*.weights}`, `commission_ranges.L1/L2`; NEW `final.sink_override` (`enabled`, `floor` 70, `link_types` [L2_L3], `min_linked_inflow_share` 0.90); NEW `rings.patterns.{scatter_gather_min_branches: 2, funnel_min_mule_senders: 3}`.

**Results** — pass 2 1.24 s, rings 0.41 s. Flagged **1,073**: L1 129 · L2 559 · L3 385, all link-confirmed (100%); UNCLASSIFIED_MULE 0; VICTIM 300; no role 23,500. Bands: high 129, suspected 944, clean 23,800. **1 ring**: 1,073 mules + 300 victims, Rs 84,766,805 in, patterns SCATTER_GATHER + FUNNEL, 5 consistency checks all 0.

**Verification** (`reports\scoring_review.md`) — all six checks PASS, failures none: flags/roles equal the structural groups; 0 of 23,500 active accounts flagged; override never bypasses two-signal; forbidden shortcuts absent; robustness (+3% amounts, +7 min) changes 0 flags, 0 roles, 0 bands.

**Deviations / open items**
- **Rings form one network**: connected components join everything because L2s / L3s are shared across chains — needs cells (smaller units) before rings are useful.
- **Freeze recommendations must not depend on band**: only the 129 L1s are high-confidence; L2 and L3 sit in `suspected` (L3 at the 70 floor) yet L3 holds most of the money.
- **T7 `full_at` missing in the profile** (T7 = 0 everywhere).
- The sink override is a NEW flagging rule, not in Section 4.3: without it the 385 sinks top out at 55 and are never flagged.
- Fingerprint uses `tx_key`s (Section 4.4 says tx_ids). Locked `v1-verified` re-seeded in place. `rings.py` must be rerun after every scoring run.

## 2026-10-02 — Step 5a: graph arrays and victim trace

**Files** — new `engine\graph.py`, `engine\trace.py`, `audits\check_trace.py`; edited `engine\config.yaml`. Output `data\graph\*.npy` + `manifest.json` (ignored by git).

**Key functions** — `graph.py`: `build` (rebuilds only if manifest `load_id` ≠ latest `ingest_meta`, or `--force`), `load` (memory-mapped), `graph_dir` (beside the `--db` file); arrays `out_ptr/out_dst/out_tx/out_ts/out_amt`, `in_ptr/in_src/in_tx/in_ts/in_amt`. `trace.py`: `trace_victim(acct_no, db=None)`, `Context` / `get_context` (cached per process), `_expand` (links first, then fallback; pro-rata pool), `_rank_until_covered`, CLI `--victim`, `--json`. `check_trace.py`: `structural_chain`.

**Rules** — follow layer links leaving inside the sender's proven window; fallback only where none exists (outflows after arrival, inside the window, ranked by receiver `final_index`, until coverage). Stops at receive-only accounts and `max_hops`. Taint = running pool per account (this victim's inflows tainted, the rest clean; each outflow carries the current proportion). Output per account: `tainted_in`, `tainted_out`, `untraced_out`, `holding` (integer paise); role, `final_index`, reasons read from `scores`; `hop` is display only.

**Profile keys added / used** — NEW `trace.{max_hops: 4, fallback_window: single_forward_max_minutes, coverage_target: 0.90, max_accounts: 500}`; `windows.*`.

**Results** — graph build **0.43 s** (2,000,000 transfers × 2 directions, 24,873 accounts, 112 MB); second run skipped as up to date. Trace over all 300 send-only accounts: median **0.75 ms**, max **1.59 ms**; context load 75 ms once per process. Unknown account → `{"found": false, "message": "No transaction graph found"}`.

**Verification** (`check_trace.py`) — mismatches vs the independent SQL chain built from `tx` alone: accounts **0**, transfers **0**; taint not conserved 0; holding above arrivals 0; role differs from `scores` 0. 7–13 accounts per victim (median 9).

**Deviations / open items**
- The audit's SQL chain is time-windowed (3–15 min at the payee, ≤ 60 min after); with no timing it is a median 50 accounts per victim, so it cannot match a per-victim trace.
- The fallback path is only spot-tested (one normal account): no send-only account needs it.
- Section 4.4 step 0 (L1 edge score) and the pattern "findings" are not built. Trace fingerprint uses `tx_key`s.
- `engine\trace.py` shares its name with a standard-library module; it is imported only with `engine\` first on the path.
