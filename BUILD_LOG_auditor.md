# BUILD_LOG_auditor.md — branch `auditor`

## 2026-10-02 — Task D1a: generic anomaly tools + audit run

**Step** — six deterministic read-only tools (Section 16 stage 1; tool layer for Section 17) and a runner.

**Files** — new `auditor\__init__.py`, `auditor\tools.py`, `auditor\audit_rules.json`, `auditor\run_audit.py`; output `reports\json\audit.json`.

**Key names** — `COLUMNS` (whitelist: name -> table, SQL expression, kind), `TOOLS`, `connect` (read_only), `load_rules`, `list_columns` / `list_features` / `list_groups`, `profile_shapes`, `check_uniqueness`, `check_consistency`, `check_ranges`, `find_outliers`, `check_distribution`; `run_audit.plan`, `run_audit.run`. Derived columns: `narr_rail`, `ts_hour`, `ifsc_bank`; account group `flow_class`.

**Results** — `run_audit.py --db ...\data\case.duckdb`: 3.0 s, 68 findings, 0 failures. CLEAN 21 · TRAP 7 · SIGNAL 18 · NOISE 14 · INCONCLUSIVE 8.
- TRAP `check_uniqueness:tx_id`: 2,250 IDs repeat on 4,502 rows (max 3x); all 2,250 label different records.
- TRAP `check_consistency:narr_rail,mode`: disagree on 978,058 rows (48.90%), Cramer's V 0.002.
- TRAP `check_ranges:amount_paise`: 59,747 of 59,823 RTGS rows below Rs 2 lakh (99.87%); also 355 UPI rows above Rs 1 lakh; IMPS limit kept.
- TRAP `check_distribution:device`: 666,004 / 665,917 / 665,425 (chi2/dof 0.15); rare Linux_Script and Web_Emulator, 1,327 each.
- TRAP also: `ts_hour` flat over 24 hours; `bank` and `ifsc_bank` flat over 10 banks.
- SIGNAL: narration has 3 rare shapes (2,954 rows); amount outliers sit in headless / foreign-IP rows (93.5% vs 8.5%).
- Two runs give identical JSON (runtime aside). 0 of 20,000 narration detail tokens appear in the output. A write on the connection is refused. Unknown or wrong-kind columns return INCONCLUSIVE, never SQL.

**Deviations**
- The active profile `v1-verified` has no auditor tolerances, so they live in `auditor\audit_rules.json`; a profile `audit_rules` block overrides them key by key. Nothing is hard-coded in the Python.
- Tools take the connection first: `tool(con, ...)`. `find_outliers` over account features needs the `features` table; it is skipped when absent.
- `find_outliers` by `flow_class`: 6 features INCONCLUSIVE (NULL outside two-way accounts), so the group cannot compare them.
- Device split and flat hours are reported as warnings only; nothing here feeds scoring.
- One spot-check command called bare `python` by mistake; it hung and was stopped, nothing ran.

## 2026-10-03 — Task D1b: fully generic auditor, ARTEFACT verdict, do_not_use

