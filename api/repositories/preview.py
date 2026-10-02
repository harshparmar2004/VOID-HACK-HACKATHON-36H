"""SQL of the profile preview. Everything runs on an IN-MEMORY connection: the
case file is attached READ_ONLY and the tables the engine writes are in-memory
tables, so the file is never written."""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

from api.repositories import fetch_dicts

CASE = "case_db"          # alias of the attached, read-only case file
READ_TABLES = ("tx", "accounts")                 # read through views
EMPTY_TABLES = ("scores", "layer_links")         # refilled by the engine

_ACCOUNT_COLUMNS = """
        SELECT acct_no AS account, bank, role_before, role_after,
               final_before AS final_index_before, final_after AS final_index_after,
               flag_before AS flagged_before, flag_after AS flagged_after
        FROM preview_cmp"""


def open_memory(db: Path, memory_limit: str) -> duckdb.DuckDBPyConnection:
    """An in-memory connection that looks like the case database to the engine."""
    con = duckdb.connect(":memory:")
    try:
        con.execute(f"SET memory_limit='{memory_limit}'")
        path = str(db).replace("'", "''")
        con.execute(f"ATTACH '{path}' AS {CASE} (READ_ONLY)")
        for t in READ_TABLES:
            con.execute(f"CREATE VIEW {t} AS SELECT * FROM {CASE}.main.{t}")
        for t in EMPTY_TABLES:
            con.execute(f"CREATE TABLE {t} AS SELECT * FROM {CASE}.main.{t} WHERE FALSE")
        # pass 2 writes neighbour_risk back into features: a private copy.
        con.execute(f"CREATE TABLE features AS SELECT * FROM {CASE}.main.features")
        con.execute(
            f"CREATE TABLE scoring_profiles AS SELECT * FROM {CASE}.main.scoring_profiles "
            "WHERE FALSE")
    except Exception:
        con.close()
        raise
    return con


def set_profile(con, profile_id: str, definition: dict) -> None:
    """The changed copy as the one (active) profile of the in-memory connection."""
    con.execute(
        "INSERT INTO scoring_profiles (profile_id, created_at, is_active, is_locked, definition) "
        "VALUES (?, now()::TIMESTAMP, TRUE, FALSE, CAST(? AS JSON))",
        [profile_id, json.dumps(definition)])


def compare(con, profile_id: str) -> None:
    """preview_cmp: one row per account, stored decision beside the previewed one."""
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE preview_cmp AS
        SELECT a.acct_no, a.bank,
               o.is_flagged AS flag_before, n.is_flagged AS flag_after,
               o.role AS role_before, n.role AS role_after,
               o.band AS band_before, n.band AS band_after,
               o.final_index AS final_before, n.final_index AS final_after,
               o.freeze_recommended AS freeze_before, n.freeze_recommended AS freeze_after
        FROM scores n
        JOIN {CASE}.main.scores o ON o.acct_id = n.acct_id AND o.profile_id = n.profile_id
        JOIN {CASE}.main.accounts a ON a.acct_id = n.acct_id
        WHERE n.profile_id = ?""", [profile_id])


def totals(con, profile_id: str) -> dict:
    return fetch_dicts(con, f"""
        SELECT count(*) AS accounts,
               count(*) FILTER (WHERE flag_before) AS flagged_before,
               count(*) FILTER (WHERE flag_after)  AS flagged_after,
               count(*) FILTER (WHERE flag_after AND NOT flag_before) AS gained,
               count(*) FILTER (WHERE flag_before AND NOT flag_after) AS lost,
               count(*) FILTER (WHERE role_before IS DISTINCT FROM role_after) AS role_changes,
               count(*) FILTER (WHERE freeze_before) AS freeze_before,
               count(*) FILTER (WHERE freeze_after)  AS freeze_after,
               count(*) FILTER (WHERE final_after <> final_before) AS final_changed,
               max(abs(final_after - final_before)) AS max_final_change,
               (SELECT count(*) FROM {CASE}.main.scores WHERE profile_id = ?) AS stored_rows,
               (SELECT count(*) FROM {CASE}.main.layer_links WHERE profile_id = ?) AS links_before,
               (SELECT count(*) FROM layer_links WHERE profile_id = ?) AS links_after
        FROM preview_cmp""", [profile_id, profile_id, profile_id])[0]


def counts(con, column: str) -> dict[str, dict[str, int]]:
    """Before / after counts of `band` or `role` (NULL role = 'NONE')."""
    if column not in ("band", "role"):
        raise ValueError(column)
    out = {}
    for side in ("before", "after"):
        out[side] = dict(con.execute(
            f"SELECT coalesce({column}_{side}, 'NONE'), count(*) FROM preview_cmp "
            "GROUP BY 1 ORDER BY 1").fetchall())
    return out


def role_transitions(con) -> list[dict]:
    return fetch_dicts(con, """
        SELECT coalesce(role_before, 'NONE') AS role_before,
               coalesce(role_after, 'NONE')  AS role_after, count(*) AS count
        FROM preview_cmp
        WHERE role_before IS DISTINCT FROM role_after
        GROUP BY 1, 2
        ORDER BY count DESC, 1, 2""")


def gained(con, limit: int) -> list[dict]:
    return fetch_dicts(con, _ACCOUNT_COLUMNS + """
        WHERE flag_after AND NOT flag_before
        ORDER BY final_after DESC, acct_no LIMIT ?""", [limit])


def lost(con, limit: int) -> list[dict]:
    return fetch_dicts(con, _ACCOUNT_COLUMNS + """
        WHERE flag_before AND NOT flag_after
        ORDER BY final_before DESC, acct_no LIMIT ?""", [limit])


def role_changed(con, limit: int) -> list[dict]:
    return fetch_dicts(con, _ACCOUNT_COLUMNS + """
        WHERE role_before IS DISTINCT FROM role_after
        ORDER BY greatest(final_before, final_after) DESC, acct_no LIMIT ?""", [limit])
