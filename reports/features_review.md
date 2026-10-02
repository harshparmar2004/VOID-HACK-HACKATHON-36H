# Features review

Independent check of the `features` table built by `engine\features.py` and `engine\sql\features.sql`.
**No code, config, or data was modified. Nothing was committed.**
Checks ran on a copy, `%TEMP%\case_review.duckdb`, which was deleted after the queries. The live `data\case.duckdb` was not opened.

The Features-table section is pages 7–8 of `Final_Parameters_Spec_Abhedya-Chakra.pdf`. That PDF is not in `docs\` or the project root; it was read from `Downloads`. Column names below are taken from that section.

| Field | Value |
|---|---|
| Written | 2026-10-02 16:25:55 |
| DuckDB | 1.5.6 |
| HEAD | `fdd70be28ed8838667b9864a7816d5cf3d1bbead` |
| Database copy | `data\case.duckdb` (169,619,456 bytes, no WAL) → `%TEMP%\case_review.duckdb` (deleted) |
| Interpreter | `.venv\Scripts\python.exe` |
| Active profile | `v1-verified`, locked. Windows 3–15 min and ≤ 60 min. Cash-out `P2A`, `WALLET_LOAD`, `P2P_CRYPTO`. |

## Summary

| Check | Result | Note |
|---|---|---|
| 0 Git | PASS | New feature files are untracked. One unrelated context-line edit. No data files in git. |
| 1 Table | PASS | `features` has 24,873 rows, unique `acct_id`, exact match to `accounts` both ways. |
| 2 Columns | FAIL | Every spec column is present with a sensible type. Nulls also appear outside the four allowed columns (undefined measurements, not missing accounts). |
| 3 Consistency | PASS | `n_in + n_out = tx_count` everywhere. Both direction sums are 2,000,000. Days 1–15. Shares and commission stay in 0–1. |
| 4 Structure | WARN | Send-only 300, receive-only 385, group A 129, group B 559. Commission, splits, and flagged shares match. Normal reciprocity median is 0, not > 0. |
| 5 Code review | WARN | Paths are from the project root, the connection is closed, and the table is `CREATE OR REPLACE`. Allocation does not double-count. Windows and cash-out come from the profile. Joins use `tx_key`. Definitions below differ from the spec. |
| 6 Timing | PASS | No database-path argument, so `features.py` was not rerun (it would write `data\case.duckdb`). Last printed run: SQL 2.06 s, total 2.52 s. |

## Files changed since HEAD

`git status --short` and `git diff --stat HEAD` on `fdd70be` (`Project_context_added`, 2026-10-02 16:00:35):

| Path | State | What it is |
|---|---|---|
| `engine\features.py` | untracked | Builds `features`. |
| `engine\sql\features.sql` | untracked | `CREATE OR REPLACE` measurement query. |
| `audits\check_features.py` | untracked | Read-only cohort script. Opens the live DB with `read_only=True`. |
| `Untitled1.ipynb` | untracked | Scratch notebook. Not used as evidence. |
| `PROJECT_CONTEXT.md` | modified | One line in Section 9: account shape corrected from "12 digits" to "4-letter bank code + 8 digits". Not part of the features build. |

`git diff --stat`: `PROJECT_CONTEXT.md | 2 +-`.

## 0. Git

Working tree is the features step on top of the foundation commit. No `.csv`, `.duckdb`, or `.parquet` is tracked. The features script was not re-run for this review; the table already in the copied database was queried.

## 1. Table

`SHOW TABLES` includes `features` plus the other eleven Section 9 tables.

| Measure | Value |
|---|---|
| `count(*)` | 24,873 |
| `count(DISTINCT acct_id)` | 24,873 |
| `accounts` rows | 24,873 |
| `features` acct_id missing from `accounts` | 0 |
| `accounts` acct_id missing from `features` | 0 |
| `tx` rows (unchanged) | 2,000,000 |

## 2. Columns

Spec columns all exist. The only extra column is `acct_id` (INTEGER), the key the spec implies by "one row per account".

| Column | Type |
|---|---|
| `acct_id` | INTEGER |
| `tx_count`, `n_in`, `n_out`, `days_active`, `shared_ip_cluster_size` | BIGINT |
| `is_send_only`, `is_receive_only`, `in_cycle` | BOOLEAN |
| every share, ratio, lag, hold, diversity, `amount_vs_population`, `device_consistency`, `neighbour_risk` | DOUBLE |

`config.yaml` also names `burst_fan_in` (ZP1) and `ip_churn` (ZP4). Those names are not in the spec's Features table, and they are not columns here. Scoring will fail if it selects them. Weight is 0 and both parameters are disabled, so this does not affect v1 scores until someone enables them.

### NULL counts

The review rule allows nulls only in `upstream_l1_share`, `upstream_l2_share`, `neighbour_risk`, and `in_cycle`. Those four are null on all 24,873 rows, which is correct: pass 2 has not run, and `in_cycle` is an explicit placeholder (`features.sql` lines 331–338).

Other nulls, all systematic:

| Column | Nulls | Who |
|---|---|---|
| `forward_lag_median_s`, `split_count_median`, `commission_ratio_median` | 692 | 300 send-only + 385 receive-only + 7 normal accounts with no window-valid forward |
| `flagged_out_share`, `device_consistency`, `shared_ip_cluster_size`, `structuring_share` | 385 | receive-only (`n_out = 0`) |
| `flagged_in_share`, `median_hold_hours`, `recurring_sender_share`, `victim_inflow_share` | 300 | send-only (`n_in = 0`) |
| `timing_regularity` | 1,022 | fewer than two outflow gaps |

No nulls in `tx_count`, `n_in`, `n_out`, `days_active`, `pass_through_share`, `reciprocity`, `amount_vs_population`, `amount_diversity`, or `odd_hour_share`.

This fails the stated null rule. The nulls are "no such events", not dropped accounts. `pass_through_share` already uses 0 for that case (including all 300 send-only accounts). Medians of an empty set were left null on purpose (`features.py` lines 59–78). Suggested fix: keep nulls for empty medians, and extend the allowed-null list to these columns. Do not fill commission with 0.

## 3. Consistency

| Check | Result |
|---|---|
| `n_in + n_out <> tx_count` | 0 rows |
| `sum(n_in)` | 2,000,000 |
| `sum(n_out)` | 2,000,000 |
| `days_active` outside 1–15 | 0 (min 1, max 15) |
| `is_send_only` disagrees with `n_in = 0 AND n_out > 0` | 0 |
| `is_receive_only` disagrees with `n_out = 0 AND n_in > 0` | 0 |
| `*_share` and `pass_through_share` outside 0–1 | 0 on every such column |
| `commission_ratio_median > 1` | 0 (max 0.980000157) |

Send-only `pass_through_share` is 0 for all 300, not 1. The earlier `least(1.0, NULL)` bug is fixed (`features.sql` lines 298–303).

Commission is not bit-exact 0.98. Group A sits between 0.979999845 and 0.980000157, which is integer-paise rounding of a 0.98 ratio.

## 4. Structure sanity

Cohorts are defined only from who sends to whom. Group A: every distinct sender is send-only. Group B: receives from group A. "Any sender in group A" and "every sender in group A" are the same 559 accounts. Group A does not overlap group B or the receive-only set.

| Cohort | n | tx median (min–max) | commission median (min–max) | split median (min–max) | pass-through median (min–max) | flagged out | flagged in | victim inflow | reciprocity |
|---|---|---|---|---|---|---|---|---|---|
| Send-only | 300 | 1 (1–1) | null | null | 0 | 0 | null | null | 0 |
| Group A | 129 | 11 (4–41) | 0.980 (0.980–0.980) | 4 (3–6) | 0.980 (0.980–0.980) | 1 for all | 0 | 1 for all | 0 for all |
| Group B | 559 | 4 (2–16) | 0.960 (0.960–0.960) | 1 (1–1) | 0.960 (0.456–0.960) | 1 for all | 1 for all | 0 | 0 for all |
| Receive-only | 385 | 3 (1–9) | null | null | 0 | null | 1 for all | 0 | 0 |
| Normal (the rest) | 23,500 | 170 (123–221) | 0.361 | 1 (1–1.5) | 0.037 (0–0.194) | 0 for all | 0 for all | 0 | median 0 |

Group A split values are 3, 3.5, 4, 4.5, 5, 5.5, 6 (DuckDB averages the two middle values when the count is even). None are outside 3–6. Zero group-A accounts have pass-through below 0.9.

Group B medians match (~0.96, split 1, flagged out 1). Five of the 559 have pass-through below 0.9 even though each still has commission 0.96 and `n_in = n_out`:

| pass-through | commission | n_in | n_out | tx_count |
|---|---|---|---|---|
| 0.4557 | 0.96 | 3 | 3 | 6 |
| 0.5457 | 0.96 | 4 | 4 | 8 |
| 0.6842 | 0.96 | 6 | 6 | 12 |
| 0.7232 | 0.96 | 3 | 3 | 6 |
| 0.8575 | 0.96 | 4 | 4 | 8 |

`commission_ratio_median` only sees inflows that produced a window-valid forward. `pass_through_share` divides by all inflow amount, so an outflow outside the window lowers the total and leaves the median ratio at 0.96. Not a failure of the medians that were requested.

Normal flagged shares are exactly 0 (0 accounts with either share above 0). Activity is separated: low-activity maxima are 1 / 41 / 16 / 9, normal minimum is 123.

Normal reciprocity does **not** match the expectation "> 0". Recomputed from `tx` with the same definition (share of counterparties seen in both directions): 0 mismatches on 24,873 accounts. Among the 23,500 normal accounts, 17,234 are exactly 0, 6,266 are above 0, the 90th percentile is 0.0062, and the max is 0.0267. An account can both send and receive and still have reciprocity 0 when no counterparty does both. MP6's full rule also requires one-directional status (`is_send_only` or `is_receive_only`). The half rule "reciprocity ≤ 0.10" would be true for every normal account. That is a scoring concern for the next step, not a bad column.

Receive-only `median_hold_hours` median is 190 hours (range 3–358) because an inflow with no outflow is closed at `max(ts)` of the whole table (`features.sql` lines 184–191). Group A median hold is 0.08 h and group B is 0.28 h. Normal median hold is 161 h.

## 5. Code review

Read: `engine\features.py`, `engine\sql\features.sql`, `audits\check_features.py`, and the one-line `PROJECT_CONTEXT.md` diff. `config.yaml` was read only to compare feature names. It was not modified.

### What holds

- **One outflow, one inflow.** `row_number() OVER (PARTITION BY out_key ORDER BY in_ts, in_key)` keeps the earliest candidate (`features.sql` lines 118–127). A running sum then drops any outflow that would push that inflow over its amount (`lines 128–138`). Per-inflow out/in cannot exceed 1, and the same outflow cannot be counted twice. Group A at 0.98 with none below 0.9 shows the cap is not eating the verified splits.
- **Not quite "earliest unmatched".** If the earliest inflow has no room left, the outflow is dropped. It is not offered to the next inflow (`features.sql` lines 34–37). That can only under-count pass-through. The five group-B rows above are the kind of gap this causes; this review did not re-allocate those flows to prove it.
- **Windows and cash-out come from the active profile**, not from literals in the SQL. `sql_params` reads `windows.split_forward_minutes`, `windows.single_forward_max_minutes`, and `cashout_categories` (`features.py` lines 96–117). The copied profile has 3, 15, 60, and `P2A` / `WALLET_LOAD` / `P2P_CRYPTO`. Categories that are not plain tokens are rejected. The SQL file uses `$placeholders`. The comment block says `$$`; that is comment-only and did not affect substitution.
- **Joins use `tx_key` and `acct_id`.** `tx_id` appears only in a comment. No join on `tx_id`.
- **No forbidden shortcuts.** No ground-truth file, no account-number range, no 1,327 device count, no population device thirds used as a filter.
- **No transaction loop, no network.** Python loops over profile rows, category names, and column names. `memory_limit` is 3GB.
- **Paths from the project root.** `ENGINE_DIR = Path(__file__).resolve().parent` and `ROOT = ENGINE_DIR.parent` (`features.py` lines 33–36). `DB_PATH` and `SQL_PATH` are derived from those. No hard-coded personal directory.
- **Connection closed.** `con.close()` is in a `finally` block (`features.py` lines 192–193). `audits\check_features.py` does the same at lines 202–203.
- **Safe to rerun.** `CREATE OR REPLACE TABLE features AS` (`features.sql` line 39). A second run replaces the table instead of appending.
- **Audit script** `audits\check_features.py` is read-only and uses the same structural cohorts. It does not enforce the null rule.

### Spec mismatches (not changed)

1. **`recurring_sender_share` counts transactions, not days.** Spec: inflow share from senders seen on ≥ 3 different days. Code: `n_from_cp >= 3` transactions (`features.sql` lines 213–218, constant `RECURRING_MIN_TX = 3`). Recomputed both ways: the stored column matches the transaction-count definition on all 24,573 accounts that have it, and the two definitions differ for 4 accounts. Small on this file, still the wrong rule.
2. **`device_consistency` is not the spec's boolean.** Spec: 1 if one device family and domestic IPs only. Code: modal outgoing-device share, IP ignored (`features.sql` lines 220–230). Range is 0.333–1. Exactly 988 accounts are 1.0: the 300 send-only accounts plus all 688 group-A and group-B senders. All 688 of those senders also have a foreign IP, so the spec's domestic-only clause would score them 0, not 1. Normal accounts sit near one third, which is the generator's even device split showing up as a per-account ratio. This is not the forbidden population count, but it will separate mules from normal accounts for a reason the spec said was weak.
3. **`median_hold_hours` imputes the dataset's last timestamp** when nothing was forwarded. Receive-only sinks then look like multi-day holders (median 190 h). T3 full is ≥ 24 h, so this would give sinks trust points for balance retention. Spec wording is "inflow to next outflow"; there is no next outflow.
4. **`measure_before_burst: true` is not applied.** Trust features are lifetime totals. Scoring cannot recover the pre-burst window from these columns.
5. **These cut-offs are hard-coded**, and the file says so (`features.py` lines 41–57): victim-like max outflows 3, recurring minimum 3, odd hours 1–5, round unit ₹1,000. On this file every send-only account has exactly one outflow, so the cap of 3 does not change group A. The spec's "single large outflow" amount test (≥ 5× population median) is not applied; it would also not change this file (send-only `amount_vs_population` median is 317).
6. **`split_count_median` counts allocated outflows, not distinct receivers** (spec wording). Group A still falls in 3–6.
7. **`structuring_share` is only "amount divisible by ₹1,000"** on outflows. The spec's near-limit and equal-split parts are not measured. Weight 0.
8. **`in_cycle` is null** until a later graph step. Allowed by the null rule. `burst_fan_in` and `ip_churn` are absent, as noted above.

## 6. Timing

`features.py` has no database-path argument. `DB_PATH` is fixed at line 36, and `main` connects to it at line 128. There is no `argparse` and no `sys.argv`. Rerunning it on the temp copy is not possible without editing the script, and running it as written would `CREATE OR REPLACE` `features` in the live `data\case.duckdb`. It was not run.

Last stdout, from the build after the send-only `pass_through_share` fix (the table this review measured):

```
sql seconds  : 2.06
total seconds: 2.52
```

Rows printed in that same run: 24,873. Windows printed: split 180–900 s, single ≤ 3600 s.

## FAIL and WARN evidence

Cohort views used by the queries below (on the temp copy only):

```sql
CREATE TEMP VIEW send_only AS
    SELECT acct_id FROM features WHERE is_send_only;
