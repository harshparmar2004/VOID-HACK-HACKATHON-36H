# Foundation review

Independent check of the database and engine scripts after the foundation fixes.
**No code, config, or data was modified. Nothing was committed.**
Checks ran on a copy, `%TEMP%\case_review.duckdb`, which was deleted after the queries.

| Field | Value |
|---|---|
| Written | 2026-10-02 15:43:07 |
| DuckDB | 1.5.6 |
| HEAD | `db740201deecfe630b6145f6e2cb4cd459f29092` |
| Database copy | `data\case.duckdb` → `%TEMP%\case_review.duckdb` (deleted) |
| Interpreter | `.venv\Scripts\python.exe` |

## Summary

| Check | Result | Note |
|---|---|---|
| 0 Git | PASS | Working tree changes are engine only. No `.csv` / `.duckdb` / `.parquet` tracked. |
| 1 Tables | PASS | All Section 9 tables except `features`. No `raw` / `l1_cand` / `l3_cand` / `t` / `acc`. |
| 2 tx | PASS | 2,000,000 rows, `tx_key` PK, 4,502 dup flags, 1,997,748 distinct `tx_id`. CSV match 0 mismatches. |
| 3 accounts | PASS | 24,873 rows, 10 banks, regex and bank prefix hold, no duplicate `acct_no`. |
| 4 ingest / rejects | PASS | Latest load 2,000,000 / 2,000,000 / 0. `rejects` is empty. |
| 5 scores | PASS | `mp1`–`mp8` and Section 9 columns present, no `m1`–`m10`, 0 rows. VICTIM accepted, L4 and duplicate PK rejected, then rolled back. |
| 6 layer_links | PASS | PK `(profile_id, tx_key)`. `L3_L1` rejected. 0 rows after rollback. |
| 7 rings / cases / outputs / banks | PASS | Columns match Section 9. All four tables have 0 rows. |
| 8 Profile vs spec | WARN | JSON and `config.yaml` are identical and match MP/Trust/Final/role numbers. T7 has no threshold; structuring has no reliability-gate row. |
| 9 Code review | WARN | No `tx_id` joins, no ground-truth reads, connections closed. `min(ifsc)` can hide a second IFSC. `CREATE TABLE IF NOT EXISTS` will not migrate an old `scores` table. |
| 10 Ingest timing | PASS | Latest `load_seconds` = 5.96 (under 60). |

## Files changed since HEAD

`git status --short` and `git diff --stat`:

| Path | State | Diff |
|---|---|---|
| `engine\ingest.py` | modified | 151 lines in the stat (with `schema.sql`, +143 / −72) |
| `engine\sql\schema.sql` | modified | same stat |
| `engine\config.yaml` | untracked | new |
| `engine\seed_profile.py` | untracked | new |

`engine\apply_schema.py` is tracked and unchanged since HEAD. It was read because the task named it.

`git ls-files "*.csv" "*.duckdb" "*.parquet" "data/*"` returned nothing.

## 0. Git

```
db740201deecfe630b6145f6e2cb4cd459f29092
 M engine/ingest.py
 M engine/sql/schema.sql
?? engine/config.yaml
?? engine/seed_profile.py
```

## 1. Tables

```sql
SHOW TABLES;
```

`accounts`, `bank_directory`, `case_outputs`, `cases`, `ingest_meta`, `layer_links`, `rejects`, `rings`, `scores`, `scoring_profiles`, `tx`.

`features` is absent, which is what Section 9's "not yet" status allows. No exploration tables.

## 2. tx

```sql
SELECT count(*) AS n, count(DISTINCT tx_key) AS keys,
       sum(is_dup_tx_id::INT) AS dup_rows,
       count(DISTINCT tx_id) AS ids
FROM tx;
-- 2000000, 2000000, 4502, 1997748
```

`duckdb_constraints()`: `PRIMARY KEY(tx_key)`.

Types: `amount_paise BIGINT`, `ts TIMESTAMP`, `tx_key BIGINT`.

Orphans: `src` and `dst` missing from `accounts.acct_id` = 0.

Flags vs the ingest definition (full table, not a sample):

```sql
-- mismatches: foreign 0, headless 0, reserved 0
-- counts: foreign 2654, headless 2654, reserved 0, 172.16-31 rows 0
```

Reserved rule in `engine\ingest.py` lines 64–73 includes `172.` with second octet 16–31, plus `0.0.0.0`, `10.`, `127.`, `192.168.`. The file contains no reserved address, so that branch is implemented but not exercised by a row.

Sample (ordered, not `USING SAMPLE`):

| tx_key | ip | device | foreign | headless | reserved |
|---|---|---|---|---|---|
| 2 | 185.90.141.148 | Web_Emulator | true | true | false |
| 3 | 194.159.153.195 | Linux_Script | true | true | false |
| 1 | 103.114.236.26 | Android | false | false | false |

CSV: loaded with `read_csv(..., all_varchar=true)` inside DuckDB. Joined on `tx_key` = CSV row number.

