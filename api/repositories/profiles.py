from __future__ import annotations

from api.repositories import fetch_dicts

_COLUMNS = """
        SELECT profile_id, created_at, is_active, is_locked,
               CAST(definition AS VARCHAR) AS definition
        FROM scoring_profiles"""


def active(con) -> list[dict]:
    return fetch_dicts(con, _COLUMNS + " WHERE is_active ORDER BY profile_id")


def by_id(con, profile_id: str) -> list[dict]:
    return fetch_dicts(con, _COLUMNS + " WHERE profile_id = ?", [profile_id])
