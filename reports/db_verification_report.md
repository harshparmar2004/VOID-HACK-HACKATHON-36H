# Database verification report — Operation "Abhedya-Chakra"

Independent review of `data\case.duckdb` and ingest/schema scripts against
`PROJECT_CONTEXT.md` Sections 7–9. **No project code was modified. No writes
were made to `data\case.duckdb`.** All DuckDB checks ran against a copy.

| Field | Value |
|---|---|
| Report written | 2026-10-02 07:20:36 (local) |
| Checks executed | 2026-10-02 07:17:02 (local) |
| DuckDB version | **1.5.6** (`duckdb.__version__` / `SELECT version()` → `v1.5.6`) |
| Source DB | `C:\Users\ROG\Cyber_svvv_project\data\case.duckdb` |
| Source DB size | 149,958,656 bytes (143.01 MiB) |
| Source DB mtime | 2026-10-02 07:03:18 (unchanged after this review) |
| Copy used | `%TEMP%\case_verify.duckdb` (same size; deleted after this report) |
| CSV | `data\VoidHacks8_MuleAccount_2M_Transactions.csv` |
| CSV size | 286,788,986 bytes (273.50 MiB) |
| CSV row count | **2,000,000** (`read_csv(..., all_varchar=true, header=true)`) |
| Python | `.venv\Scripts\python.exe` |
| Scope | `engine\sql\schema.sql`, `engine\ingest.py`, `engine\apply_schema.py` + DB copy |
| Not touched | `abhedya\`, `data\case.duckdb`, engine source |

---

## Summary

| Check | Result | Note |
|---|---|---|
| A — Tables exist | **WARN** | 11 of 12 spec tables present; **`features` missing** (later pipeline step). Leftover `raw` (not an error). |
| B — Columns and types | **PASS** | Present tables match Section 9 types/PKs/lists. `features` N/A. |
| C — Constraints | **PASS** | Role `L4`, link_type `L3_L1`, and duplicate scores PK all rejected; each rolled back on the copy. |
| D — Ingestion integrity | **FAIL** | Loaded+rejected = CSV; sample-10 and flags OK; **0 of 24,873 `acct_no` are 12 digits** (all `AAAA########`, matching the CSV; not padded). |
| E — Code review | **WARN** | Guardrails 1–3, 6, 10, 15, 17 largely held; `RE_ACCT` loosened vs Section 9; `is_reserved_ip` omits `172.16/12` and link-local. |

---

## Check A — Tables exist

**Query:** `SHOW TABLES`

**Result (12 names, alphabetical):**

```
accounts, bank_directory, case_outputs, cases, ingest_meta,
layer_links, raw, rejects, rings, scores, scoring_profiles, tx
```

Compared with the 12 Section 9 tables:

| Spec table | Status |
|---|---|
| ingest_meta | present |
| rejects | present |
| accounts | present |
| tx | present |
| **features** | **missing** |
| scoring_profiles | present |
| scores | present |
| layer_links | present |
| rings | present |
| cases | present |
| case_outputs | present |
| bank_directory | present |

- **Present:** 11 / 12
- **Missing:** `features`
- **Unexpected (not leftovers):** none
- **Exploration leftovers:** `raw` (see last section)

`features` is a derived table owned by a later step (Section 9 build order:
ingest → features → scoring). Section 13 still lists features as next work.
Missing at this stage is expected, but it is still a gap vs the 12-table spec.

**Verdict: WARN**

---

## Check B — Columns and types

**Query:** `DESCRIBE <table>` for every Section 9 table that exists, plus
`SELECT table_name, constraint_type, constraint_text, constraint_column_names
FROM duckdb_constraints() WHERE schema_name = 'main'`.

### Special types (called out in the brief)

| Table.column | Actual | Spec | OK? |
|---|---|---|---|
| accounts.acct_no | VARCHAR | VARCHAR (12 digits as text) | type OK; value shape is Check D |
| tx.tx_id | VARCHAR | VARCHAR (original Transaction_ID) | OK |
| tx.amount_paise | BIGINT | BIGINT | OK |
| tx.ts | TIMESTAMP | TIMESTAMP | OK |
| scores.candidate_roles | VARCHAR[] | list | OK |
| scores.reasons | VARCHAR[] | list | OK |
| rings.patterns | VARCHAR[] | list | OK |
| cases.victim_accts | VARCHAR[] | VARCHAR[] | OK |
| cases.ring_ids | INTEGER[] | INTEGER[] | OK |

