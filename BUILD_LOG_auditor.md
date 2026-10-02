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
