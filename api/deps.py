"""Per-request dependencies: a read-only DuckDB connection and the active profile.

The API never writes: every connection is opened with read_only=True and is
closed in a finally block when the request ends.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import duckdb
from fastapi import Depends, HTTPException

from api.repositories import profiles as profiles_repo

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "case.duckdb"


def db_path() -> Path:
    """The case database; ABHEDYA_DB overrides it (used by tests on a copy)."""
    return Path(os.environ.get("ABHEDYA_DB") or DEFAULT_DB)


@dataclass(frozen=True)
class Profile:
    profile_id: str
    definition: dict


def get_con() -> Iterator[duckdb.DuckDBPyConnection]:
    path = db_path()
    if not path.is_file():
        raise HTTPException(503, f"case database not found: {path.name}")
    try:
        con = duckdb.connect(str(path), read_only=True)
    except duckdb.Error as e:
        raise HTTPException(503, f"case database is not available: {e}") from e
    try:
        yield con
    finally:
        con.close()


def get_profile(con: duckdb.DuckDBPyConnection = Depends(get_con)) -> Profile:
    rows = profiles_repo.active(con)
    if len(rows) != 1:
        raise HTTPException(
            503, f"expected exactly one active scoring profile, found {len(rows)}")
    return Profile(rows[0]["profile_id"], json.loads(rows[0]["definition"]))
