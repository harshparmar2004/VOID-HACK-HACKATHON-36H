from __future__ import annotations

from api.repositories import fetch_dicts


def active(con) -> list[dict]:
    return fetch_dicts(con, """
        SELECT profile_id, CAST(definition AS VARCHAR) AS definition
        FROM scoring_profiles
        WHERE is_active
        ORDER BY profile_id""")
