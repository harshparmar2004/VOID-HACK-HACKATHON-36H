"""
engine/ingest.py -- Step 1 of the Abhedya-Chakra pipeline.

Loads data/VoidHacks8_MuleAccount_2M_Transactions.csv into data/case.duckdb:

    schema.sql  ->  rejects  ->  accounts  ->  tx  ->  ingest_meta

Rules this script obeys (PROJECT_CONTEXT.md Sections 8 and 9):
  * All data work is DuckDB SQL. No Python loop ever touches a transaction row.
  * The CSV is read with all_varchar=true; types are converted only after a row
    has passed every validation rule.
  * Bad rows are quarantined in `rejects` with their raw text values and a
    reason. Nothing is ever padded, defaulted, ABS'd or silently dropped.
  * Account numbers stay text, amounts become integer paise, timestamps are
    parsed with an explicit format.
  * tx.tx_id is the ORIGINAL Transaction_ID from the file -- never regenerated.
    It is NOT unique in this dataset (2,250 IDs repeat over 4,502 rows), so
    tx.tx_key is the primary key and the only safe join column (guardrail 10).
  * Derived tables use CREATE OR REPLACE, so the script is safe to rerun.
"""

from __future__ import annotations

import hashlib
import time
from datetime import datetime
from pathlib import Path

import duckdb

# ---------------------------------------------------------------------------
# Paths are derived from this file's location, never from the current working
# directory, so the script behaves the same however it is launched
# (guardrail 17: no hard-coded personal paths).
# DuckDB SQL string paths use forward slashes, including on Windows.
# ---------------------------------------------------------------------------
ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

CSV_NAME = "VoidHacks8_MuleAccount_2M_Transactions.csv"
CSV_PATH = ROOT / "data" / CSV_NAME
DB_PATH = ROOT / "data" / "case.duckdb"
SCHEMA_PATH = ENGINE_DIR / "sql" / "schema.sql"

CSV_SQL = CSV_PATH.as_posix()

MEMORY_LIMIT = "3GB"
HASH_CHUNK = 1 << 20  # 1 MiB

# ---------------------------------------------------------------------------
# Validation rules (Section 9).
#
# Accounts are 12 characters: a 4-letter bank code + 8 digits (e.g.
# HDFC10000336), NOT 12 digits as the problem statement says -- verified on the
# real file (Section 3b). The rule is spelled out exactly rather than loosened
# to "12 alphanumerics", so a differently shaped account is quarantined instead
# of silently accepted.
# ---------------------------------------------------------------------------
RE_ACCT = r"[A-Z]{4}[0-9]{8}"
RE_IFSC = r"[A-Z]{4}0[A-Z0-9]{6}"
TS_FORMAT = "%Y-%m-%d %H:%M:%S"
MODES = "('UPI', 'IMPS', 'NEFT', 'RTGS')"

# Reserved / non-routable sender IPs. 172.16.0.0-172.31.255.255 is the RFC 1918
# /12 block, so the second octet is range-checked rather than prefix-matched.
IP_RESERVED_SQL = """(
       {ip} = '0.0.0.0'
    OR starts_with({ip}, '10.')
    OR starts_with({ip}, '127.')
    OR starts_with({ip}, '192.168.')
    OR (starts_with({ip}, '172.')
        AND TRY_CAST(split_part({ip}, '.', 2) AS INTEGER) BETWEEN 16 AND 31)
)"""