### Primary keys (as specified)

| Table | PK | Present? |
|---|---|---|
| scores | (acct_id, profile_id) | yes |
| layer_links | (profile_id, tx_id) | yes |
| rings | (profile_id, ring_id) | yes |
| ingest_meta | load_id | yes |
| scoring_profiles | profile_id | yes |
| cases | case_id | yes |
| bank_directory | bank_prefix | yes |
| case_outputs | (none required) | none, as spec |

### CHECK constraints

- `scores_role_valid`: `role IS NULL OR role IN ('L1','L2','L3','UNCLASSIFIED_MULE')`
- `layer_links_type_valid`: `link_type IN ('VICTIM_L1','L1_L2','L2_L2','L2_L3')` and `link_type NOT NULL`

### Per-table vs Section 9

**ingest_meta** — columns and types match. PK `load_id`. NOT NULL on all columns.

**rejects** — `row_number BIGINT`, `reason VARCHAR`, plus the 11 original CSV
columns stored as VARCHAR. Section 9 says “row_number, raw values (text), reason”;
the extra named columns **are** those raw values, not a schema error.

**accounts** — `acct_id INTEGER`, `acct_no VARCHAR`, `ifsc`, `bank`,
`first_seen`/`last_seen TIMESTAMP`. No missing/extra columns. Columns are
nullable and there is no PK: expected for `CREATE OR REPLACE TABLE ... AS SELECT`.

**tx** — all 15 spec columns present with correct types, including
`is_foreign_ip`/`is_reserved_ip`/`is_headless` BOOLEAN, `narr_flags INTEGER`,
`utr VARCHAR`. Nullable; no PK (derived table).

**features** — table does not exist; column check skipped.

**scoring_profiles** — match, including `definition JSON`, defaults
`is_active`/`is_locked` = false.

**scores** — m1–m10, t1–t7, indexes, band, flags, l1/l2/l3_score, role,
role_confirmed, list + JSON columns, ring_id. PK (acct_id, profile_id).

**layer_links** — all spec columns; `tx_id VARCHAR`; `amount_paise BIGINT`;
PK (profile_id, tx_id).

**rings** — all spec columns; `patterns VARCHAR[]`; PK (profile_id, ring_id).

**cases** — match, including `victim_accts VARCHAR[]`, `ring_ids INTEGER[]`.

**case_outputs** — match.

**bank_directory** — match; PK `bank_prefix`.

No wrong types on any present spec table. No missing columns on any present
spec table.

**Verdict: PASS**

---

## Check C — Constraints (copy only; each attempt inside a transaction, then ROLLBACK)

Target: `%TEMP%\case_verify.duckdb` only.

### C1 — invalid scores.role `'L4'`

```sql
BEGIN;
INSERT INTO scores (acct_id, profile_id, role)
VALUES (0, 'verify_profile', 'L4');
ROLLBACK;
```

**Rejected:** `Constraint Error: CHECK constraint failed on table scores with expression CHECK((("role" IS NULL) OR ("role" IN ('L1', 'L2', 'L3', 'UNCLASSIFIED_MULE'))))`

### C2 — duplicate scores primary key

```sql
BEGIN;
INSERT INTO scores (acct_id, profile_id, role)
VALUES (0, 'verify_profile', NULL);   -- setup (valid)
INSERT INTO scores (acct_id, profile_id, role)
VALUES (0, 'verify_profile', NULL);   -- duplicate
ROLLBACK;
```

**Rejected:** `Constraint Error: PRIMARY KEY or UNIQUE constraint violation: duplicate key "0, verify_profile"`

### C3 — invalid layer_links.link_type `'L3_L1'`

```sql
BEGIN;
INSERT INTO layer_links (profile_id, tx_id, link_type)
VALUES ('verify_profile', 'TX_VERIFY', 'L3_L1');
ROLLBACK;
```

**Rejected:** `Constraint Error: CHECK constraint failed on table layer_links with expression CHECK((link_type IN ('VICTIM_L1', 'L1_L2', 'L2_L2', 'L2_L3')))`

All three must-reject cases fired. Transactions rolled back. Original
`data\case.duckdb` mtime unchanged.

**Verdict: PASS**

---

## Check D — Ingestion data integrity

Tables `tx`, `accounts`, `rejects`, `ingest_meta` all exist, so this check ran
in full.

### D1 — rows_loaded + rows_rejected = CSV row count