CREATE TEMP VIEW in_edge AS
    SELECT DISTINCT dst AS acct, src AS sender FROM tx;
CREATE TEMP VIEW group_a AS
    SELECT e.acct FROM in_edge e
    GROUP BY e.acct
    HAVING count(*) = count(*) FILTER (
        WHERE e.sender IN (SELECT acct_id FROM send_only));
CREATE TEMP VIEW group_b AS
    SELECT DISTINCT e.acct FROM in_edge e
    WHERE e.sender IN (SELECT acct FROM group_a);
```

### Check 2 — FAIL — nulls outside the four allowed columns

Query (null count of every column; same expression `features.py` prints at lines 156–159):

```sql
SELECT count(*) - count("forward_lag_median_s") AS forward_lag_median_s,
       count(*) - count("split_count_median") AS split_count_median,
       count(*) - count("commission_ratio_median") AS commission_ratio_median,
       count(*) - count("flagged_out_share") AS flagged_out_share,
       count(*) - count("flagged_in_share") AS flagged_in_share,
       count(*) - count("median_hold_hours") AS median_hold_hours,
       count(*) - count("recurring_sender_share") AS recurring_sender_share,
       count(*) - count("device_consistency") AS device_consistency,
       count(*) - count("victim_inflow_share") AS victim_inflow_share,
       count(*) - count("shared_ip_cluster_size") AS shared_ip_cluster_size,
       count(*) - count("structuring_share") AS structuring_share,
       count(*) - count("timing_regularity") AS timing_regularity,
       count(*) - count("upstream_l1_share") AS upstream_l1_share,
       count(*) - count("upstream_l2_share") AS upstream_l2_share,
       count(*) - count("neighbour_risk") AS neighbour_risk,
       count(*) - count("in_cycle") AS in_cycle
