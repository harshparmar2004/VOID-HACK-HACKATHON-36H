from __future__ import annotations

from api.repositories import fetch_dicts


def latest_ingest(con) -> dict | None:
    rows = fetch_dicts(con, """
        SELECT load_id, file_name, file_sha256, rows_total, rows_loaded,
               rows_rejected, load_seconds, loaded_at
        FROM ingest_meta
        ORDER BY load_id DESC
        LIMIT 1""")
    return rows[0] if rows else None


def tx_counts(con) -> dict:
    return fetch_dicts(con, """
        SELECT count(*) FILTER (WHERE is_foreign_ip) AS foreign_ip_txns,
               count(DISTINCT dst)                   AS unique_receivers
        FROM tx""")[0]


def account_count(con) -> int:
    return con.execute("SELECT count(*) FROM accounts").fetchone()[0]


def score_counts(con, profile_id: str) -> dict:
    return fetch_dicts(con, """
        SELECT count(*) FILTER (WHERE is_flagged)         AS flagged,
               count(*) FILTER (WHERE freeze_recommended) AS freeze_recommended
        FROM scores
        WHERE profile_id = ?""", [profile_id])[0]


def role_counts(con, profile_id: str) -> list[dict]:
    return fetch_dicts(con, """
        SELECT role, count(*) AS n
        FROM scores
        WHERE profile_id = ? AND role IS NOT NULL
        GROUP BY role
        ORDER BY role""", [profile_id])


def band_counts(con, profile_id: str) -> list[dict]:
    return fetch_dicts(con, """
        SELECT band, count(*) AS n
        FROM scores
        WHERE profile_id = ? AND band IS NOT NULL
        GROUP BY band
        ORDER BY band""", [profile_id])


def cell_counts(con, profile_id: str) -> dict:
    return fetch_dicts(con, """
        SELECT (SELECT count(*) FROM cells WHERE profile_id = ?) AS cells,
               (SELECT count(*) FROM rings WHERE profile_id = ?) AS networks""",
                       [profile_id, profile_id])[0]
