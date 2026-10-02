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

## 2026-10-02 — Step 4 follow-ups: cells, freeze_recommended, T7, victim_trace rename

**Files** — edited `engine\rings.py`, `engine\sql\rings.sql` (new `@@MEMBERS`, `@@CELLS`), `engine\scoring.py`, `engine\sql\pass2.sql`, `engine\sql\schema.sql`, `engine\config.yaml`, `audits\check_trace.py`; renamed `engine\trace.py` → `engine\victim_trace.py` (git mv).

**Key names** — NEW tables `cells` (ring fields + `network_id`, `l1_acct`) and `cell_members` (`cell_id`, `acct_id`, `role`); NEW `scores.holding_paise`, `scores.freeze_recommended` (added by `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `schema.sql`). `rings.py`: `RING_FIELDS`, temp `ring_member`, `cell_reach` (recursive, link direction only), `cell_link`, `cell_member`, `cell_build`. `scoring.py`: `freeze_params`, freeze table in `report_roles`. Trace output: `network_id`, `cell_ids`, `freeze_recommended`, `account_holding`; summary `cell_ids` (the victim's), `freeze_recommended`, `freeze_holding_total`.

**Profile keys added / changed** — T7 `rule.full_at: 1` (was null); NEW `final.freeze.{requires_flag, requires_role_confirmed, min_holding_paise_exclusive: 0}`; NEW `rings.cells.method: confirmed_l1_downstream`. Locked `v1-verified` re-seeded in place.

**Results** — full rerun (apply_schema, seed_profile, pass 1, links, pass 2, rings): pass 2 0.78 s, rings 0.15 s.
- Flags / roles / confirmations / bands: hash over all 24,873 accounts identical before and after; 1,073 flagged (L1 129, L2 559, L3 385); link set identical (2,954). T7 is now scored but > 0 on 0 accounts (no account has `device_consistency` 1 and enough transactions for trust).
- Network: still 1 (ring_id 1 = network_id 1). **Cells: 129**, size **10–120** mule accounts (median 38), 11–128 with victims; 1–8 victims per cell; 768 mules are in more than one cell (most: 28). Patterns: SCATTER_GATHER 45, FUNNEL 4. All 5 cell checks 0.
- freeze_recommended: L1 129 (Rs 1,695,336) · L2 559 (Rs 3,322,859) · L3 385 (Rs 79,748,610) · total 1,073, Rs 84,766,805.
- `check_trace.py`: accounts 0, transfers 0 mismatches; PASSED; median 0.75 ms.

**Deviations / open items**
- **Cells over-reach**: membership is account-level, so a shared L2 pulls every L3 it ever paid into each of its cells. A cell holds Rs 1.5M–22.7M against Rs 58k–2.7M paid in; cell totals overlap and do not sum to the network. A per-victim trace (7–13 accounts) is the tight unit; a money-following cell would need the parent inflow recorded on each link.
- `ring_id` columns were NOT renamed (fixed schema): `network_id` exists on `cells` and in trace output only.
- Two tables beyond the 12 of Section 9; Section 9 and any `engine\trace.py` mention in PROJECT_CONTEXT.md are now out of date (not edited, by rule).
- Cell / ring holding is linked money (in − out over links); `scores.holding_paise` is all received − all sent. They agree in total here (Rs 84,766,805).
- Every flagged account is freeze-recommended on this file, so the rule does not yet discriminate. `rings.py` must still be rerun after every scoring run (trace now refuses to load without cells).

## 2026-10-02 — Step 5b: trace findings, summary, freeze candidates

**Files** — edited `engine\victim_trace.py`, `engine\config.yaml` (profile re-seeded; scores not rerun, nothing scoring reads changed).

**Key names** — `_findings`, `_on_cycle`, `_minutes`; Context cut-offs `forward_share_min`, `split_min`, `scatter_min`, `funnel_min`, `rapid_window`, `max_evidence`. Output keys: `per_hop` (renamed from `hops`, adds `minutes_since_previous_hop`), `findings`, `freeze_candidates`, `summary.{reconciliation, who, how, why, when}`, `fingerprint`.

**Rules** — patterns RAPID_PASS_THROUGH, SCATTER, FUNNEL, SCATTER_GATHER, CYCLE (only if the trace's transfers close a loop). One finding per pattern; one evidence sentence per account, built only from the trace's accounts and transfers. Confidence: `high` = every transfer of the pattern is a proven layer link, `medium` = any fallback transfer. Freeze candidates: `freeze_recommended` AND tainted holding > 0, largest first, with bank, `cell_id` (shared with the victim's L1) and receipts (tx_id, tx_key, ts, amount, tainted).

**Profile keys used / added** — `final.override.conditions.forwarded_share_min` (0.90) and `split_count.min` (3), `windows.*`, `rings.patterns.*`; NEW `trace.max_evidence_sentences: 10`.

**Results** (all 300 victims) — RAPID_PASS_THROUGH 300, SCATTER 300, SCATTER_GATHER 5, FUNNEL 0, CYCLE 0, all `high`. Freeze candidates 7–13 per victim. Fingerprint identical on 3 reruns (sample `b60009fc…`) and equal to a recomputed hash on 300 of 300.
- Reconciliation, per victim: difference 0 paise on 300 of 300. Sample: Rs 90,733.95 = kept 5,371.45 + held at end 85,362.50 + untraced 0.00. All victims: Rs 84,766,804.55 = 5,017,576.09 + 79,749,228.46 + 0.00.
- `check_trace.py`: 0 account / 0 transfer mismatches, PASSED; trace median 0.91 ms (was 0.75).

**Deviations / open items**
- Confidence is a label (high / medium), not a number; Section 4.4 does not define one.
- "Rapid" = inside the longest pass-through window (60 min); there is no separate trace cut-off.
- Section 4.4's per-account patterns READ from `features` (dormancy, structuring) and step 0 (L1 edge score) are not in the findings. Fingerprint uses `tx_key`s, not tx_ids.
- `medium` confidence and FUNNEL / CYCLE findings are untested on real data: no victim trace on this file produces them.

## 2026-10-02 — Step 5c: multi-victim trace, reverse trace, cell summary

**Files** — edited `engine\victim_trace.py`, `audits\check_trace.py`. No profile, schema or scoring change.

**Key names** — `trace_victims(acct_nos, db=None)`, `reverse_trace_cell(cell_id)`, `reverse_trace_network(network_id)`, `cell_summary(cell_id)`; helpers `_payments_into`, `_reverse`, `_cell`; Context `cell_info`, `cell_accts`. CLI: `--victim | --victims a,b | --cell N | --network N | --cell-summary N` (the last four print JSON).

**Rules**
- Merged trace: each victim is traced alone (the pro-rata pool already treats other victims' money as clean) and the traces are merged; a shared account or transfer appears once with its total and each victim's part under `by_victim` (`tainted_in`, `tainted_out`, `untraced_out`, `holding`, `share_of_tainted_in`). Per-victim totals in `victims`.
- Reverse trace: from the cell's L1 (network: every L1 of its cells) back over the graph's incoming transfers that are proven Victim → L1 links; where an L1 has none, incoming transfers from accounts with role VICTIM. Returns victims, amounts, timestamps, tx_ids.
- Cell summary: counts, holding, patterns, fingerprint READ from `cells`; victims walked back; freeze accounts from `scores`.
- Unknown cell / network / victims → `{"found": false, …}`.

**Results** — `check_trace.py` PASSED. Forward: 0 account / 0 transfer mismatches (300 victims, median 0.89 ms).
- **Cells checked 129, reverse-vs-forward victim mismatches 0**; cells disagreeing with the `cells` table 0; merged traces not adding up 0; networks checked 1, mismatches 0.
- Timings: reverse cell median 0.27 ms (max 0.64); cell summary 0.31 ms (max 0.75); merged trace of one cell's victims 2.2 ms (max 8.1); reverse network 3.1 ms; all 300 victims merged 292 ms (1,073 accounts, 817 shared, 2,954 transfers, Rs 84,766,804.55 in = held, 0 untraced).
- Sample, cell 12 (L1 ICIC10000310, 3 victims, Rs 1,344,413.78): shares at the L1 35.61% / 33.05% / 31.34%; 25 accounts, 27 transfers.

**Deviations / open items**
- "Forward trace reaches the cell" is taken as: reaches the cell's L1. Reaching any cell member would pull in other L1s' victims through shared L2 / L3s (the cell over-reach noted in the Step 4 follow-ups).
- Real mixing is rare here: only 2 transfers on the whole file carry two victims' money at once, so the pro-rata split inside one transfer is barely exercised.
- The reverse-trace fallback (no Victim → L1 link) has not run on real data: every L1 has links.
- `cell_summary.holding` is the cell's linked holding and overlaps other cells (cell 12: Rs 9.84M held vs Rs 1.34M paid in).

## 2026-10-02 — Trace fallback test (no code change)

**Step** — copy of `data\case.duckdb` in `%TEMP%\fallback_test`; deleted the 31 `layer_links` rows of three victims' chains (smallest, median, largest payment) on the copy; built graph arrays beside the copy; traced with `--db`; compared with the real database. Copy and its graph deleted. Live database not written.

**Files** — none changed.

**Results** — all three traces ran entirely on the fallback (`via: fallback`, findings drop to `medium`). No wrong account and no wrong amount on any account reached; nothing extra followed.
- SBIN10000294 (Rs 499,823.99): identical — 11 accounts, 11 transfers, same amounts, same fingerprint.
- ICIC10000184 (Rs 51,698.58): 9 of 11 accounts; Rs 644.43 (1.2%) reported as untraced at the L1; 1 L2 + 1 L3 missing.
- BARB10000045 (Rs 285,262.68): 5 of 9 accounts; Rs 21,677.80 (7.6%) untraced at the L1; 2 L2 + 2 L3 missing; SCATTER finding lost (fewer than 3 receivers followed).

**Deviations / open items**
- Cause of the gap: `trace.coverage_target` 0.90 — the fallback follows receivers by `final_index` then amount until 90% of the tainted money is covered and leaves the smallest branches as `untraced_out`. This is the Section 4.4 rule working as written, not a defect; taint still reconciles (held + untraced = paid).
- Decision needed: keep 0.90, or raise `trace.coverage_target` (1.0 reproduces the link trace here but follows every in-window outflow of a busy account).
- Only the hop-1 L1 split was cut short; single-forward L2 hops were followed in full.

## 2026-10-02 — Trace fallback rule: flagged receivers first

**Step** — changed the fallback in `engine\victim_trace.py` (used only where an account has no layer link): (1) follow every in-window outflow to a flagged receiver; (2) then unflagged receivers by `final_index`, then amount, until `trace.coverage_target` of the remaining tainted money (tainted in minus what the flagged receivers took) is covered; (3) `trace.max_accounts` and `untraced_out` unchanged. Same rule for the victim's own payments (hop 1).

**Files** — `engine\victim_trace.py`; `engine\config.yaml` (comment on `coverage_target` only, no value changed, no reseed needed).

**Key names** — `_fallback_choice` (replaces `_rank_until_covered`); `Context.flagged` (read from `scores.is_flagged`; no score = not flagged).

**Results** — fallback test on a `%TEMP%\fallback_test` copy, 31 `layer_links` rows deleted, graph built beside the copy, all transfers `via: fallback`:
- SBIN10000294: 11/11 accounts, 11/11 transfers, 0 untraced, same fingerprint.
- ICIC10000184: 11/11 accounts, 11/11 transfers, 0 untraced, same fingerprint.
- BARB10000045: 9/9 accounts, 9/9 transfers, 0 untraced, same fingerprint; SCATTER finding back.
- No extra account, no amount difference on any account. Copy deleted; live database not written.
- `audits\check_trace.py` on the live database: PASSED — 300 victims, 0 account / 0 transfer mismatches, taint conserved, 0 traces needed the fallback; 129 cells, 0 reverse mismatches. Test 1.3 s, audit traces 0.27 s.

**Deviations / open items**
- PROJECT_CONTEXT.md Section 4.4 has no "Fallback rule (decided 2 Oct)" note (only the line "falls back to the general rules"); the rule was taken from the task text. The note still needs adding to Section 4.4 by hand.
- Step (2) is not separately tested: the test compares the result with the link trace and does not record which step picked each receiver.

## 2026-10-02 — Step 5c polish: trace summary wording

**Step** — Step 5c was re-issued. `trace_victims`, `reverse_trace_cell`, `reverse_trace_network`, `cell_summary` and the per-cell check in `audits\check_trace.py` already existed (Step 5c entry above) and were left as they are; only the three polish items were missing and were added.

**Files** — `engine\victim_trace.py`.

**Key names** — `_score_shown`; `victim_score` added to `DETAIL_SQL`, the account dict and `_STATIC` (JSON keeps `final_index` too).

**Changes**
- (a) hop 1 prints "(victim payment)" instead of "(+None min)"; the JSON `minutes_since_previous_hop` stays null.
- (b) an account with role VICTIM is shown with `victim_score` (victim line and account rows); every other account with `final_index`.
- (c) `why`: commission kept by the forwarding accounts (roles read from `scores`, e.g. "L1/L2") vs the amount at the final accounts, and whether the whole held amount is in freeze-recommended accounts (otherwise the part that is); untraced money is mentioned only when above zero.

**Results** — `check_trace.py` PASSED: 300 victims, 0 account / 0 transfer mismatches.
- Cells checked 129, reverse-vs-forward victim mismatches 0; cells table disagreements 0; merged traces not adding up 0; 1 network, 0 mismatches.
- Timings: context load 81 ms; trace median 0.88 ms (max 1.77); reverse cell 0.27 ms (max 0.44); cell summary 0.31 ms (max 0.50); merged trace of one cell 2.17 ms (max 8.03); reverse network 3.21 ms.
- Cell 12 (L1 ICIC10000310, 3 victims, Rs 1,344,413.78, 25 accounts, 27 transfers): PUNB10000270 35.61%, SBIN10000165 33.05%, IPOS10000026 31.34% of the money at the L1.

**Deviations / open items**
- The open items of the Step 5c entry still stand (cell reach = the cell's L1; reverse fallback never run on real data).

## 2026-10-02 — Step 5c follow-ups: victim first hop, L1 edge score

**Step** — (a), (b), (c) were already done in the entry above and were skipped. Done here: (d) the victim's first hop when no layer link exists, and (e) the unflagged-ranking test.

**Files** — `engine\victim_trace.py`; `engine\config.yaml` (new `trace.l1_edge_score` block); profile `v1-verified` reseeded with `engine\seed_profile.py` (new trace keys only, no scoring value changed, scoring not rerun).

**Key names** — `_l1_edge_scores`, `_threshold`, `Context.edge_facts`; transfer fields `confidence` (high / medium / low) and `l1_edge_score`; summary fields `low_confidence`, `payments_not_followed`; stop reason `no_payment_with_l1_edge_score`.

**Changes (d)**
- Victim hop 1 with no layer link: payments to flagged receivers only. If none, only the payment(s) with the highest L1 edge score (ties together, score must be above 0), marked low confidence in the transfer, the findings and the `how` line. `coverage_target` is no longer applied to the victim's payments; the rest are reported as `payments_not_followed` and never tainted.
- L1 edge score (Section 4.4 step 0), weights 40/20/15/15/10 from the profile: onward forwarding inside `trace.fallback_window`; burst fan-in from `features` against the ZP1 cut-offs; first-time payee AND amount vs population median against the MP8 cut-offs; forwarded money moving on again inside the single-forward window; the MP3 layering-edge combo on the payment.
- Later hops are unchanged (`_fallback_choice`: flagged first, then unflagged by `final_index` to 0.90).

**Results (e)** — `%TEMP%\unflagged_test` copy, victim BARB10000045 (Rs 285,262.68, 9 accounts with links): 9 `layer_links` rows deleted, `is_flagged = false` on its 4 L2 and 4 L3.
- Hop 1 followed the flagged L1 IPOS10000434. At the L1 the unflagged ranking followed ICIC10000793 (Rs 206,254.40) and SBIN10001068 (Rs 51,625.23); they forwarded to AIRP10001394 and PYTM10001387.
- 5 of 9 accounts, 5 transfers; Rs 21,677.80 untraced at the L1 (L2s SBIN10000910, AXIS10000802 and their L3s not reached); taint reconciles (difference 0); no unrelated account.
- Extra run, L1 unflagged too: its payment was followed with L1 edge score 69.2, low confidence, same 5 accounts.
- Copy and its graph deleted; live database written only by the reseed. Test 1.8 s.
- `audits\check_trace.py`: PASSED — 300 victims, 0 account / 0 transfer mismatches, 0 traces needed the fallback; 129 cells, 0 reverse mismatches; trace median 0.91 ms.

**Deviations / open items**
- A locked profile was reseeded in place to add the trace keys (same as earlier trace keys); say if this should be a new profile_id instead.
- Burst fan-in scores 0 in the edge score: the ZP1 cut-offs are null in the profile, so 20 of the 100 points cannot be earned on this file.
- Every victim on this file has one payment, so "highest-scoring payment among several" is untested on real data.
- The edge-score part definitions are my reading of the one-line step 0; they are written out in the `config.yaml` comment for review.

## 2026-10-02 — Step 6 batch B1: API skeleton + status, victims, mules, entities

**Step** — read-only FastAPI layer over `data\case.duckdb` (API_CONTRACT.md rows B1). No table, column or row written.

**Files** — new `api\`: `main.py`, `middleware.py`, `deps.py`, `schemas\`, `routers\`, `services\`, `repositories\` (status, victims, mules, entities, profiles); new `audits\check_api.py`; `requirements.txt` (+ fastapi 0.142.2, uvicorn 0.54.0, installed in `.venv`).

**Key names** — `get_con` (read_only=True per request, closed in finally), `get_profile` / `Profile`, `db_path` (`ABHEDYA_DB` override), `ApiModel` (extra fields forbidden), `fetch_dicts`, `TIMING_HEADER` = `X-Process-Time-Ms`, `ALLOWED_ORIGINS`; errors are `{detail, status, path[, errors]}`.

**Endpoints** — GET `/api/status`, `/api/victims`, `/api/detected-victims` (same handler), `/api/mules?limit,role_filter,min_risk,min_amount,bank_filter`, `/api/entities?limit,bank_filter,min_amount`.
- Mules = `is_flagged` accounts of the active profile, sorted by `final_index` desc. `role_filter` takes `L2` or the UI label `L2_DISTRIBUTOR`; `min_risk` on `final_index`; `min_amount` on total money received; `bank_filter` on `accounts.bank`.
- Money is returned in rupees (paise / 100). Totals and distinct senders / receivers are aggregated from `tx` in SQL.
- Victim `amount` / `timestamp` = the victim's proven `VICTIM_L1` links (null if none).

**Results** — `audits\check_api.py` PASSED, 104 checks, 3.2 s: counts equal SQL written in the audit (flagged 1073; L1 129, L2 559, L3 385; victims 300; accounts 24873; cells 129); every response passes its schema; 404 / 422 are clean JSON; CORS only for `http://localhost:5173`; no non-GET route; database size and modified time unchanged, no `.wal`.
- Timings: status 46 ms, victims 35 ms, mules 60-100 ms, entities about 120 ms. Real uvicorn start smoke-tested.

**Null fields (UI expects, tables lack)** — mules: `hop`, `p1_score`..`p6_score` (ours are in `param_points`); entities `bank_stats[].name` (`bank_directory` is empty), so `bank` is the 4-letter code everywhere.

**Deviations / open items**
- fastapi and uvicorn were not installed; installed from PyPI (one network call by pip, none in code).
- `/victims` returns a bare list (like `/mules`); the files I was allowed to read do not show which shape the UI expects — check in Step 7.
- `high_risk_mules` = flagged accounts (1073); the UI's own ">= 90" cut is not an engine concept. `bands` is returned beside it.
- `/entities`: `type` is a label of `scores.role` ("Not flagged" when role is null), `risk` = "<BAND> (<final_index>)", `min_amount` applies to the larger of money in / money out; `bank_stats` `count` / `share` are numbers, not the UI's formatted strings.
- UI role mapping sends UNCLASSIFIED_MULE to "L1_COLLECTOR" (none on this file) — fix in Step 7.

## 2026-10-02 — Step 6 batch B2: trace, batch trace, cells, network

**Step** — read-only trace endpoints over `engine\victim_trace.py` (API_CONTRACT.md rows B2). No table, column or row written; engine untouched.

**Files** — new `api\routers\trace.py`, `api\services\trace.py`, `api\repositories\trace.py`, `api\schemas\trace.py`; changed `api\main.py`, victims router / service / schema, `audits\check_api.py`.

**Key names** — `services.trace._run` (calls the engine on `db_path()` under `_LOCK`, `SystemExit` -> 503), `engine.get_context` (loaded on the first trace of the process, reused), `_shown` (returned-graph filter), `ProfileUsed`, `FiltersApplied`, `VictimsResponse`, `MAX_BATCH_VICTIMS`, `READ_ONLY_POSTS`.

**Endpoints** — GET `/api/trace/{victim}`, POST `/api/trace/batch`, GET `/api/cells`, `/api/cells/{id}`, `/api/cells/{id}/victims`, `/api/network`.
- `/victims` and `/detected-victims` now return `{victims: [account numbers], items: [objects]}`.
- Trace: contract names on `nodes[]` / `links[]`, `total_siphoned_inr`, `recoverable_holding_inr` (= held in freeze-recommended accounts), plus `found, victim, fingerprint, profile, filters, summary, reconcile, per_hop, findings, freeze_candidates, cells`. Money in rupees.
- `max_hops` is capped at the profile max; `time_window` / `custom_rules` are accepted and listed under `filters.ignored`; `min_amount`, `bank_filter`, `keyword` (narration) and `max_hops` filter only the returned links, and a node stays when a remaining link touches it. Totals, summary, reconcile and fingerprint always describe the whole trace.
- Unknown account: 200 `{found: false, message}`. Unknown cell: 404. `/network` lists `rings` rows with their cell count.

**Results** — `audits\check_api.py` PASSED, 981 checks, 4.6 s. SBIN10000294: 11 traced accounts + victim root, 11 links, reconcile difference 0, fingerprint 667df0bc... equal to the CLI; link amounts / mode / lag and node IFSC equal SQL in the audit; batch of 5 equals the single traces; all 129 cells' `/victims` equal `reverse_trace_cell`; database size and modified time unchanged, no `.wal`.
- Timings: first trace 88 ms (loads the context), later traces 24 ms, batch 43 ms, cells 18 ms, cell / cell victims 1-2 ms, network 19 ms.

**Null fields** — nodes: `device_type`, `ip_address` (our device / IP are per transfer, returned on each link); links: `lag_seconds` on the victim's own payment and on fallback transfers, `l1_edge_score` unless the first hop was chosen by it; `by_victim` outside the batch trace.

**Deviations / open items**
- `nodes[]` has 12 entries for the sample, not 11: the victim is included as the hop-0 root the UI graph needs (contract: `risk_score` = victim_score for VICTIM). The audit checks 11 traced accounts + 1 root.
- `max_hops` below the profile max hides deeper links in the response only; the engine has no such parameter and always traces to the profile max.
- B1's "no write routes" check read `app.routes`, which this FastAPI version leaves empty for included routers, so it checked nothing. It now reads the OpenAPI paths and allows only POST `/api/trace/batch`.
- Not smoke-tested under a real uvicorn process this batch (TestClient only).

## 2026-10-02 — Step 6 batch B3: profiles, in-memory preview, transaction search

**Step** — read-only profile endpoints and a what-if preview (API_CONTRACT.md rows B3), plus two trace fixes. The case file is never written by the API.

**Files** — new `api\routers\profiles.py`, `transactions.py`, `api\services\profiles.py`, `transactions.py`, `api\repositories\preview.py`, `transactions.py`, `api\schemas\profiles.py`, `transactions.py`; changed `api\main.py`, `api\repositories\profiles.py`, trace service / schema, `audits\check_api.py`, `engine\scoring.py`, `engine\links.py`, `engine\sql\features_episode.sql`.

**Key names** — `scoring.score(con, pass_no, label)`, `links.build(con, label)` (the old `main()` bodies; `main()` only opens the file and calls them), `preview.open_memory` (in-memory connection, case file ATTACHed READ_ONLY as `case_db`; `tx` / `accounts` are views, `scores` / `layer_links` / `features` / `scoring_profiles` in-memory tables), `apply_changes`, `ProfileChanges`, `CONDITIONS` (search whitelist), `SEARCH_FIELDS`, `MAX_SEARCH_LIMIT`, `READ_ONLY_POSTS`, `DEFERRED_POSTS`.

**Endpoints** — GET `/api/profiles/active`, `/api/profiles/{id}`; POST `/api/profiles/preview`; GET `/api/transactions/search`; POST `/api/profiles`, `/api/profiles/{id}/activate` -> 501.
- Profile: per parameter `weight, enabled, scored, gate, gate_status, thresholds` (the stored rule), one-line `description`; plus gates, final rule, windows and the stored `definition`.
- Preview runs pass 1 -> links -> pass 2 on the in-memory tables and compares with the stored scores: flagged before / after, flags gained / lost and role changes with accounts (`account_limit`, default 200), band and role counts, freeze and link counts, `final_index_changed`, warnings.
- Previewable changes: parameter `weight` / `enabled`, `flag_threshold`, `trust_discount_factor`, `min_parameters_at_half`. 422 for a negative weight, fewer than 2 scored mule signals, the two-signal rule disabled or below 2, an unknown parameter or field, or scoring a zero-weight (ZP) parameter.
- Search fields: `min_amount, max_amount, bank, payment_mode, device, foreign_ip, narration_category, from_ts, to_ts, limit` (cap 1000); any other query field -> 422; bound parameters only.
- Trace: `display_trimmed`, `full_hops`; node `device_type` / `ip_address` = most frequent value on its outgoing links in the trace, null for receive-only nodes.

**Results** — `audits\check_api.py` PASSED, 1098 checks, 11.6 s. Preview with no changes: 0 flags gained / lost, 0 role changes, 0 accounts with a changed final_index. Preview with MP4 weight 0: flagged stays 1073 (0 gained, 0 lost), bands move from 129 high_confidence / 944 suspected to 0 / 1073, largest final_index change 16.9, warning that mule weights sum to 85. Database size and modified time unchanged, no `.wal`. `check_trace.py` PASSED.
- Preview timing: 1.7-3.1 s (median about 2.1 s; 40 consecutive previews, 0 failures). Search 20-560 ms.
- Refactor check on a scratch copy: `features.py`, `scoring.py --pass 1`, `links.py`, `scoring.py` rerun with the new code; `scores` (24,873 rows) and `layer_links` (2,954) identical to the stored tables, max final_index difference 0.

**Deviations / open items**
- Engine fix outside the brief: `features_episode.sql` numbered episodes with a ROWS frame, so two inflows sharing a timestamp could land in different episodes depending on tie order. The build's own audit then aborted ("overlapping_episodes=1"), about 1 preview in 10. Now a RANGE frame; successful runs give the same episodes as before.
- Rebuilt `features` differ from stored in `timing_regularity` only (6 accounts, 2e-16, float summation order; ZP4 feature, weight 0, not scored). Present before this batch.
- MP4 weight 0 loses no flags because weights are not rebalanced (stated in `warnings`) and the pass-through / sink override floor keeps the linked accounts above the flag threshold.
- The preview does not rebuild cells / rings, and cannot preview window or feature-rule changes (those are measured into `features`).
- The case file itself was not re-scored; the stored scores are the ones written before this batch.

## 2026-10-02 — Step 6 batch B4a: scanner explorer, CSV template, deferred / dropped stubs

**Step** — API_CONTRACT.md rows B4 (scanner summary + problematic transactions, templates) and every DEFERRED / LATER / DROP row. Read-only; database unchanged.

**Files** — new `api\routers\scanner.py`, `templates.py`, `deferred.py`, `api\services\scanner.py`, `api\repositories\scanner.py`, `api\schemas\scanner.py`, `api\static\transactions_template.csv`; changed `api\main.py`, `audits\check_api.py`, `.gitignore` (`!api/static/*.csv`, the template was hidden by `*.csv`).

**Key names** — `ScannerSummary`, `ProblematicTransaction`, `MAX_SCANNER_LIMIT`, `CONDITIONS` (scanner filter whitelist), `FILTER_FIELDS`, `FILTER_LINKED` / `FILTER_FOREIGN`, `TEMPLATE_CSV`, `DEFERRED`, `DROPPED`, `NOT_YET`; audit: `expected_b4`, `SCOPE`, `DEFERRED_B4`, `REFUSED_POSTS`.

**Endpoints**
- GET `/api/scanner/summary`: `records_scanned`, `flagged_transfers`, `illegal_linkages` (layer links), `link_types[]`, `multi_ip_geolocation` (foreign-IP transfers inside the explorer set), `early_intervention` (flagged accounts holding money). Null: `elapsed_seconds`, `speedup_factor`, `throughput_txns_per_second`, `benchmark_passed`, `target_seconds`, `parameters_evaluated`, `heavy_whale_transactions`, `hyper_frequency_accounts`, `subnets_flagged`, `predicted_cashout_window_mins`.
- GET `/api/scanner/problematic-transactions?limit,filter_type,link_type,min_amount,bank_filter,keyword` (limit cap 1000, newest first, bare list as the UI expects). Population: layer links of the active profile + transfers whose sender or receiver is flagged. `filter_type` / `link_type` take a link type; `filter_type` also `ILLEGAL_LINKAGES` (any link) and `FOREIGN_IP`; `keyword` = contains on the narration category. UI names (`Transaction_ID`, `txn_timestamp`, `Sender_Account`, `Receiver_IFSC`, `Amount_INR`, `receiver_role`, `holding_balance`, ...) plus ours (`tx_key`, `link_type`, `lag_seconds`, `sender_flagged`, `receiver_flagged`, `narration_category`). Null: `hop_stage`, `anomaly_flags`, `urgency`, `estimated_minutes_to_exit`, `is_scam_narration`.
- GET `/api/templates/{file}`: any `.csv` name returns the one template (11 columns + 1 example row); other extensions 404. The requested name is never used as a path.
- 501 `not yet available`: POST `/upload`, `/scanner/emergency-freeze`, `/scanner/unfreeze`, `/vault/verify`; GET `/legal/notices/{victim}`, `/legal/case-diary/{victim}`, `/vault/artifacts`, `/vault/certificate/{id}`. 410: POST `/victim/load-demo/{id}`, `/ingest-url`, `/settings`, `/settings/test-connection`, `/assistant/chat`; GET `/settings`. GET `/scanner/frozen-accounts` -> `[]`.

**Results** — `audits\check_api.py` PASSED, 1206 checks (was 1098), 14.6 s. Summary: 2,000,000 scanned; 2,954 flagged transfers = 2,954 layer links (VICTIM_L1 300, L1_L2 1,327, L2_L3 1,327), Rs 24.76 cr; 2,654 of them from a foreign IP; 1,073 flagged accounts holding Rs 8.48 cr. Timings: summary 53 ms, problematic 114 ms median / 404 ms max. Database size and modified time unchanged, no `.wal`.

**Deviations / open items**
- With the active profile no transfer touches a flagged account without being a layer link, so the "flagged transfers" part adds 0 rows today.
- The UI tabs `HEAVY_WHALES` and `SMURFING_HOPS` answer 422 (no whales; no roles by hop); Step 7 must replace them with link-type tabs. `is_foreign_ip` is a boolean, the UI compares with `1`.
- Not built here (still 404): POST `/scanner/run-60s-benchmark`, POST `/jury/blind-test` (rest of B4), POST `/parameters/simulate` (replaced by the profile endpoints in B3, not marked DROP).
- TestClient only; not run under a real uvicorn process.

## 2026-10-02 — Step 6 batch B4b: honest benchmark, jury blind test

**Step** — API_CONTRACT.md rows `/scanner/run-60s-benchmark` and `/jury/blind-test`. Read-only; database unchanged; ingestion is never re-run.

**Files** — new `api\routers\benchmark.py`, `api\services\benchmark.py`, `api\repositories\benchmark.py`, `api\schemas\benchmark.py`; changed `api\main.py`, `audits\check_api.py`, `audits\check_trace.py`.

**Key names** — `BenchmarkResponse` (extends `ScannerSummary`), `IngestionTiming`, `GraphTiming`, `TraceSample`, `JuryRequest`, `JuryResult`, `JurySummary`, `JuryResponse`, `TRACE_SAMPLE`, `DEFAULT_JURY_VICTIMS`, `MAX_JURY_VICTIMS`, `_timed_traces`, `_sample`; `structural_chain(con, profile, victims=None)` in `check_trace.py` (new optional `victims` acct_id list; None = every send-only account, as before).

**Endpoints**
- POST `/api/scanner/run-60s-benchmark` (no body): the scanner summary plus `ingestion` (`load_seconds`, `rows_loaded`, `rows_per_second` from the latest `ingest_meta`), `graph` (`build_seconds`, `built_at`, `rows`, `accounts`, `current` from `graph\manifest.json`; null if not built) and `trace_sample` (20 random VICTIM accounts traced live: `total_ms`, `median_ms`, `min_ms`, `max_ms`, `accounts_median`). `elapsed_seconds`, `speedup_factor`, `throughput_txns_per_second`, `benchmark_passed`, `target_seconds` stay null.
- POST `/api/jury/blind-test` `{n=20, seed?}` (body optional; n 1..1000, capped at the number of VICTIM accounts): per victim `victim_account`, `correct`, `latency_ms`, `nodes_identified`, `accounts_expected`, `transfers_found`, `transfers_expected`, `accounts_only_in_trace`, `accounts_only_in_chain`, `siphoned_amount`, `roles_breakdown`, `freeze_targets`; `jury_criteria_summary` with `victims_traced`, `correct`, `incorrect`, avg / median / max latency, `chain_build_ms`; `detection_metrics` null (no ground truth). correct = the trace's accounts and transfers equal the chain built from `tx` alone inside the profile's windows.

**Results** — `audits\check_api.py` PASSED, 1258 checks (was 1206), 15.5 s. All 300 VICTIM accounts: 300 correct, median 0.91 ms, max 58 ms per trace, chain built in 49 ms. Benchmark: ingest 5.96 s for 2,000,000 rows (stored), graph 0.396 s (stored), 20 live traces in 20.6 ms (median 1.03 ms, median 9 accounts). Database size and modified time unchanged, no `.wal`. `check_trace.py` PASSED after the `structural_chain` change (0 mismatches).

**Deviations / open items**
- The API imports `structural_chain` from `audits\check_trace.py` (reuse asked for); the audit folder is now a runtime dependency of the API.
- Trace timings are the engine call only, with the graph context already loaded; they exclude the HTTP layer and the UI field mapping.
- UI (Step 7): the jury page reads `detection_metrics.f1_score` and role keys `L1_COLLECTOR` / `L2_DISTRIBUTOR` / `L3_CASHOUT`; we return null and our role names (L1 / L2 / L3), so its hard-coded fallbacks must go.
- POST `/parameters/simulate` is still 404. TestClient only; not run under a real uvicorn process.
