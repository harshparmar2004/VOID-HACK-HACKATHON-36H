"""All SQL lives here. Read-only SELECTs, bound parameters only."""
from __future__ import annotations

import duckdb


def fetch_dicts(con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> list[dict]:
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]
