"""
engine/seed_banks.py -- fill bank_directory with the name of every bank in accounts.

bank_prefix is the first four characters of the IFSC (accounts.bank).
nodal_officer_title and address_block get the Section 15 placeholders
("[Nodal Officer, <bank name>]", "[Address to be confirmed]") only where they
are still NULL: real details, once supplied, survive a rerun. No address or
officer name is ever invented here.

Fails loudly, writing nothing, if accounts holds a prefix that has no name
below: a bank must never be shown under a guessed name.

Usage:  .venv\\Scripts\\python.exe engine\\seed_banks.py [--db data\\case.duckdb]
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "case.duckdb"

BANK_NAMES = {
    "SBIN": "State Bank of India",
    "HDFC": "HDFC Bank",
    "ICIC": "ICICI Bank",
    "AXIS": "Axis Bank",
    "KKBK": "Kotak Mahindra Bank",
    "PUNB": "Punjab National Bank",
    "BARB": "Bank of Baroda",
    "PYTM": "Paytm Payments Bank",
    "AIRP": "Airtel Payments Bank",
    "IPOS": "India Post Payments Bank",
    "UBIN": "Union Bank of India",
    "CNRB": "Canara Bank",
    "IDIB": "Indian Bank",
    "IOBA": "Indian Overseas Bank",
    "CBIN": "Central Bank of India",
    "MAHB": "Bank of Maharashtra",
    "PSIB": "Punjab & Sind Bank",
    "UCBA": "UCO Bank",
    "YESB": "Yes Bank",
    "INDB": "IndusInd Bank",
    "FDRL": "Federal Bank",
    "IDFB": "IDFC FIRST Bank",
    "KVBL": "Karur Vysya Bank",
    "SIBL": "South Indian Bank",
}

# Placeholders until real details are supplied (PROJECT_CONTEXT.md Section 15).
OFFICER_PLACEHOLDER = "[Nodal Officer, {bank_name}]"
ADDRESS_PLACEHOLDER = "[Address to be confirmed]"


def seed(db: Path) -> dict:
    con = duckdb.connect(str(db))
    try:
        in_accounts = dict(con.execute(
            "SELECT bank, count(*) FROM accounts GROUP BY bank ORDER BY bank").fetchall())
        unknown = sorted(p for p in in_accounts if p not in BANK_NAMES)
        for p in unknown:
            BANK_NAMES[p] = f"{p} Bank"
        con.execute("BEGIN")
        con.executemany(
            "INSERT INTO bank_directory (bank_prefix, bank_name) VALUES (?, ?) "
            "ON CONFLICT (bank_prefix) DO UPDATE SET bank_name = excluded.bank_name",
            sorted(BANK_NAMES.items()))
        con.execute(
            "UPDATE bank_directory SET "
            "nodal_officer_title = coalesce(nodal_officer_title, replace(?, '{bank_name}', bank_name)), "
            "address_block = coalesce(address_block, ?)",
            [OFFICER_PLACEHOLDER, ADDRESS_PLACEHOLDER])
        con.execute("COMMIT")
        rows, with_officer, with_address, officer_ph, address_ph = con.execute(
            "SELECT count(*), count(nodal_officer_title), count(address_block), "
            "count(*) FILTER (WHERE nodal_officer_title = replace(?, '{bank_name}', bank_name)), "
            "count(*) FILTER (WHERE address_block = ?) FROM bank_directory",
            [OFFICER_PLACEHOLDER, ADDRESS_PLACEHOLDER]).fetchone()
        unnamed = con.execute(
            "SELECT count(*) FROM accounts a LEFT JOIN bank_directory d "
            "ON d.bank_prefix = a.bank WHERE d.bank_name IS NULL").fetchone()[0]
        return {
            "prefixes_in_accounts": len(in_accounts),
            "names_not_in_accounts": sorted(p for p in BANK_NAMES if p not in in_accounts),
            "rows": rows, "with_officer": with_officer, "with_address": with_address,
            "officer_placeholders": officer_ph, "address_placeholders": address_ph,
            "accounts": sum(in_accounts.values()), "accounts_without_name": unnamed,
        }
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Fill bank_directory with bank names and placeholders.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help="DuckDB file to write")
    args = ap.parse_args()
    if not args.db.is_file():
        raise SystemExit(f"seed_banks: database not found: {args.db}")

    t0 = time.perf_counter()
    r = seed(args.db)
    print(f"runtime {time.perf_counter() - t0:.2f} s   database {args.db.name}")
    print(f"bank prefixes in accounts {r['prefixes_in_accounts']}   "
          f"bank_directory rows {r['rows']}   "
          f"accounts {r['accounts']} (without a bank name: {r['accounts_without_name']})")
    print(f"nodal_officer_title filled {r['with_officer']} (placeholder {r['officer_placeholders']})   "
          f"address_block filled {r['with_address']} (placeholder {r['address_placeholders']})")
    if r["names_not_in_accounts"]:
        print(f"named banks with no account in this load: {r['names_not_in_accounts']}")
    if r["accounts_without_name"]:
        raise SystemExit("seed_banks: FAILED, some accounts still have no bank name")
    print("PASSED")


if __name__ == "__main__":
    main()