FROM features;
```

Output:

```
692, 692, 692, 385, 300, 300, 300, 385, 300, 385, 385, 1022, 24873, 24873, 24873, 24873
```

Every other column had null count 0, including `pass_through_share`.

File: `engine\sql\features.sql` lines 304–314 (`forward_lag_median_s`, `split_count_median`, `commission_ratio_median`, and the `CASE` that leaves `flagged_*_share` null when the denominator is 0) and lines 319–338 (hold, recurring, device, victim share, shared IP, structuring, timing, and the four allowed placeholders). `engine\features.py` lines 61–77 lists those extra columns as expected nulls, which is wider than this review's rule.

Suggested fix (not applied): keep null for an empty median, and add those columns to the allowed-null list in the spec. Do not write 0 into `commission_ratio_median` or `forward_lag_median_s`.

### Check 4 — WARN — normal reciprocity is not > 0

Query:

```sql
SELECT median(reciprocity),
       quantile_cont(reciprocity, 0.9),
       max(reciprocity),
       count(*) FILTER (WHERE reciprocity = 0),
       count(*) FILTER (WHERE reciprocity > 0)
FROM features
WHERE NOT is_send_only AND NOT is_receive_only
  AND acct_id NOT IN (SELECT acct FROM group_a)
  AND acct_id NOT IN (SELECT acct FROM group_b);