```sql
SELECT count(*) FROM read_csv('<csv>', all_varchar=true, header=true);
-- 2000000

SELECT * FROM ingest_meta ORDER BY load_id;
SELECT count(*) FROM tx;        -- 2000000
SELECT count(*) FROM rejects;   -- 0
SELECT count(*) FROM accounts;  -- 24873
```

| load_id | file_name | file_sha256 (prefix) | rows_total | rows_loaded | rows_rejected | load_seconds | loaded_at |
|---|---|---|---|---|---|---|---|
| 1 | VoidHacks8_MuleAccount_2M_Transactions.csv | 2c9f81fd34f7…adf73101 | 2,000,000 | 2,000,000 | 0 | 10.30 | 2026-10-02 06:28:48 |
| 2 | same file, same sha256 | 2c9f81fd34f7…adf73101 | 2,000,000 | 2,000,000 | 0 | 10.84 | 2026-10-02 06:31:35 |

Last load: **2,000,000 + 0 = 2,000,000 = CSV**. `tx` count matches
`rows_loaded`. Two ingest_meta rows for the same SHA-256: append-only audit
ran twice (WARN, not a row-count break).

### D2 — rejects by reason

```sql
SELECT reason, count(*) AS n FROM rejects GROUP BY reason ORDER BY n DESC, reason;
```

Empty. 0 rejected rows; no reason groups.

### D3 — 10 random `tx` rows joined back to the CSV on original Transaction_ID

CSV attached once as `TEMP TABLE csv_src`. Sample via `tx USING SAMPLE 10`,
joined on `Transaction_ID = tx_id`. Compared: sender, receiver,
`amount_paise = Amount * 100`, timestamp, payment mode, IP, device.

All 10 **OK** (no diffs):

| tx_id | src_no | dst_no | amount_paise | CSV Amount | ts | mode | ip | device |
|---|---|---|---|---|---|---|---|---|
| TXN794444873 | IPOS10005092 | SBIN10005404 | 28715 | 287.15 | 2026-09-25 10:36:24 | UPI | 103.198.19.63 | iOS |
| TXN928155118 | BARB10023264 | BARB10020627 | 138937 | 1389.37 | 2026-09-16 13:04:08 | UPI | 103.60.152.97 | Android |
| TXN768451131 | SBIN10023358 | HDFC10005580 | 28638 | 286.38 | 2026-09-24 04:30:54 | UPI | 103.98.207.78 | iOS |
| TXN417236377 | PUNB10011171 | IPOS10024800 | 77289 | 772.89 | 2026-09-23 07:32:03 | UPI | 103.137.206.108 | Windows_Browser |
| TXN266112570 | AXIS10017035 | PYTM10022860 | 16040 | 160.4 | 2026-09-28 13:10:12 | UPI | 103.143.225.68 | Windows_Browser |
| TXN329355618 | ICIC10018795 | PUNB10017132 | 224015 | 2240.15 | 2026-09-27 14:12:11 | UPI | 103.27.103.83 | Windows_Browser |
| TXN720137883 | AIRP10000623 | ICIC10001115 | 6927999 | 69279.99 | 2026-09-18 22:46:45 | UPI | 194.181.186.32 | Linux_Script |
| TXN848283187 | PUNB10007656 | PUNB10010555 | 130180 | 1301.8 | 2026-09-18 15:00:06 | IMPS | 103.51.189.55 | Android |
| TXN915314427 | KKBK10013212 | IPOS10011253 | 44105 | 441.05 | 2026-09-25 12:07:21 | UPI | 103.106.24.214 | Windows_Browser |
| TXN699343202 | PUNB10011512 | BARB10006467 | 116254 | 1162.54 | 2026-09-16 16:39:57 | UPI | 103.175.177.103 | Windows_Browser |

IDs, counterparties, paise conversion, timestamps, mode, IP and device are
unchanged from the file.

### D4 — no generated IDs

```sql
SELECT count(*) FROM tx WHERE regexp_full_match(tx_id, '^TXN[0-9]{8}$');
-- 0

SELECT count(*) FROM tx t
WHERE regexp_full_match(t.tx_id, '^TXN[0-9]{8}$')
  AND NOT EXISTS (SELECT 1 FROM csv_src c WHERE c.Transaction_ID = t.tx_id);
-- 0
```

