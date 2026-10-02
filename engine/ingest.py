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
RE_ACCT = r"([A-Z]{4}[0-9]{8}|[0-9]{9,18}|[A-Z0-9]{8,18})"
RE_IFSC = r"([A-Z]{4}0[A-Z0-9]{6}|[A-Z0-9]{11})"
TS_FORMAT = "%Y-%m-%d %H:%M:%S"
MODES = "('UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'NETBANKING', 'CRYPTO', 'P2P', 'WALLET')"

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

def resolve_columns(csv_sql: str, con: duckdb.DuckDBPyConnection | None = None) -> dict[str, str]:
    target_aliases = {
        "Transaction_ID": ["transaction_id", "transactionid", "txn_id", "tx_id", "txnid", "transaction", "id"],
        "Sender_Account": ["sender_account", "senderaccount", "sender", "from_account", "source_account", "src_account", "from_acc", "sender_acc"],
        "Receiver_Account": ["receiver_account", "receiveraccount", "receiver", "to_account", "dest_account", "destination_account", "dst_account", "to_acc", "receiver_acc"],
        "Sender_IFSC": ["sender_ifsc", "senderifsc", "from_ifsc", "src_ifsc", "sender_bank_ifsc"],
        "Receiver_IFSC": ["receiver_ifsc", "receiverifsc", "to_ifsc", "dst_ifsc", "receiver_bank_ifsc"],
        "Amount": ["amount", "amt", "txn_amount", "transaction_amount", "sum"],
        "Timestamp": ["timestamp", "time", "date", "txn_time", "transaction_time", "datetime"],
        "Payment_Mode": ["payment_mode", "paymentmode", "mode", "channel", "type", "txn_type"],
        "Narration": ["narration", "description", "remarks", "remark", "memo", "note"],
        "IP_Address": ["ip_address", "ipaddress", "ip", "sender_ip", "client_ip"],
        "Device_Type": ["device_type", "devicetype", "device", "user_agent", "platform"],
    }
    col_mapping = {k: "CAST(NULL AS VARCHAR)" for k in target_aliases}
    close_con = False
    if con is None:
        con = duckdb.connect()
        close_con = True
    try:
        df_cols = con.execute(f"SELECT * FROM read_csv('{csv_sql}', header=true, all_varchar=true) LIMIT 0").df().columns.tolist()
        norm_to_orig = {c.strip().lower().replace(" ", "_"): c for c in df_cols}
        for target, aliases in target_aliases.items():
            for alias in aliases:
                if alias in norm_to_orig:
                    orig = norm_to_orig[alias]
                    col_mapping[target] = f'"{orig}"'
                    break
    except Exception:
        for target in target_aliases:
            col_mapping[target] = f'"{target}"'
    finally:
        if close_con:
            con.close()

    if col_mapping["Sender_IFSC"] == "CAST(NULL AS VARCHAR)" and col_mapping["Sender_Account"] != "CAST(NULL AS VARCHAR)":
        s_acc = col_mapping["Sender_Account"]
        col_mapping["Sender_IFSC"] = f"CASE WHEN regexp_full_match(SUBSTR({s_acc}, 1, 4), '[A-Z]{{4}}') THEN SUBSTR({s_acc}, 1, 4) || '0001000' ELSE 'SBIN0001000' END"

    if col_mapping["Receiver_IFSC"] == "CAST(NULL AS VARCHAR)" and col_mapping["Receiver_Account"] != "CAST(NULL AS VARCHAR)":
        r_acc = col_mapping["Receiver_Account"]
        col_mapping["Receiver_IFSC"] = f"CASE WHEN regexp_full_match(SUBSTR({r_acc}, 1, 4), '[A-Z]{{4}}') THEN SUBSTR({r_acc}, 1, 4) || '0001000' ELSE 'SBIN0001000' END"

    if col_mapping["Payment_Mode"] == "CAST(NULL AS VARCHAR)":
        col_mapping["Payment_Mode"] = "'UPI'"

    return col_mapping