```

Output: `(0.0, 0.006172839506172839, 0.026737967914438502, 17234, 6266)`.

The column matches its SQL definition. Recompute from `tx`:

```sql
WITH cp AS (
    SELECT src AS acct, dst AS cp, 'out' AS dir FROM tx
    UNION ALL
    SELECT dst, src, 'in' FROM tx
),
d AS (
    SELECT acct, cp,
           max(CASE WHEN dir = 'out' THEN 1 ELSE 0 END) AS is_out,
           max(CASE WHEN dir = 'in' THEN 1 ELSE 0 END) AS is_in
    FROM cp GROUP BY 1, 2
),
r AS (
    SELECT acct, sum(is_out * is_in)::DOUBLE / count(*) AS reciprocity
    FROM d GROUP BY acct
)
SELECT count(*),
       count(*) FILTER (WHERE abs(f.reciprocity - r.reciprocity) > 1e-9)
FROM features f JOIN r ON r.acct = f.acct_id;
```

Output: `(24873, 0)`.

File: `engine\sql\features.sql` lines 193–206. The formula is the share of counterparties with both directions, so a two-way account can still score 0.

Suggested fix (not applied): do not change the column. When MP6 is scored, require one-directional status for the full rule, and do not treat "reciprocity ≤ 0.10" as a half-signal on this file, because all 23,500 normal accounts are under 0.03.

### Check 5 — WARN — earliest inflow is not re-offered

No separate probe query. The behaviour is the comment and the filter:

`engine\sql\features.sql` lines 34–37: an outflow rejected for capacity "is not re-offered to a later inflow". Line 137: `SELECT * FROM capped WHERE cum_out <= in_amt`.

Evidence that some group-B totals are lower than the per-inflow median:

```sql
SELECT round(pass_through_share, 4),
       round(commission_ratio_median, 4),
       n_in, n_out, tx_count