All 2,000,000 `tx_id` values are length 12 and match `TXN` + **9** digits
(`TXN[0-9]{9}`), which is why the 8-digit generated-ID regex matches nothing.
`count(DISTINCT tx_id) = 1,997,748` (2,252 original IDs reused in the CSV/tx;
not regenerated IDs).

### D5 — acct_no shape and uniqueness

```sql
SELECT count(*) FROM accounts WHERE NOT regexp_full_match(acct_no, '^[0-9]{12}$');
-- 24873  (ALL rows)

SELECT count(*) FROM accounts WHERE length(acct_no) <> 12;
-- 0

SELECT count(*) FROM (
  SELECT acct_no FROM accounts GROUP BY acct_no HAVING count(*) > 1
);
-- 0
```

| Metric | Value |
|---|---|
| accounts | 24,873 |
| length = 12 | 24,873 |
| `^[0-9]{12}$` | **0** |
| `^[A-Z]{4}[0-9]{8}$` | **24,873** |
| duplicate acct_no | 0 |
| distinct acct_id | 24,873 |

Samples: `AIRP10012834`, `BARB10023461`, `HDFC10024195`, `ICIC10024007`,
`KKBK10019318`, `PYTM10000161`, `PYTM10021385`, `SBIN10005308`.

This **fails** the written “exactly 12 digits” rule. The CSV itself uses
4-letter bank prefix + 8 digits. Ingest did **not** pad or rewrite numbers
(guardrail 15). See Issues #1 and Check E.

### D6 — every tx.src / tx.dst exists in accounts

```sql
SELECT count(*) FROM tx t LEFT JOIN accounts a ON a.acct_id = t.src WHERE a.acct_id IS NULL;
-- 0
SELECT count(*) FROM tx t LEFT JOIN accounts a ON a.acct_id = t.dst WHERE a.acct_id IS NULL;
-- 0
```

No orphans.

### D7 — fabricated defaults (timestamps / amounts)

```sql
SELECT ts, count(*) AS n FROM tx GROUP BY ts ORDER BY n DESC LIMIT 3;
SELECT count(*) FROM tx WHERE amount_paise <= 0;
```

| ts | n | share of 2,000,000 |
|---|---|---|
| 2026-09-23 05:15:17 | 11 | 5.5e-6 |
| 2026-09-16 09:47:54 | 10 | 5.0e-6 |
| 2026-09-24 19:27:10 | 10 | 5.0e-6 |

No single timestamp dominates. `amount_paise <= 0`: **0**. No ABS/default
amount pattern.

### D8 — derived flags vs Section 9 / Section 3

Section 9 names the flags but does not define them. Definitions used
(from Section 3 + `engine\ingest.py`):

- `is_foreign_ip` = IP starts with `185.` or `194.`
- `is_headless` = device in (`Web_Emulator`, `Linux_Script`)
- `is_reserved_ip` (code) = `0.0.0.0` / `10.` / `192.168.` / `127.`
  (no `172.16/12`, no `169.254`)

Recomputed on a 5,000-row sample and compared to stored flags:

| Check | Mismatches |
|---|---|
| foreign vs starts_with 185./194. | 0 |
| headless vs Web_Emulator/Linux_Script | 0 |
| reserved vs the code’s predicate | 0 |
| RFC1918 `172.16–31.*` gap vs stored reserved | 0 in this sample (none of those IPs present) |

Full-table totals: foreign **2,654** / reserved **0** / headless **2,654** /
n **2,000,000**. The 2,654 foreign rows are also the 2,654 headless rows
(185.x/194.x + Web_Emulator/Linux_Script), consistent with Section 3.

### D9 — empty downstream tables (expected 0 rows at ingest)

| Table | Rows |
|---|---|
| scores | 0 |
| layer_links | 0 |
| rings | 0 |
| cases | 0 |
| case_outputs | 0 |
| scoring_profiles | 0 |
| bank_directory | 0 |
| features | **table missing** (not 0 rows) |

**Verdict: FAIL** — solely because every `acct_no` fails `^[0-9]{12}$`. All
other D sub-checks passed. The values match the CSV; they were not invented.

---

## Check E — Code review (read only)

Files read: `engine\sql\schema.sql` (186 lines), `engine\ingest.py` (291 lines),
`engine\apply_schema.py` (58 lines).

### Guardrail scan (Section 8)

