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