FROM features
WHERE acct_id IN (SELECT acct FROM group_b)
  AND pass_through_share < 0.9
ORDER BY pass_through_share;
```

Output:

```
(0.4557, 0.96, 3, 3, 6)
(0.5457, 0.96, 4, 4, 8)
(0.6842, 0.96, 6, 6, 12)
(0.7232, 0.96, 3, 3, 6)
(0.8575, 0.96, 4, 4, 8)
```

Suggested fix (not applied): if the earliest inflow has no remaining amount, assign the outflow to the next earliest inflow that still has room.

### Check 5 — WARN — recurring senders are counted by transactions, not days

File: `engine\features.py` lines 51–52 (`RECURRING_MIN_TX = 3`) and `engine\sql\features.sql` lines 213–218 (`n_from_cp >= $recurring_min_tx`). Spec text: senders seen on ≥ 3 different days.

Query:

```sql
WITH by_cp AS (
    SELECT dst AS acct, src AS cp,
           count(*) AS n_tx,
           count(DISTINCT CAST(ts AS DATE)) AS n_days
    FROM tx
    GROUP BY 1, 2
),
agg AS (
    SELECT acct,
           sum(CASE WHEN n_tx >= 3 THEN n_tx ELSE 0 END)::DOUBLE / sum(n_tx) AS by_tx,
           sum(CASE WHEN n_days >= 3 THEN n_tx ELSE 0 END)::DOUBLE / sum(n_tx) AS by_days
    FROM by_cp
    GROUP BY acct
)
SELECT count(*),
       count(*) FILTER (WHERE abs(f.recurring_sender_share - a.by_tx) > 1e-9),
       count(*) FILTER (WHERE abs(a.by_tx - a.by_days) > 1e-6),
       median(a.by_tx), median(a.by_days)