| # | Rule | Finding |
|---|---|---|
| 1 | Offline / no network | No HTTP, sockets, or cloud clients in these three files. |
| 2 | No Python loops over transactions | Ingest is DuckDB SQL. The only Python loop is `sha256_of` reading the file in 1 MiB chunks (`HASH_CHUNK = 1 << 20`). |
| 3 | Accounts text, amounts integer paise, explicit timestamps | `all_varchar=true`; `CAST(amt_p * 100 AS BIGINT)`; `TRY_STRPTIME(..., '%Y-%m-%d %H:%M:%S')`. |
| 5 | Weights in scoring_profiles | Not applicable at ingest; table exists empty. |
| 6 | `memory_limit='3GB'` | Set in both `ingest.py` and `apply_schema.py`. |
| 9 | Never read ground-truth labels | No ground-truth path or label column referenced. |
| 10 | Keep original Transaction_ID | `tx_id = Transaction_ID`; sample-10 confirms. |
| 15 | Quarantine; never pad / ABS / fake dates / silent drop | Rejects table; `ignore_errors` not used; no `ABS`; no account padding; bad rows get a `reason`. This dataset produced 0 rejects. |
| 17 | No hard-coded personal paths | Paths from `os.path.dirname(os.path.abspath(__file__))` → project root. CSV/DB under `data\`. |

### Paths and connections

- `ingest.py` lines 34–40, `apply_schema.py` lines 20–24: `ENGINE_DIR` / `ROOT`
  from `__file__`, not `os.getcwd()`.
- Both scripts `con.close()` in a `finally` block (`ingest.py` 285–286,
  `apply_schema.py` 52–53).
- CSV path converted to forward slashes for DuckDB SQL (`CSV_SQL`).

### schema.sql vs Section 9 creation styles

Fixed-schema tables (`ingest_meta`, `scoring_profiles`, `scores`,
`layer_links`, `rings`, `cases`, `case_outputs`, `bank_directory`) use
`CREATE TABLE IF NOT EXISTS` as specified. Derived tables (`rejects`,
`accounts`, `tx`, `features`) are intentionally **not** declared here
(header comment lines 13–15); ingest builds the first three with
`CREATE OR REPLACE`. `features` is not built yet.

`narr_flags` / `utr` are declared NULL “filled by a later step”
(`ingest.py` 185–207) — not guessed.

### Issues in code (not applied)

1. **`RE_ACCT` vs Section 9** (`ingest.py` 50–58, 94–99)

   Spec validation: “12-digit sender and receiver accounts”. Code uses
   `[A-Z0-9]{12}` with an explicit comment that `^[0-9]{12}$` would reject
   the entire file. Intent (fixed 12-wide text, no padding) is preserved;
   the literal digit rule is not.

2. **`is_reserved_ip` incomplete** (`ingest.py` 201–204)

   Covers `0.0.0.0`, `10.`, `192.168.`, `127.`. Omits RFC1918 `172.16/12`
   and link-local `169.254.`. Section 9 names the column but does not define
   it; Section 3 only defines foreign (185.x/194.x) and headless. Currently
   0 reserved rows in this dataset, so no immediate data error.

3. **`min(ifsc)` on accounts** (`ingest.py` 166–171)

   If the same `acct_no` appears with more than one IFSC, ingest keeps
   `min(ifsc)`. That is a deterministic collapse, not a pad/default, but it
   can hide IFSC disagreement.

4. **`ingest_meta` is append-only** (`ingest.py` 257–268)

   Two loads of the identical file (same SHA-256) produced two audit rows.
   Spec grain is “one per load”, so this is allowed; reruns are not
   idempotent in the audit table.

**Verdict: WARN**

---

## Issues found

Do **not** apply these. Listed for the implementing agent.

1. **Severity: medium** — `acct_no` is not 12 digits; ingest regex was loosened to match the CSV.
   - **What:** Section 9 and the verification brief require 12-digit account
     numbers. All 24,873 `accounts.acct_no` values are `[A-Z]{4}[0-9]{8}`
     (e.g. `KKBK10000000`). Length is 12; digits-only count is 0.
   - **Where:** data in `accounts.acct_no`; rule in `engine\ingest.py` lines
     50–58 and 94–99 (`RE_ACCT = r"[A-Z0-9]{12}"`).
   - **Suggested fix:** Update Section 9 (and any jury-facing docs) to
     “12-character alphanumeric, typically 4-letter prefix + 8 digits”,
     **or** keep the digit rule and quarantine the whole file. Do **not**
     pad or rewrite account numbers.

2. **Severity: medium** — spec table `features` is missing.
   - **What:** 11/12 Section 9 tables exist. `features` is the next derived
     step (Section 9 build order / Section 13).
   - **Where:** `data\case.duckdb` (no `features`); not declared in
     `engine\sql\schema.sql` by design; no `engine` step builds it yet.
   - **Suggested fix:** Add the features `CREATE OR REPLACE TABLE ... AS SELECT`
     step when that pipeline stage is implemented. Do not invent placeholder
     feature values.

3. **Severity: low** — `is_reserved_ip` omits `172.16.0.0/12` and `169.254.0.0/16`.
   - **What:** Predicate is `0.0.0.0` / `10.` / `192.168.` / `127.` only.
     Prefix `starts_with(ip, '10.')` is acceptable for 10/8; `172.16/12`
     cannot be done with `starts_with('172.2')` (false-positives). Current
     dataset has 0 reserved IPs, so stored flags match the code.
   - **Where:** `engine\ingest.py` lines 201–204.
   - **Suggested fix:** Parse octets (`split_part`) and test
     `octet1=172 AND octet2 BETWEEN 16 AND 31`, plus `starts_with(ip, '169.254.')`.
     Document the definition in Section 9.

4. **Severity: low** — leftover `raw` table (~2M VARCHAR rows) sits beside the spec schema.
   - **What:** Extra 2,000,000-row all-VARCHAR copy of the CSV. Inflates the
     143 MiB DB; not a Check A error (exploration leftover).
   - **Where:** table `raw` in `data\case.duckdb`.
   - **Suggested fix:** `DROP TABLE IF EXISTS raw;` once exploration is done
     (or move it out of the production file).

5. **Severity: low** — two `ingest_meta` rows for the same file SHA-256.
   - **What:** Loads at 06:28:48 and 06:31:35; identical
     `2c9f81fd…adf73101`, both 2,000,000 loaded / 0 rejected.
   - **Where:** `ingest_meta` load_id 1 and 2; insert in `engine\ingest.py`
     257–268.
   - **Suggested fix:** Keep append-only history, or skip/replace when
     `file_sha256` already exists. Do not delete historical rows silently.

6. **Severity: low** — original Transaction_IDs are not unique in the CSV.
   - **What:** 2,000,000 tx rows, 1,997,748 distinct `tx_id` (2,252 extras).
     These are original IDs, not generated `TXN########` values. `layer_links`
     PK is `(profile_id, tx_id)`, so a later step cannot store two links
     that share a reused ID under one profile.
   - **Where:** source CSV / `tx.tx_id`.
   - **Suggested fix:** Treat uniqueness as a data-quality finding; if a PK
     on `tx.tx_id` is ever added, use `(tx_id, src, dst, ts)` or a surrogate
     **in addition to** keeping the original ID on the row (guardrail 10).