**Step** — no dataset literal in `auditor\`; generator-artefact tests; off-only `do_not_use` list; generic checker.

**Files** — changed `auditor\tools.py`, `auditor\run_audit.py`, `auditor\audit_rules.json`, `reports\json\audit.json`; new `audits\check_auditor_generic.py`, `audits\payment_limits.json`.

**Key names** — verdict `ARTEFACT`; new tools `check_row_position(column)`, `check_adjacency(col_a, col_b)`, `check_time_pattern(column)`; helpers `_chi2_sf`, `_fit`, `_is_even`, `_tie_probability`, `_off`; `POSITION`, `EVENT_TIME`, `CYCLES`; `load_rules(con, limits_path)`; `run_audit.py --limits`; `audit.json` -> `do_not_use.entries[]` = finding, kind (field | pattern), name, test, evidence.

**Results** — `run_audit.py --db ... --limits audits\payment_limits.json`: 4.5 s, 78 findings, 0 failures. CLEAN 26 · TRAP 3 · SIGNAL 18 · NOISE 14 · ARTEFACT 9 · INCONCLUSIVE 8. Two runs identical.
- TRAP (3, unchanged): `tx_id` 2,250 colliding IDs; `narr_rail` vs `mode` 48.90% disagree; 59,747 of 59,823 RTGS rows under the limit.
- ARTEFACT (9), 11 `do_not_use` entries:
  - `check_distribution:device` — even split (equal-split p 0.864) and two rare values with the same count (chance 0.0077).
  - `check_distribution:bank`, `ifsc_bank` — even split (p 0.726).
  - `check_time_pattern:ts` — flat by hour of day (p 0.989) and day of week (p 0.198).
  - `check_consistency:is_foreign_ip,is_headless` — identical on all rows.
  - `check_row_position:device`, `is_foreign_ip`, `is_headless` — 2,654 rare rows in 1 of 20 file segments; file is not in time order (50% of rows follow an earlier time).
  - `check_adjacency:dst,src` — 1,708 linked neighbours against 84.9 by chance (20x). `src,src` and `dst,dst`: chance level.
- `check_row_position:is_dup_tx_id` CLEAN (p 0.621): colliding IDs are spread through the file.
- `check_auditor_generic.py --db ...`: 0.7 s, 62 numbers and 71,411 words from the dataset, PASS on all three checks (literals, read-only, off-only). On a scratch copy with planted `1327`, `185.220.`, `RTGS`, `50` and a writable connect: FAIL, exit 1, all five found.

**Deviations**
- Rail amount limits name payment modes, so they cannot sit in `auditor\`. They moved to `audits\payment_limits.json` (domain reference) and are passed with `--limits`; without it the RTGS finding does not appear.
- `narr_rail` and `ifsc_bank` are now "leading letters" (no delimiter or length assumed). `ts_hour` was dropped; `check_time_pattern` replaces it.
- `max_categories` changed 50 -> 64 so that no rule equals the activity cut-off.
- Identical category columns that share labels (`bank` / `ifsc_bank`) stay CLEAN; only relabelled or true/false twins are ARTEFACT.
- The checker carries one hand-written number (50, the activity cut-off): it cannot be read from the data.
- `do_not_use` flags hour of day; the engine feature `odd_hour_share` uses it. Nothing was switched off here: the list is advice for the engine.

## 2026-10-03 — Task D1c: raw / engine layers, label-free funnel, agreement check

**Step** — `run_audit.py` split into two layers; new generic funnel (Stage A raw, Stage B agreement with scores); raw layer proven on a scratch database holding only `tx` and `accounts`.

**Files** — new `auditor\funnel.py`, `audits\funnel_roles.json`, `audits\check_auditor_raw_layer.py`; changed `auditor\run_audit.py`, `auditor\tools.py` (`load_rules(..., use_profile)`), `reports\json\audit.json`.

**Key names** — `--layer raw|engine|both` (default both); `--limits` defaults to `audits\payment_limits.json`, `--roles` to `audits\funnel_roles.json`; `plan_raw`, `plan_engine`; every finding has `layer`; `audit.json` -> `run.layers`, `rules.{raw,engine}`, `summary_by_layer.{layer}.{findings,funnel}`, `funnel.{semantics,groups,summary,stages[]}`; stage = id, stage (A | B), layer, question, sql, result, verdict, explanation. `funnel.GROUPS` = send_only, payees, next_hop, receive_only; `MEMBERS` (shared SQL), `stage_a`, `stage_b`, `load_role_map`.

**Results** — `run_audit.py --db ...`: 4.9 s, 78 findings, 5 funnel stages, 0 failures; two runs identical.
- raw: 50 findings — CLEAN 25 · TRAP 3 · SIGNAL 7 · NOISE 3 · ARTEFACT 9 · INCONCLUSIVE 3; funnel SIGNAL 4.
- engine: 28 findings — CLEAN 1 · SIGNAL 11 · NOISE 11 · INCONCLUSIVE 5; funnel CLEAN 1. Totals equal D1b.
- Funnel (observed only): 24,873 accounts -> 300 send-only -> 129 payees -> 559 next hop -> 385 receive-only.
  - send_only -> payees: 300 transfers, 0 elsewhere; 1 receiver per sender; no arrival, no ratio (money starts here).
  - payees -> next_hop: 1,327 transfers, 0 elsewhere; arrival to forward median 542 s (180-898); receivers per sender median 9 (3-32); out/in 0.980 (q1 = q3 = 0.980).
  - next_hop -> receive_only: 1,327 transfers, 0 elsewhere; median 1,035 s (123-1,799); receivers per sender median 2 (1-8); out/in 0.960 (min 0.959995, max 0.960005).
- Stage B: 24,873 of 24,873 accounts agree, 0 disagreements (300/300, 129/129, 559/559, 385/385).
- `check_auditor_raw_layer.py --db ...`: 10.4 s, 10 of 10 PASS; scratch db in %TEMP% had only `accounts`, `tx`; raw findings and funnel equal the raw layer on the full database; scratch deleted.
- `check_auditor_generic.py`: PASS on all three checks.

**Deviations**
- Role labels cannot sit in `auditor\`, so the group -> role map lives in `audits\funnel_roles.json` (passed by default). Without it Stage B shows the table and is INCONCLUSIVE.
- The raw layer never reads the scoring profile's `audit_rules`, so it answers the same before and after the engine runs; `rules` in `audit.json` is now keyed by layer. `ingest_meta` is still read for the file hash when present.
- Funnel stages are counted apart from findings (`n_findings` stays 78). The engine layer still holds only feature outliers plus Stage B; no new score checks were added.
- Arrival = the sender's latest incoming transfer at or before the forward; out/in uses the sender's total sent / total received.

## 2026-10-03 — Task D1d: gate consistency, score sanity, funnel labels

**Step** — two new engine-layer checks; funnel receiver counts relabelled and the arrival definition stated in every hop.

**Files** — new `auditor\engine_checks.py`, `audits\feature_lineage.json`; changed `auditor\run_audit.py` (`--lineage`), `auditor\funnel.py`, `auditor\tools.py` (`cycle` in time-pattern evidence), `auditor\audit_rules.json` (`near_threshold_points`), `reports\json\audit.json`.

**Key names** — `gate_consistency`, `score_sanity`, `profile_parameters`, `load_lineage`; finding ids `check_gate:<finding>|<test>`, `check_scores:final_index`; `funnel.MEMBER`, `ARRIVAL`, `RECEIVERS_LABEL`; hop result key `distinct_receivers_lifetime` (was `receivers_per_sender`), `arrival_definition`.

**Results** — `run_audit.py --db ...`: 7.7 s, 90 findings (raw 50 unchanged, engine 40), 5 funnel stages, 0 failures; two runs identical.
- engine: CLEAN 9 · TRAP 3 · SIGNAL 12 · NOISE 11 · INCONCLUSIVE 5.
- Gate consistency, 11 do_not_use entries: CLEAN 8, TRAP 3.
  - TRAP `device` too-even distribution and `device` identical rare counts: T7 (`device_consistency`, weight 5, no gate) still reads `device`.
  - TRAP `is_foreign_ip` / `is_headless` twins: MP3 (weight 15) and T7 (weight 5) both score them. MP7 and T5 inherit through neighbours' scores.
  - CLEAN: hour of day (ZP4 weight 0, disabled, gate closed); day of week, `bank`, `ifsc_bank`, row position x3, adjacency (no parameter uses them).
- Score sanity (observed): final index no group 0 (23,500); send_only 40; receive_only 70; next_hop 75-80, median 80; payees 85.9-87.4, median 87.4. No two groups overlap. 385 accounts within 5 points of the threshold 65: all receive_only at 70, all flagged.
- `check_auditor_generic.py` PASS x3; `check_auditor_raw_layer.py` 10 of 10 PASS.

**Deviations**
- What a feature reads cannot be derived inside `auditor\`, so it is a hand-written domain file (`audits\feature_lineage.json`, from the engine SQL). The gate check is only as good as that file; scored features missing from it make an entry INCONCLUSIVE.
- Only parameters with a feature list (mule, trust, zero-weight) are checked. Role-score weights, overrides and the trace's `narration_device` weight are not.
- T7 uses a distinct-device count, not device frequencies; it is TRAP under the literal rule "feature uses the field". Nothing was switched off: engine decision.
- Twin columns are TRAP only when two different live parameters read them. A closed gate counts as off even with weight > 0 (MP6); `gate_closed_but_weighted` marks that case.
- `--layer engine` alone has no do_not_use list, so the gate check is one INCONCLUSIVE finding there.