FROM features f
JOIN agg a ON a.acct = f.acct_id
WHERE f.recurring_sender_share IS NOT NULL;
```

Output: `(24573, 0, 4, 0.0, 0.0)`. The stored column matches the transaction-count rule. The day rule differs on 4 accounts.

Suggested fix (not applied): `count(DISTINCT CAST(ts AS DATE)) >= 3` instead of `count(*) >= 3`.

### Check 5 — WARN — `device_consistency` ignores the domestic-IP clause

File: `engine\sql\features.sql` lines 220–230. Modal outgoing-device share only. No join to `is_foreign_ip`.

Query:

```sql
SELECT min(device_consistency), max(device_consistency),
       count(*) FILTER (WHERE device_consistency IS NOT NULL
                        AND device_consistency NOT IN (0.0, 1.0)),
       count(*) FILTER (WHERE device_consistency = 1.0),
       count(*) FILTER (WHERE device_consistency IS NULL)
FROM features;
```

Output: `(0.3333333333333333, 1.0, 23500, 988, 385)`.

```sql
WITH foreign_sender AS (
    SELECT DISTINCT src AS acct FROM tx WHERE is_foreign_ip
)
SELECT count(*) FILTER (WHERE device_consistency = 1),
       count(*) FILTER (WHERE device_consistency = 1
                        AND acct_id IN (SELECT acct FROM foreign_sender)),
       count(*) FILTER (WHERE device_consistency = 1 AND is_send_only),
       count(*) FILTER (WHERE device_consistency = 1
                        AND acct_id IN (SELECT acct FROM group_a)),
       count(*) FILTER (WHERE device_consistency = 1
                        AND acct_id IN (SELECT acct FROM group_b))