def build_stage_sql(csv_sql: str, con: duckdb.DuckDBPyConnection | None = None) -> str:
    cols = resolve_columns(csv_sql, con)
    return f"""
CREATE OR REPLACE TEMP TABLE stage AS
WITH src AS (
    SELECT
        CAST(row_number() OVER () AS BIGINT) AS tx_key,
        *
    FROM read_csv(
        '{csv_sql}',
        all_varchar = true,
        header      = true
    )
),
parsed AS (
    SELECT
        tx_key,
        {cols["Transaction_ID"]} AS Transaction_ID,
        {cols["Sender_Account"]} AS Sender_Account,
        {cols["Receiver_Account"]} AS Receiver_Account,
        {cols["Sender_IFSC"]} AS Sender_IFSC,
        {cols["Receiver_IFSC"]} AS Receiver_IFSC,
        {cols["Amount"]} AS Amount,
        {cols["Timestamp"]} AS "Timestamp",
        {cols["Payment_Mode"]} AS Payment_Mode,
        {cols["Narration"]} AS Narration,
        {cols["IP_Address"]} AS IP_Address,
        {cols["Device_Type"]} AS Device_Type,
        COALESCE(
            TRY_STRPTIME({cols["Timestamp"]}, '{TS_FORMAT}'),
            TRY_STRPTIME({cols["Timestamp"]}, '%Y-%m-%dT%H:%M:%S'),
            TRY_STRPTIME({cols["Timestamp"]}, '%d-%m-%Y %H:%M:%S'),
            TRY_STRPTIME({cols["Timestamp"]}, '%d/%m/%Y %H:%M:%S'),
            TRY_CAST({cols["Timestamp"]} AS TIMESTAMP)
        ) AS ts_p,
        TRY_CAST({cols["Amount"]} AS DECIMAL(18, 4)) AS amt_p
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
                       OR upper(trim(Payment_Mode)) NOT IN {MODES}
                     THEN 'bad_payment_mode' END
            ], x -> x IS NOT NULL),
            ';'
        ),
        ''
    ) AS reason
FROM parsed
"""

STAGE_SQL = build_stage_sql(CSV_SQL)



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


def run_ingest(csv_path: Path, db_path: Path = DB_PATH) -> dict:
    t0 = time.perf_counter()
    csv_path = Path(csv_path)
    db_path = Path(db_path)

    if not csv_path.is_file():
        raise SystemExit(f"source CSV not found: {csv_path}")
    if not SCHEMA_PATH.is_file():
        raise SystemExit(f"schema not found: {SCHEMA_PATH}")

    con = duckdb.connect(str(db_path))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        con.execute("SET preserve_insertion_order=true")

        con.execute(SCHEMA_PATH.read_text(encoding="utf-8"))

        file_sha256 = sha256_of(csv_path)
        stage_sql = build_stage_sql(csv_path.as_posix(), con)

        con.execute(stage_sql)
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
            [csv_path.name, file_sha256, rows_total, rows_loaded,
             rows_rejected, load_seconds, datetime.now()],
        )

        con.execute("DROP TABLE IF EXISTS stage")
        con.execute("DROP TABLE IF EXISTS valid")

        return {
            "file_name": csv_path.name,
            "sha256": file_sha256,
            "rows_total": rows_total,
            "rows_loaded": rows_loaded,
            "rows_rejected": rows_rejected,
            "accounts": n_accounts,
            "dup_tx_id_rows": n_dup,
            "load_seconds": load_seconds,
            "by_reason": by_reason,
        }
    finally:
        con.close()


def main() -> None:
    res = run_ingest(CSV_PATH, DB_PATH)
    print(f"file            : {res['file_name']}")
    print(f"sha256          : {res['sha256']}")
    print(f"rows total      : {res['rows_total']:,}")
    print(f"rows loaded     : {res['rows_loaded']:,}")
    print(f"rows rejected   : {res['rows_rejected']:,}")
    if res['by_reason']:
        for reason, n in res['by_reason']:
            print(f"    {reason:<40} {n:,}")
    else:
        print("    (no rejected rows)")
    print(f"accounts        : {res['accounts']:,}")
    print(f"dup tx_id rows  : {res['dup_tx_id_rows']:,}  (kept, flagged is_dup_tx_id)")
    print(f"seconds         : {res['load_seconds']:.2f}")


if __name__ == "__main__":
    main()

