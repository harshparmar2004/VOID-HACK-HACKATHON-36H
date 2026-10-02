"""
engine/apply_schema.py -- apply engine/sql/schema.sql to data/case.duckdb.

Creates any fixed-schema table that is missing and leaves existing tables and
their rows untouched: every statement in schema.sql is CREATE TABLE IF NOT
EXISTS, so this script is safe to rerun as often as you like.

Usage:  .venv\\Scripts\\python.exe engine\\apply_schema.py

Note: DuckDB allows one writer at a time. Close any notebook kernel holding
data/case.duckdb (or connect it with read_only=True) before running this.
"""

from __future__ import annotations

import os

import duckdb

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ENGINE_DIR)

DB_PATH = os.path.join(ROOT, "data", "case.duckdb")
SCHEMA_PATH = os.path.join(ENGINE_DIR, "sql", "schema.sql")

MEMORY_LIMIT = "3GB"


def main() -> None:
    if not os.path.isfile(SCHEMA_PATH):
        raise SystemExit(f"schema not found: {SCHEMA_PATH}")

    con = duckdb.connect(DB_PATH)
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")

        before = {r[0] for r in con.execute("SHOW TABLES").fetchall()}

        with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
            con.execute(fh.read())

        after = {r[0] for r in con.execute("SHOW TABLES").fetchall()}

        print(f"database : {DB_PATH}")
        print(f"schema   : {SCHEMA_PATH}")
        created = sorted(after - before)
        print(f"created  : {', '.join(created) if created else '(nothing -- already present)'}")
        print(f"tables   : {len(after)}")
        for t in sorted(after):
            n = con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
            print(f"    {t:<20} {n:>12,} rows")
    finally:
        con.close()


if __name__ == "__main__":
    main()
