"""
engine/features.py -- Step 2 of the Abhedya-Chakra pipeline.

Builds the `features` table: one row per account, every column a RAW
measurement. No weight, threshold or score is applied here -- scoring.py reads
these columns and the active profile to produce mule/trust/final/role scores.

    tx + accounts  ->  episode temp tables  ->  features  (CREATE OR REPLACE)

Rules this script obeys (PROJECT_CONTEXT.md Sections 7, 8 and 4.6):
  * All data work is DuckDB SQL. No Python loop runs at all: the episode rule
    (Section 4.6) is three set-based passes, so the round loop the old
    one-to-one allocation needed is gone.
  * Windows, cash-out categories AND every measurement cut-off come from the
    ACTIVE scoring profile -- nothing hard-coded (Section 8 rule 5, 4.6).
  * NULL means NOT APPLICABLE, never 0 (Section 4.6).
  * Joins use tx_key, never tx_id (guardrail 10).
  * No ground-truth labels, no account-number ranges, no device-count
    fingerprints (guardrail 9, Section 3b LEAKAGE).
  * The connection is closed in a finally block.

Usage:
    .venv\\Scripts\\python.exe engine\\features.py
    .venv\\Scripts\\python.exe engine\\features.py --db %TEMP%\\case_review.duckdb
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from string import Template

import duckdb

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"
SQL_PATH = ENGINE_DIR / "sql" / "features.sql"
EPISODE_SQL_PATH = ENGINE_DIR / "sql" / "features_episode.sql"

MEMORY_LIMIT = "3GB"

# Columns allowed to be NULL, with the Section 4.6 reason. Anything else being
# NULL is a bug, and the script says so rather than failing silently.
NULLABLE = {
    # flow features: no inflow at all, or no inflow ever forwarded
    "pass_through_share": "no inflow at all (send-only): not applicable",
    "forward_lag_median_s": "no episode forwarded anything: not applicable",
    "split_count_median": "no episode forwarded anything: not applicable",
    "commission_ratio_median": "no episode forwarded anything: not applicable",
    "commission_ratio_iqr": "fewer than 2 forwarding episodes: no spread to measure",
    "forwarding_episodes": "no inflow at all (send-only): not applicable",
    "median_hold_hours": "account never forwards an inflow: not applicable (4.6, no imputed end-of-data ts)",
    # inflow-side features: account never receives
    "flagged_in_share": "account never receives: not applicable",
    "recurring_sender_share": "account never receives: not applicable",
    "victim_inflow_share": "account never receives: not applicable",
    "burst_fan_in": "account never receives: not applicable",
    # outflow-side features: account never sends
    "flagged_out_share": "account never sends: not applicable",
    "device_consistency": "account never sends: not applicable",
    "shared_ip_cluster_size": "account never sends (IP describes the sender): not applicable",
    "ip_churn": "account never sends: not applicable",
    "structuring_share": "account never sends: not applicable",
    "timing_regularity": "fewer than 3 outflows, so fewer than 2 gaps: not applicable",
    # explicit placeholders
    "in_cycle": "TODO(graph.py): needs igraph cycle detection",
    "upstream_l1_share": "pass-2 placeholder (depends on scores)",
    "upstream_l2_share": "pass-2 placeholder (depends on scores)",
    "neighbour_risk": "pass-2 placeholder (depends on scores)",
}


def active_profile(con: duckdb.DuckDBPyConnection) -> tuple[str, dict]:
    """Return (profile_id, definition) of the single active profile."""
    rows = con.execute(
        "SELECT profile_id, definition FROM scoring_profiles "
        "WHERE is_active ORDER BY profile_id"
    ).fetchall()
    if not rows:
        raise SystemExit(
            "no active scoring profile -- run engine\\seed_profile.py first")
    if len(rows) > 1:
        raise SystemExit(
            f"{len(rows)} active profiles ({[r[0] for r in rows]}); expected exactly one")
    return rows[0][0], json.loads(rows[0][1])


def sql_params(profile: dict) -> dict[str, str]:
    """Map the profile's windows, categories and feature_rules onto the SQL."""
    w = profile["windows"]
    split = w["split_forward_minutes"]
    cats = profile["cashout_categories"]
    if not cats:
        raise SystemExit("profile has an empty cashout_categories list")
    for cat in cats:
        if not cat.replace("_", "").isalnum():
            raise SystemExit(f"refusing unsafe narration category: {cat!r}")

    try:
        fr = profile["feature_rules"]
    except KeyError:
        raise SystemExit(
            "profile has no feature_rules block -- reseed from engine\\config.yaml "
            "(Section 4.6: measurement cut-offs must come from the profile)")

    needed = ("victim_like_max_outflows", "recurring_min_days",
              "odd_hour_from", "odd_hour_to", "round_unit_paise")
    # max_alloc_rounds is deliberately NOT required: the episode rule (4.6)
    # has no re-offer rounds, so a profile carrying that key is stale, not
    # richer.
    missing = [k for k in needed if k not in fr]
    if missing:
        raise SystemExit(f"profile feature_rules is missing: {missing}")

    def as_int(v, what: str) -> str:
        # Every placeholder is interpolated into SQL text, so each one must be
        # provably an integer -- never a free-form string from the profile.
        if isinstance(v, bool) or not isinstance(v, int):
            raise SystemExit(f"profile {what} must be an integer, got {v!r}")
        return str(v)

    return {
        "single_max_s": as_int(int(w["single_forward_max_minutes"]) * 60, "single window") ,
        "split_min_s": as_int(int(split["min"]) * 60, "split window min"),
        "split_max_s": as_int(int(split["max"]) * 60, "split window max"),
        "cashout_list": ", ".join(f"'{c}'" for c in cats),
        "victim_max_out": as_int(fr["victim_like_max_outflows"], "victim_like_max_outflows"),
        "recurring_min_days": as_int(fr["recurring_min_days"], "recurring_min_days"),
        "odd_hour_from": as_int(fr["odd_hour_from"], "odd_hour_from"),
        "odd_hour_to": as_int(fr["odd_hour_to"], "odd_hour_to"),
        "round_unit_paise": as_int(fr["round_unit_paise"], "round_unit_paise"),
    }