```sql
-- full_row_mismatches = 0
-- tx_id values absent from the CSV = 0
```

Five sampled rows, all `ok = true` (tx_id, sender, receiver, `amount_paise = round(Amount * 100)`, timestamp):

| tx_key | tx_id | amount_paise | Amount | ts |
|---|---|---|---|---|
| 563823 | TXN681052980 | 264535 | 2645.35 | 2026-09-24 23:01:12 |
| 17016 | TXN626068324 | 54326 | 543.26 | 2026-09-26 09:53:29 |
| 566884 | TXN947500787 | 35340 | 353.4 | 2026-09-26 19:33:49 |
| 565747 | TXN465832608 | 250570 | 2505.7 | 2026-09-23 13:50:34 |
| 17092 | TXN460564448 | 42741 | 427.41 | 2026-09-16 15:43:13 |

## 3. accounts

```sql
SELECT count(*) FROM accounts;                         -- 24873
SELECT count(DISTINCT bank) FROM accounts;             -- 10
SELECT count(*) FROM accounts
 WHERE NOT regexp_full_match(acct_no, '^[A-Z]{4}[0-9]{8}$');  -- 0
-- duplicate acct_no groups: 0
-- bank <> substr(acct_no,1,4): 0
-- bank <> substr(ifsc,1,4): 0
```

Banks: AIRP 2417, AXIS 2518, BARB 2440, HDFC 2496, ICIC 2468, IPOS 2528, KKBK 2523, PUNB 2492, PYTM 2453, SBIN 2538.

## 4. ingest_meta / rejects

Three loads, all 2,000,000 / 2,000,000 / 0. Latest is load_id 3:

| load_id | rows_total | rows_loaded | rows_rejected | load_seconds | loaded_at |
|---|---|---|---|---|---|
| 1 | 2000000 | 2000000 | 0 | 10.30 | 2026-10-02 06:28:48 |
| 2 | 2000000 | 2000000 | 0 | 10.84 | 2026-10-02 06:31:35 |
| 3 | 2000000 | 2000000 | 0 | 5.96 | 2026-10-02 15:32:46 |

```sql
SELECT count(*) FROM rejects;  -- 0
```

## 5. scores

Columns match Section 9 table 7, including `mp1`–`mp8`, `t1`–`t7`, `override_applied`, `victim_score`, `param_points`. No `m1`–`m10`. Row count 0.

CHECK: `role IS NULL OR role IN ('L1','L2','L3','UNCLASSIFIED_MULE','VICTIM')`.
PK: `(acct_id, profile_id)`.

Inside separate transactions, each rolled back:

| Statement | Result |
|---|---|
| `INSERT ... role 'VICTIM'` | ACCEPTED, then ROLLBACK |
| `INSERT ... role 'L4'` | REJECTED, CHECK constraint |
| two inserts of `(999999003, 'review_probe')` | REJECTED, duplicate key |

```sql
SELECT count(*) FROM scores;  -- 0 after the rollbacks
```

## 6. layer_links

Columns match Section 9. PK `(profile_id, tx_key)`. `tx_id` is a NOT NULL display column.

```sql
INSERT INTO layer_links (profile_id, tx_key, tx_id, link_type)
VALUES ('review_probe', 1, 'TXN000000000', 'L3_L1');
-- REJECTED: CHECK (link_type IN ('VICTIM_L1','L1_L2','L2_L2','L2_L3'))
```

A legal `L1_L2` insert was accepted and rolled back. Row count stayed 0.

## 7. rings, cases, case_outputs, bank_directory

Column lists match Section 9. Each `count(*)` is 0. `case_outputs` has no primary key; Section 9 does not require one.

## 8. scoring_profiles and config.yaml

```sql
SELECT profile_id, is_active, is_locked FROM scoring_profiles;
-- ('v1-verified', true, true)   one row
```

Parsed JSON versus `yaml.safe_load` of `engine\config.yaml`: **0 differences**.

Values that match Sections 4.1, 4.2, 4.3, 4.3b and 10:

| Item | In profile |
|---|---|
| MP1 | weight 20, full 0.90, half 0.60, windows 3–15 min and 60 min |
| MP2 | weight 15, full = (split 3–6 or single forward) AND ratio 0.94–0.99, half = ratio 0.90–0.99 |
| MP3 | weight 15, full 0.50, half 0.20, receive-only uses `flagged_in_share` |
| MP4 | weight 15, full ≤ 0.30× median, half ≤ 0.50× |
| MP5 | weight 10, full 0.80, half 0.40 |
| MP6 | weight 10, full = reciprocity 0 and one-directional, half ≤ 0.10 |
| MP7 | weight 10, full 60, half 40, pass 2 |
| MP8 | weight 5, full 20×, half 5× |
| ZP1–ZP5 | weight 0, enabled false (burst fan-in, shared IP, structuring, bot/odd-hour, cycles) |
| Trust | T1 25 / days ≥ 12, T2 20 / reciprocity ≥ 0.30, T3 15 / hold ≥ 24 h, T4 15 / diversity ≥ 0.90 and amount ≤ 2×, T5 15 / 100 − neighbour ≥ 80, T6 5 / recurring ≥ 0.30, T7 5 |
| Final | factor 0.5, override floor 70, flag 65, two-signal always on, min 2 of MP1–MP8 |
| Bands | high ≥ 85, suspected [65, 85), clean < 65 |
| Review | mule ≥ 65 and trust ≥ 60 |
| Roles | threshold 50, tie 10, victim ≥ 60. L1 30/25/20/15/10, L2 30/25/20/15/10, L3 40/30/20/10, VICTIM 35/30/25/10, outflow multiple 5 |
| Commission | MP2 0.94–0.99, L1 0.97–0.99, L2 0.94–0.97 |
| Cash-out | P2A, WALLET_LOAD, P2P_CRYPTO |
| Gates | rail mismatch, amount limits, hourly evenness, IP reuse — all `closed` |