FROM features;
```

Output: `(988, 688, 300, 129, 559)`. All 688 foreign senders with consistency 1.0 are group A plus group B.

Suggested fix (not applied): set the column to 1 only when every outgoing row shares one device and none has `is_foreign_ip`; otherwise 0.

### Check 5 — WARN — unforwarded inflows are closed at the dataset's last timestamp

File: `engine\sql\features.sql` line 187, `coalesce(f.first_out_ts, (SELECT max(ts_sec) FROM tx))`.

Query (receive-only hold), from the cohort stat:

```sql
SELECT median(median_hold_hours), min(median_hold_hours), max(median_hold_hours)
FROM features WHERE is_receive_only;
```

Output: `(190.09972222222223, 3.036111111111111, 358.1411111111111)`.

Suggested fix (not applied): leave `median_hold_hours` null when an inflow has no later outflow. Do not substitute `max(ts)`.

### Check 5 — WARN — `measure_before_burst` is unused

File: `engine\config.yaml` line 259, `measure_before_burst: true`. Confirmed on the copy:

```sql
SELECT json_extract_string(definition, '$.trust_index.measure_before_burst')
FROM scoring_profiles WHERE is_active;
```

Output: `true`.

`features.sql` has no burst cutoff. `days_active`, `reciprocity`, `median_hold_hours`, `amount_diversity`, `recurring_sender_share`, and `device_consistency` are computed on the whole history.

Suggested fix (not applied): either restrict those aggregates to the period before the account's first window-valid forward, or drop the flag until scoring stores both windows.

### Check 5 — WARN — measurement cut-offs are hard-coded

File: `engine\features.py` lines 50–57.

```
VICTIM_LIKE_MAX_OUTFLOWS = 3
RECURRING_MIN_TX = 3
ODD_HOUR_FROM = 1
ODD_HOUR_TO = 5
ROUND_UNIT_PAISE = 100_000
```

They are passed into the template at lines 112–116. They are not read from `v1-verified`. The pass-through windows and the cash-out list are read from the profile (lines 98–111); that part passes.

Send-only outflow check:

```sql
SELECT min(n_out), max(n_out), count(*) FILTER (WHERE n_out = 1)
FROM features WHERE is_send_only;
```

Output: `(1, 1, 300)`. The hard-coded cap of 3 does not change who is victim-like on this file. The spec's "large outflow" test is also absent (`features.sql` lines 236–239 test only `n_in = 0`, `n_out > 0`, and `n_out <= $victim_max_out`).

Suggested fix (not applied): move these four constants into `config.yaml` and add the ≥ 5× amount test to `victim_like`.

### Check 5 — WARN — split count is not distinct receivers

File: `engine\sql\features.sql` line 160, `count(*) AS split_count`. The destination account is not in the `valid` rows. Spec: median distinct receivers per inflow.

Group A still lands in 3–6:

```sql
SELECT split_count_median, count(*)
FROM features WHERE acct_id IN (SELECT acct FROM group_a)
GROUP BY 1 ORDER BY 1;
```

Output: `(3.0, 16), (3.5, 8), (4.0, 44), (4.5, 17), (5.0, 27), (5.5, 6), (6.0, 11)`.

Suggested fix (not applied): carry the counterparty into `valid` and use `count(DISTINCT cp)`.

### Check 5 — WARN — structuring is only a round-amount share

File: `engine\sql\features.sql` lines 261–266. `amount_paise % $round_unit_paise = 0` on outflows. No near-limit test and no equal-split test. Weight in the profile is 0.

Suggested fix (not applied): leave the column until the zero-weight parameter is enabled, then add the other two structuring tests. Do not score it as if those tests existed.

### Check 5 — WARN — profile names two columns the table does not have

`DESCRIBE features` has every Features-table spec column and no extras besides `acct_id`. It does not have `burst_fan_in` or `ip_churn`.

File: `engine\config.yaml` line 175 (`features: [burst_fan_in]`) and line 209 (`features: [timing_regularity, odd_hour_share, ip_churn]`). Both parameters are `enabled: false` and weight 0.

Suggested fix (not applied): add the two columns, or remove those names from the profile, before either parameter can be turned on.