def split_sections(text: str) -> dict[str, str]:
    """Split features_episode.sql on its '-- @@SECTION' markers."""
    parts = re.split(r"(?m)^--\s*@@(\w+)\s*$", text)
    return {parts[i].upper(): parts[i + 1] for i in range(1, len(parts), 2)}


def build_episodes(con: duckdb.DuckDBPyConnection,
                   params: dict[str, str]) -> tuple[int, int, int, int]:
    """Build the episode temp tables (Section 4.6) and audit the invariants.

    Returns (episodes, inflows, outflows_in_an_episode, episodes_out_over_in).
    """
    sections = split_sections(
        Template(EPISODE_SQL_PATH.read_text(encoding="utf-8")).substitute(params))
    for name in ("BUILD", "AUDIT"):
        if name not in sections:
            raise SystemExit(f"{EPISODE_SQL_PATH.name} is missing section @@{name}")

    con.execute(sections["BUILD"])

    n_ep, n_in, n_out = con.execute(
        "SELECT (SELECT count(*) FROM ep_window),"
        "       (SELECT count(*) FROM ep_inflow),"
        "       (SELECT count(*) FROM ep_out)").fetchone()

    twice, bad_lag, uncovered, overlap, out_over_in = con.execute(
        sections["AUDIT"]).fetchone()
    print(f"    audit     : outflow in 2 episodes={twice}, lag outside window="
          f"{bad_lag}, inflows not in exactly 1 episode={uncovered}, "
          f"overlapping episodes={overlap}")
    # out_over_in is NOT a failure: an account can send more inside a window
    # than arrived in it, which is why 4.6 caps the per-episode ratio at 1.0.
    if twice or bad_lag or uncovered or overlap:
        raise SystemExit(
            "episode invariants violated: "
            f"outflows_in_two_episodes={twice} lags_outside_window={bad_lag} "
            f"inflows_not_in_exactly_one_episode={uncovered} "
            f"overlapping_episodes={overlap}")
    return n_ep, n_in, n_out, out_over_in


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Build the features table from tx and accounts.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to build into (default: {DEFAULT_DB})")
    args = ap.parse_args()

    t0 = time.perf_counter()

    for p in (SQL_PATH, EPISODE_SQL_PATH):
        if not p.is_file():
            raise SystemExit(f"SQL not found: {p}")
    if not args.db.is_file():
        raise SystemExit(f"database not found: {args.db} -- run engine\\ingest.py first")

    con = duckdb.connect(str(args.db))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")

        for t in ("tx", "accounts"):
            if not con.execute(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema='main' AND table_name=?", [t]).fetchone()[0]:
                raise SystemExit(f"table {t} is missing -- run engine\\ingest.py first")

        profile_id, profile = active_profile(con)
        params = sql_params(profile)

        print(f"database     : {args.db}")
        print(f"profile      : {profile_id}")
        print(f"  windows    : split {params['split_min_s']}-{params['split_max_s']}s,"
              f" single <= {params['single_max_s']}s")
        print(f"  cash-out   : {params['cashout_list']}")
        print(f"  cut-offs   : victim_max_out={params['victim_max_out']},"
              f" recurring_min_days={params['recurring_min_days']},"
              f" odd_hours=[{params['odd_hour_from']},{params['odd_hour_to']}),"
              f" round_unit={params['round_unit_paise']}p")

        print("  episodes   :")
        t_ep = time.perf_counter()
        n_ep, n_in_tx, n_out_tx, out_over_in = build_episodes(con, params)
        ep_seconds = time.perf_counter() - t_ep

        sql = Template(SQL_PATH.read_text(encoding="utf-8")).substitute(params)
        t_sql = time.perf_counter()
        con.execute(sql)
        sql_seconds = time.perf_counter() - t_sql

        n_rows = con.execute("SELECT count(*) FROM features").fetchone()[0]
        n_accts = con.execute("SELECT count(*) FROM accounts").fetchone()[0]
        cols = [r[0] for r in con.execute("DESCRIBE features").fetchall()]

        nulls = dict(zip(cols, con.execute(
            "SELECT " + ", ".join(f'count(*) - count("{c}") AS "{c}"' for c in cols)
            + " FROM features").fetchone()))

        for t in ("ep_inflow", "ep_window", "ep_out"):
            con.execute(f"DROP TABLE IF EXISTS {t}")

        print(f"  episodes   : {n_in_tx:,} inflows -> {n_ep:,} episodes;"
              f" {n_out_tx:,} outflows inside an episode window,"
              f" {ep_seconds:.2f}s")
        print(f"  (episodes sending more than arrived, ratio capped at 1.0:"
              f" {out_over_in:,})")
        print(f"rows         : {n_rows:,}   (accounts: {n_accts:,})")
        print(f"columns      : {len(cols)}")
        print(f"episode secs : {ep_seconds:.2f}")
        print(f"sql seconds  : {sql_seconds:.2f}")

        if n_rows != n_accts:
            raise SystemExit(f"features has {n_rows} rows but accounts has {n_accts}")

        print("\nNULL counts (NULL = not applicable, Section 4.6):")
        unexpected = []
        for c in cols:
            n = nulls[c]
            if c in NULLABLE:
                tag = NULLABLE[c] if n else "none in this dataset"
            elif n:
                tag, _ = "*** UNEXPECTED ***", unexpected.append(c)
            else:
                tag = ""
            print(f"    {c:<26} {n:>7,}  {tag}")

        if unexpected:
            print(f"\nUNEXPECTED NULLS in: {unexpected}")
        else:
            print("\nNo unexpected NULLs: every NULL above is a not-applicable case.")
        print(f"total seconds: {time.perf_counter() - t0:.2f}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