7. **Severity: low** — `accounts.ifsc` is `min(ifsc)` per `acct_no`.
   - **What:** One IFSC kept if an account appears with more than one.
   - **Where:** `engine\ingest.py` lines 166–171.
   - **Suggested fix:** Count distinct IFSCs per account; if > 1, pick by a
     documented rule (e.g. last-seen) or record a conflict flag. Do not
     invent an IFSC.

---

## Exploration leftovers

Tables in the file that are **not** in the Section 9 list. These are **not**
Check A errors.

### `raw`

| Item | Value |
|---|---|
| Rows | 2,000,000 |
| Columns | 11, all VARCHAR, all nullable |
| Names | Transaction_ID, Sender_Account, Receiver_Account, Sender_IFSC, Receiver_IFSC, Amount, Timestamp, Payment_Mode, Narration, IP_Address, Device_Type |
| Sample IDs | TXN401119292, TXN953843067, TXN515751130 |

This is an all-text snapshot of the source CSV, left from exploration.
`l1_cand` / `l3_cand` are **not** present.

---

## Method notes

- Copy created at `%TEMP%\case_verify.duckdb` before any check; original
  `data\case.duckdb` was not opened for write. Source mtime remained
  2026-10-02 07:03:18.
- Check C used `BEGIN` / `ROLLBACK` on the copy only.
- CSV counted with DuckDB `read_csv(..., all_varchar=true, header=true)`.
- Sample-10 used one `TEMP TABLE csv_src` (single CSV scan) then joined.
- RFC1918 `172.16/12` probe used octet `split_part` + `BETWEEN 16 AND 31`,
  not `starts_with('172.2')`.
- Copy deleted after this report was written.
