"""
engine/links.py -- Step 4b of the Abhedya-Chakra pipeline: layer links.

    scores (pass 1) + features + tx  ->  layer_links
                                         (DELETE for the profile, then INSERT)

A layer link is one transaction that proves money moved between layers
(PROJECT_CONTEXT.md Section 4.3b): right direction (upper -> lower), right
timing (after money arrived at the sender, inside the pass-through window) and
an amount that fits within what arrived. Link types: VICTIM_L1, L1_L2, L2_L2,
L2_L3.

Built from FLAGGED accounts (scores.is_flagged, pass 1) and VICTIM-LIKE accounts
(send-only, very few payments). from_role / to_role hold behaviour-only
CANDIDATE roles; the role itself is assigned in pass 2 from these links.
A receive-only sink is the one unflagged account that may END a link: it never
forwards, so pass 1 cannot flag it on pass-through, and it is only ever linked
as the receiver of a flagged account's in-window forward.

Rules this script obeys (Sections 4.6 and 8):
  * Time windows and EPISODE amounts only. The episode tables are rebuilt with
    the same SQL as the features step (engine/sql/features_episode.sql), so a
    link and a feature can never disagree about what an episode is.
  * tx_key is a unique key, never an order: no ORDER BY, window function or
    tie-break on it anywhere in engine/sql/links.sql.
  * Windows and cut-offs come from the ACTIVE profile -- nothing hard-coded.
  * All data work is DuckDB SQL; no Python loop over transactions or accounts.
  * No ground-truth labels, account-number ranges, IP prefixes or device-count
    fingerprints.
  * The connection is closed in a finally block.

Not written here: ring_id (rings step), scores.candidate_roles / role scores
(pass 2).

Usage:
    .venv\\Scripts\\python.exe engine\\links.py
    .venv\\Scripts\\python.exe engine\\links.py --db %TEMP%\\case_review.duckdb
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from string import Template

import duckdb

# Same directory as this script: the episode rule and the profile-to-SQL
# mapping are shared with the features step, never re-implemented.
from features import active_profile, build_episodes, split_sections, sql_params

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"
SQL_PATH = ENGINE_DIR / "sql" / "links.sql"

MEMORY_LIMIT = "3GB"

LINK_TYPES = ("VICTIM_L1", "L1_L2", "L2_L2", "L2_L3")

# Which MP2 pattern (profile: mule_index MP2 rule.pattern.any_of[].name) reads
# as which candidate layer: a split forward is L1 behaviour, a single forward
# is L2 behaviour (Section 4.3b). The receiver counts themselves are profile
# values.
PATTERN_ROLE = {"split": "l1", "single": "l2"}


def link_params(profile: dict) -> dict[str, str]:
    """Windows, cut-offs and candidate patterns from the profile, as SQL text."""
    params = sql_params(profile)          # windows + victim_max_out, validated ints

    def as_int(v, what: str) -> str:
        if isinstance(v, bool) or not isinstance(v, int):
            raise SystemExit(f"profile {what} must be an integer, got {v!r}")
        return str(v)

    mp2 = next((p for p in profile["mule_index"]["parameters"] if p["id"] == "MP2"), None)
    try:
        alts = {a["name"]: a for a in mp2["rule"]["pattern"]["any_of"]}
    except (TypeError, KeyError):
        raise SystemExit(
            "profile MP2 rule has no pattern block -- reseed from engine\\config.yaml")
    for name, role in PATTERN_ROLE.items():
        if name not in alts:
            raise SystemExit(f"profile MP2 pattern is missing the {name!r} alternative")
        r = alts[name]["receivers"]
        params[f"{role}_receivers_min"] = as_int(r["min"], f"MP2 {name} receivers.min")
        params[f"{role}_receivers_max"] = as_int(r["max"], f"MP2 {name} receivers.max")

    # A single forward has no lower bound on its lag (Section 4.1: "<= 60 min").
    params["single_min_s"] = "0"
    return params


def build(con: duckdb.DuckDBPyConnection, label: str = "") -> None:
    """Prove the layer links of the active profile on `con` and refill its rows.

    `con` is the case file (engine runs) or an in-memory connection (the API's
    profile preview); the statements are the same.
    """
    t0 = time.perf_counter()
    if not SQL_PATH.is_file():
        raise SystemExit(f"SQL not found: {SQL_PATH}")

    for t, step in (("tx", "ingest.py"), ("features", "features.py"),
                    ("scores", "apply_schema.py"), ("layer_links", "apply_schema.py")):
        if not con.execute(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema='main' AND table_name=?", [t]).fetchone()[0]:
            raise SystemExit(f"table {t} is missing -- run engine\\{step} first")

    profile_id, profile = active_profile(con)
    params = link_params(profile)

    n_scores, n_flagged = con.execute(
        "SELECT count(*), count(*) FILTER (WHERE is_flagged) FROM scores "
        "WHERE profile_id = ?", [profile_id]).fetchone()
    if not n_scores:
        raise SystemExit(
            f"no scores for profile {profile_id} -- run engine\\scoring.py first")

    print(f"database     : {label}")
    print(f"profile      : {profile_id}")
    print(f"  windows    : split {params['split_min_s']}-{params['split_max_s']}s,"
          f" single {params['single_min_s']}-{params['single_max_s']}s")
    print(f"  candidates : L1 = flagged, {params['l1_receivers_min']}-"
          f"{params['l1_receivers_max']} receivers per inflow;"
          f" L2 = flagged, {params['l2_receivers_min']}-{params['l2_receivers_max']};"
          f" L3 = receive-only; VICTIM = send-only, <= {params['victim_max_out']} payments")

    sections = split_sections(
        Template(SQL_PATH.read_text(encoding="utf-8")).substitute(params))
    for name in ("CANDIDATES", "LINKS", "PAIRS", "CHECK"):
        if name not in sections:
            raise SystemExit(f"{SQL_PATH.name} is missing section @@{name}")

    print("  episodes   :")
    t_ep = time.perf_counter()
    build_episodes(con, params)
    ep_seconds = time.perf_counter() - t_ep

    t_sql = time.perf_counter()
    con.execute(sections["CANDIDATES"], [profile_id])
    con.execute(sections["LINKS"])

    # Refill this profile only; other profiles' rows are untouched (Section 9).
    con.execute("BEGIN")
    try:
        con.execute("DELETE FROM layer_links WHERE profile_id = ?", [profile_id])
        con.execute(
            "INSERT INTO layer_links (profile_id, tx_key, tx_id, from_acct, to_acct, "
            "from_role, to_role, link_type, lag_seconds, amount_paise, share_of_inflow) "
            "SELECT ?, tx_key, tx_id, from_acct, to_acct, from_role, to_role, "
            "link_type, lag_seconds, amount_paise, share_of_inflow FROM link_build",
            [profile_id])
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    sql_seconds = time.perf_counter() - t_sql

    print(f"\nflagged accounts : {n_flagged:,} of {n_scores:,}")
    print("candidate roles  :")
    for cand, n, fl in con.execute(
            "SELECT cand, count(*), count(*) FILTER (WHERE is_flagged) FROM link_cand "
            "WHERE cand IS NOT NULL GROUP BY cand ORDER BY cand").fetchall():
        print(f"    {cand:<18} {n:>6,}   (flagged {fl:,})")

    counts = dict(con.execute(
        "SELECT link_type, count(*) FROM layer_links WHERE profile_id = ? "
        "GROUP BY link_type", [profile_id]).fetchall())
    stats = {r[0]: r[1:] for r in con.execute(
        "SELECT link_type, min(lag_seconds), median(lag_seconds), max(lag_seconds),"
        "       median(share_of_inflow), sum(amount_paise) / 100.0,"
        "       count(DISTINCT from_acct), count(DISTINCT to_acct) "
        "FROM layer_links WHERE profile_id = ? GROUP BY link_type",
        [profile_id]).fetchall()}
    print("\nlinks per link_type:")
    for lt in LINK_TYPES:
        line = f"    {lt:<10} {counts.get(lt, 0):>6,}"
        if lt in stats:
            lo, med, hi, share, rupees, n_from, n_to = stats[lt]
            line += f"   {n_from:,} senders -> {n_to:,} receivers, Rs {rupees:,.0f}"
            if lo is not None:
                line += (f", lag {lo}-{hi}s (median {med:.0f}s),"
                         f" median share of inflow {share:.3f}")
        print(line)
    print(f"    {'total':<10} {sum(counts.values()):>6,}")

    print("\ntransactions between candidates, by role pair (tx / became links):")
    for a, b, n_tx, n_links in con.execute(sections["PAIRS"]).fetchall():
        print(f"    {a:<18} -> {b:<18} {n_tx:>6,} / {n_links:>6,}")

    outside, no_arrival, differs, bad_share = con.execute(sections["CHECK"]).fetchone()
    print(f"\nlinks with lag outside the window          : {outside}   (must be 0)")
    print(f"links with no arrival in the window (re-derived from tx) : {no_arrival}")
    print(f"links whose lag differs when re-derived from tx          : {differs}")
    print(f"links with share_of_inflow outside (0, 1]                : {bad_share}")

    for t in ("ep_inflow", "ep_window", "ep_out", "link_cand", "link_build"):
        con.execute(f"DROP TABLE IF EXISTS {t}")

    print(f"\nepisode secs : {ep_seconds:.2f}")
    print(f"sql seconds  : {sql_seconds:.2f}")
    print(f"total seconds: {time.perf_counter() - t0:.2f}")

    if outside or no_arrival or differs or bad_share:
        raise SystemExit("layer_links FAILED its timing / amount check (see above)")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fill layer_links for the active profile from pass-1 scores.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to build into (default: {DEFAULT_DB})")
    args = ap.parse_args()

    if not args.db.is_file():
        raise SystemExit(f"database not found: {args.db} -- run engine\\ingest.py first")

    con = duckdb.connect(str(args.db))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        build(con, str(args.db))
    finally:
        con.close()


if __name__ == "__main__":
    main()