# tx_key is the 1-based index of the row in the source CSV, excluding the
# header. row_number() OVER () assigns it in table-scan order, which equals
# file order because preserve_insertion_order is on -- so the same file always
# produces the same tx_key. rejects.row_number uses the same numbering, and it
# matches `file_row_number` in the audit scripts (audits/_common.py).
#
# A row that breaks several rules is quarantined once, with every reason joined
# by ';', so the reject counts never double-count.
STAGE_SQL = f"""
CREATE OR REPLACE TEMP TABLE stage AS
WITH src AS (
    SELECT
        CAST(row_number() OVER () AS BIGINT) AS tx_key,
        *
    FROM read_csv(
        '{CSV_SQL}',
        all_varchar = true,
        header      = true
    )
),
parsed AS (
    SELECT
        tx_key,
        Transaction_ID, Sender_Account, Receiver_Account,
        Sender_IFSC, Receiver_IFSC, Amount, "Timestamp",
        Payment_Mode, Narration, IP_Address, Device_Type,
        TRY_STRPTIME("Timestamp", '{TS_FORMAT}')  AS ts_p,
        TRY_CAST(Amount AS DECIMAL(18, 4))        AS amt_p
    FROM src
)
SELECT
    *,
    nullif(
        array_to_string(
            list_filter([
                CASE WHEN Transaction_ID IS NULL OR trim(Transaction_ID) = ''
                     THEN 'empty_transaction_id' END,
                CASE WHEN Sender_Account IS NULL
                       OR NOT regexp_full_match(Sender_Account, '{RE_ACCT}')
                     THEN 'bad_sender_account' END,
                CASE WHEN Receiver_Account IS NULL
                       OR NOT regexp_full_match(Receiver_Account, '{RE_ACCT}')
                     THEN 'bad_receiver_account' END,
                CASE WHEN Sender_IFSC IS NULL
                       OR NOT regexp_full_match(Sender_IFSC, '{RE_IFSC}')
                     THEN 'bad_sender_ifsc' END,
                CASE WHEN Receiver_IFSC IS NULL
                       OR NOT regexp_full_match(Receiver_IFSC, '{RE_IFSC}')
                     THEN 'bad_receiver_ifsc' END,
                CASE WHEN ts_p IS NULL THEN 'bad_timestamp' END,
                CASE WHEN amt_p IS NULL THEN 'non_numeric_amount' END,
                CASE WHEN amt_p IS NOT NULL AND amt_p <= 0
                     THEN 'non_positive_amount' END,
                -- Reject rather than round: a sub-paise amount cannot be
                -- stored as integer paise without altering the evidence.
                CASE WHEN amt_p IS NOT NULL AND (amt_p * 10000) % 100 <> 0
                     THEN 'sub_paise_amount' END,
                CASE WHEN Payment_Mode IS NULL
                       OR Payment_Mode NOT IN {MODES}
                     THEN 'bad_payment_mode' END
            ], x -> x IS NOT NULL),
            ';'
        ),
        ''
    ) AS reason
FROM parsed
"""

REJECTS_SQL = """
CREATE OR REPLACE TABLE rejects AS
SELECT
    tx_key AS row_number,
    Transaction_ID, Sender_Account, Receiver_Account,
    Sender_IFSC, Receiver_IFSC, Amount, "Timestamp",
    Payment_Mode, Narration, IP_Address, Device_Type,
    reason
FROM stage
WHERE reason IS NOT NULL
ORDER BY tx_key
"""

# Valid rows only, with types converted once. is_dup_tx_id marks EVERY row
# whose Transaction_ID is shared with another loaded row; both rows are kept,
# never merged or rejected (Section 9 note).
VALID_SQL = """
CREATE OR REPLACE TEMP TABLE valid AS
SELECT
    tx_key,
    Transaction_ID                          AS tx_id,
    count(*) OVER (PARTITION BY Transaction_ID) > 1 AS is_dup_tx_id,
    Sender_Account                          AS src_no,
    Receiver_Account                        AS dst_no,
    Sender_IFSC                             AS src_ifsc,
    Receiver_IFSC                           AS dst_ifsc,
    CAST(amt_p * 100 AS BIGINT)             AS amount_paise,
    ts_p                                    AS ts,
    Payment_Mode                            AS mode,
    Narration                               AS narration,
    IP_Address                              AS ip,
    Device_Type                             AS device
FROM stage
WHERE reason IS NULL
"""

# acct_id is assigned by sorting the distinct account numbers, so the same
# input file always produces the same ids (stable across reruns and machines).
ACCOUNTS_SQL = """
CREATE OR REPLACE TABLE accounts AS
WITH sides AS (
    SELECT src_no AS acct_no, src_ifsc AS ifsc, ts FROM valid
    UNION ALL
    SELECT dst_no AS acct_no, dst_ifsc AS ifsc, ts FROM valid
),
agg AS (
    SELECT
        acct_no,
        min(ifsc)  AS ifsc,
        min(ts)    AS first_seen,
        max(ts)    AS last_seen
    FROM sides
    GROUP BY acct_no
)
SELECT
    CAST(row_number() OVER (ORDER BY acct_no) - 1 AS INTEGER) AS acct_id,
    acct_no,
    ifsc,
    substr(ifsc, 1, 4) AS bank,
    first_seen,
    last_seen
FROM agg
"""