Extras that do not contradict the spec: `never_score` NS1–NS5 (rail mismatch, amount vs mode, duplicate tx id, sub-3-min forwards, leakage fingerprints), `validation` sums of 100, and the dataset sha256 the profile was verified on.

### WARN — T7 has no threshold

Section 4.2 gives T7 weight 5 and no number. `config.yaml` lines 321–332 set `full_at: null`, `half_at: null`, `enabled: true`, `weight: 5`, and say the number was not invented.

**Suggested fix (not applied):** keep the weight in the profile but set `enabled: false` until `device_consistency` has a measured full/half, so a later scorer cannot treat null as "always full" or "always zero" by accident. The same `half_at: null` pattern is used for T1–T6 because Section 4.2 only states the full point; `config.yaml` lines 251–254 tell `scoring.py` to treat that as a step. That part matches the spec.

### WARN — structuring is not a reliability gate

Section 10 names structuring alongside rail mismatch, amount limits, odd hours, and shared IP, and says every gate on this file is closed. The profile disables ZP3 (`enabled: false`, weight 0, lines 194–204) but `reliability_gates` has no structuring entry. The other four gates are present and `closed`.

**Suggested fix (not applied):** add a `gate_structuring` row with `status: closed` and the measured rate, and point ZP3 at it, the same way ZP2 points at `gate_ip_reuse`. Until that rate exists, leaving ZP3 at weight 0 is safe; it just is not the gate mechanism Section 10 describes.

## 9. Code review

Read: `engine\ingest.py`, `engine\sql\schema.sql`, `engine\apply_schema.py`, `engine\config.yaml`, `engine\seed_profile.py`.

| Looked for | Result |
|---|---|
| Join or key on `tx_id` alone | Not found. `tx` PK is `tx_key`. `layer_links` PK is `(profile_id, tx_key)`. `is_dup_tx_id` is `count(*) OVER (PARTITION BY Transaction_ID) > 1` (`ingest.py` line 164), which flags both copies and does not join on the id. |
| Ground-truth labels or leakage used to select rows | Not found. NS5 in `config.yaml` lines 242–248 names the forbidden account-tail band and the 1,327 counts as things that must never be scored. No label file is opened. |
| `ABS`, padding, fake timestamps, silent row drops | No `ABS`. Bad rows go to `rejects` with a reason. `narr_flags` and `utr` are explicit NULL (`ingest.py` lines 252–253), not guessed. |
| Network calls | None. |
| Paths | `ingest.py` lines 37–38 and `seed_profile.py` lines 26–27 use `Path(__file__)`. `apply_schema.py` lines 20–21 use `os.path.abspath(__file__)`, which is the same root, not a personal path. |
| Unclosed connections | All three scripts use `try` / `finally: con.close()`. |
| Python loops over transaction rows | None. The sha256 helper loops over 1 MiB chunks. |

### WARN — `min(ifsc)` can hide a second IFSC

`engine\ingest.py` lines 188–195:

```sql
SELECT acct_no, min(ifsc) AS ifsc, min(ts), max(ts)
FROM sides
GROUP BY acct_no
```

On this file every account has one IFSC, so the loaded `accounts` table is fine (check 3). If a future file gave one account two IFSCs, the row would load and the second IFSC would disappear with no reject.

**Suggested fix (not applied):** quarantine `acct_no` values with `count(DISTINCT ifsc) > 1` instead of taking `min(ifsc)`.

### WARN — `CREATE TABLE IF NOT EXISTS` does not migrate

`schema.sql` and `apply_schema.py` only create missing tables. The copy reviewed here already has the new `scores` and `layer_links` shapes, so the data checks pass. An older `scores` table (with `m1`–`m10`) would be left in place, and `apply_schema.py` would report it as already present.

**Suggested fix (not applied):** a one-shot migration, or drop-and-recreate of the empty fixed tables when `information_schema.columns` does not match. Do not `CREATE OR REPLACE` a table that already holds another profile's rows.

## 10. Ingest timing

Latest `ingest_meta.load_seconds` = **5.9586** (load_id 3, 2026-10-02 15:32:46). Under 60. The two earlier loads were 10.30 s and 10.84 s, also under 60.
