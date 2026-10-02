"""
engine/seed_banks.py -- fill bank_directory with the name of every bank in accounts.

bank_prefix is the first four characters of the IFSC (accounts.bank). Only
bank_name is written here; nodal_officer_title and address_block stay NULL
until Step 8 fills them, and a rerun leaves whatever they hold untouched.

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
}


def seed(db: Path) -> dict:
    con = duckdb.connect(str(db))
    try:
        in_accounts = dict(con.execute(
            "SELECT bank, count(*) FROM accounts GROUP BY bank ORDER BY bank").fetchall())
        unknown = sorted(p for p in in_accounts if p not in BANK_NAMES)
        if unknown:
            raise SystemExit(
                f"seed_banks: accounts holds bank prefix(es) with no name in BANK_NAMES: "
                f"{unknown}. Nothing was written. Add the bank to engine\\seed_banks.py.")
        con.execute("BEGIN")
        con.executemany(
            "INSERT INTO bank_directory (bank_prefix, bank_name) VALUES (?, ?) "
            "ON CONFLICT (bank_prefix) DO UPDATE SET bank_name = excluded.bank_name",
            sorted(BANK_NAMES.items()))
        con.execute("COMMIT")
        rows, with_officer, with_address = con.execute(
            "SELECT count(*), count(nodal_officer_title), count(address_block) "
            "FROM bank_directory").fetchone()
        unnamed = con.execute(
            "SELECT count(*) FROM accounts a LEFT JOIN bank_directory d "
            "ON d.bank_prefix = a.bank WHERE d.bank_name IS NULL").fetchone()[0]
        return {
            "prefixes_in_accounts": len(in_accounts),
            "names_not_in_accounts": sorted(p for p in BANK_NAMES if p not in in_accounts),
            "rows": rows, "with_officer": with_officer, "with_address": with_address,
            "accounts": sum(in_accounts.values()), "accounts_without_name": unnamed,
        }
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Fill bank_directory with bank names.")
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
    print(f"nodal_officer_title filled {r['with_officer']}   address_block filled {r['with_address']}")
    if r["names_not_in_accounts"]:
        print(f"named banks with no account in this load: {r['names_not_in_accounts']}")
    if r["accounts_without_name"]:
        raise SystemExit("seed_banks: FAILED, some accounts still have no bank name")
    print("PASSED")


if __name__ == "__main__":
    main()