# tx is declared explicitly (not CREATE ... AS SELECT) so tx_key can carry a
# PRIMARY KEY. CREATE OR REPLACE still makes the step safe to rerun.
# narr_flags and utr are declared now and filled by a later step; they are left
# NULL rather than guessed at.
TX_DDL = """
CREATE OR REPLACE TABLE tx (
    tx_key         BIGINT  NOT NULL,
    tx_id          VARCHAR NOT NULL,
    is_dup_tx_id   BOOLEAN NOT NULL,
    src            INTEGER NOT NULL,
    dst            INTEGER NOT NULL,
    amount_paise   BIGINT  NOT NULL,
    ts             TIMESTAMP NOT NULL,
    ts_sec         INTEGER NOT NULL,
    mode           VARCHAR,
    narration      VARCHAR,
    ip             VARCHAR,
    device         VARCHAR,
    is_foreign_ip  BOOLEAN,
    is_reserved_ip BOOLEAN,
    is_headless    BOOLEAN,
    narr_flags     INTEGER,
    utr            VARCHAR,
    PRIMARY KEY (tx_key)
)
"""

TX_INSERT_SQL = f"""
INSERT INTO tx
SELECT
    v.tx_key,
    v.tx_id,
    v.is_dup_tx_id,
    s.acct_id                                AS src,
    r.acct_id                                AS dst,
    v.amount_paise,
    v.ts,
    CAST(epoch(v.ts) AS INTEGER)             AS ts_sec,
    v.mode,
    v.narration,
    v.ip,
    v.device,
    (starts_with(v.ip, '185.') OR starts_with(v.ip, '194.')) AS is_foreign_ip,
    {IP_RESERVED_SQL.format(ip='v.ip')}      AS is_reserved_ip,
    (v.device IN ('Web_Emulator', 'Linux_Script'))           AS is_headless,
    CAST(NULL AS INTEGER)                    AS narr_flags,
    CAST(NULL AS VARCHAR)                    AS utr
FROM valid v
JOIN accounts s ON s.acct_no = v.src_no
JOIN accounts r ON r.acct_no = v.dst_no
"""


def sha256_of(path: Path) -> str:
    """Stream the file in 1 MiB chunks -- never loads 287 MB into memory."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(HASH_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    t0 = time.perf_counter()

    if not CSV_PATH.is_file():
        raise SystemExit(f"source CSV not found: {CSV_PATH}")
    if not SCHEMA_PATH.is_file():
        raise SystemExit(f"schema not found: {SCHEMA_PATH}")

    con = duckdb.connect(str(DB_PATH))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        # Required for tx_key to equal the physical CSV row number.
        con.execute("SET preserve_insertion_order=true")

        con.execute(SCHEMA_PATH.read_text(encoding="utf-8"))

        file_sha256 = sha256_of(CSV_PATH)

        con.execute(STAGE_SQL)
        con.execute(REJECTS_SQL)
        con.execute(VALID_SQL)
        con.execute(ACCOUNTS_SQL)
        con.execute(TX_DDL)
        con.execute(TX_INSERT_SQL)

        rows_total = con.execute("SELECT count(*) FROM stage").fetchone()[0]
        rows_loaded = con.execute("SELECT count(*) FROM tx").fetchone()[0]
        rows_rejected = con.execute("SELECT count(*) FROM rejects").fetchone()[0]
        n_accounts = con.execute("SELECT count(*) FROM accounts").fetchone()[0]
        n_dup = con.execute(
            "SELECT count(*) FROM tx WHERE is_dup_tx_id").fetchone()[0]
        by_reason = con.execute(
            "SELECT reason, count(*) AS n FROM rejects "
            "GROUP BY reason ORDER BY n DESC, reason"
        ).fetchall()

        load_seconds = time.perf_counter() - t0

        con.execute(
            """
            INSERT INTO ingest_meta
                (load_id, file_name, file_sha256, rows_total,
                 rows_loaded, rows_rejected, load_seconds, loaded_at)
            SELECT
                (SELECT COALESCE(max(load_id), 0) + 1 FROM ingest_meta),
                ?, ?, ?, ?, ?, ?, ?
            """,
            [CSV_NAME, file_sha256, rows_total, rows_loaded,
             rows_rejected, load_seconds, datetime.now()],
        )

        con.execute("DROP TABLE IF EXISTS stage")
        con.execute("DROP TABLE IF EXISTS valid")

        print(f"file            : {CSV_NAME}")
        print(f"sha256          : {file_sha256}")
        print(f"rows total      : {rows_total:,}")
        print(f"rows loaded     : {rows_loaded:,}")
        print(f"rows rejected   : {rows_rejected:,}")
        if by_reason:
            for reason, n in by_reason:
                print(f"    {reason:<40} {n:,}")
        else:
            print("    (no rejected rows)")
        print(f"accounts        : {n_accounts:,}")
        print(f"dup tx_id rows  : {n_dup:,}  (kept, flagged is_dup_tx_id)")
        print(f"seconds         : {load_seconds:.2f}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
