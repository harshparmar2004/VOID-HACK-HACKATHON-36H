"""
engine/rings.py -- Step 4d of the Abhedya-Chakra pipeline: rings and cells.

    layer_links + scores (pass 2) + tx  ->  rings
                                            + ring_id on layer_links and scores
                                            + cells, cell_members
                                            (DELETE for the profile, then INSERT)

A ring is a connected component of the proven layer links: every account
joined, directly or through other accounts, by a link (PROJECT_CONTEXT.md
Sections 4.4b and 9). Per ring:
  * size (mule accounts -- victims are counted apart), l1 / l2 / l3 /
    unclassified counts from scores.role, victim_count
  * total_in_paise  = money that entered through Victim -> L1 links
  * holding_paise   = linked money that arrived at a mule account and was not
                      forwarded on (freeze priority, Section 4.4)
  * first_ts / last_ts of its links
  * patterns        SCATTER_GATHER, FUNNEL, CYCLE (cut-offs: profile `rings`)
  * fingerprint     SHA-256 of the ring's sorted tx_keys, comma-joined --
                    the same evidence always gives the same hash. tx_key (not
                    tx_id) because Transaction_ID is not unique in this file.

The ring is the whole NETWORK (network_id = ring_id). A CELL is the unit to
work a case on: one cell per confirmed L1, with every account downstream of it
through layer links and the victims that paid it. An account reached from
several L1s belongs to each such cell, so cells overlap and their totals do
not add up to the network's. Cells carry the same fields as rings; a cell's
holding is the sum of its mule accounts' holdings.

Run AFTER scoring.py pass 2: role counts read scores.role, and pass 2 resets
scores.ring_id to NULL, so this script must be rerun after every scoring run.

Rules this script obeys (Sections 4.6 and 8):
  * Components by min-label propagation in SQL -- a loop over ROUNDS, never
    over accounts or transactions. Cycle detection is one vectorised SciPy call
    on the link graph.
  * tx_key is a key and the hash input, never an order or adjacency signal.
  * Pattern cut-offs come from the ACTIVE profile.
  * The connection is closed in a finally block.

Usage:
    .venv\\Scripts\\python.exe engine\\rings.py
    .venv\\Scripts\\python.exe engine\\rings.py --db %TEMP%\\case_review.duckdb
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from string import Template

import duckdb
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

# Same directory as this script: shared helpers, never re-implemented.
from features import active_profile, split_sections

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"
SQL_PATH = ENGINE_DIR / "sql" / "rings.sql"

MEMORY_LIMIT = "3GB"

SECTIONS = ("LINKS", "EDGES", "INIT", "STEP", "CHANGED", "MEMBERS", "RINGS", "CELLS")

RING_FIELDS = ("size, l1_count, l2_count, l3_count, unclassified_count, victim_count, "
               "total_in_paise, holding_paise, first_ts, last_ts, patterns, fingerprint")


def ring_params(profile_id: str, profile: dict) -> dict[str, str]:
    """Pattern cut-offs from the profile, as SQL text."""
    try:
        pat = profile["rings"]["patterns"]
    except KeyError:
        raise SystemExit(
            "profile has no rings.patterns block -- reseed from engine\\config.yaml")

    def as_int(key: str) -> str:
        v = pat.get(key)
        if isinstance(v, bool) or not isinstance(v, int) or v < 2:
            raise SystemExit(f"profile rings.patterns.{key} must be an integer >= 2, got {v!r}")
        return str(v)

    return {
        "profile": "'" + profile_id.replace("'", "''") + "'",
        "scatter_min": as_int("scatter_gather_min_branches"),
        "funnel_min": as_int("funnel_min_mule_senders"),
    }


def accounts_on_cycles(con: duckdb.DuckDBPyConnection) -> str:
    """acct_ids on a directed cycle of links, as a SQL IN-list.

    A strongly connected component with more than one account is a cycle; so is
    a link from an account to itself.
    """
    e = con.execute("SELECT DISTINCT from_acct, to_acct FROM ring_link").fetchnumpy()
    src, dst = np.asarray(e["from_acct"]), np.asarray(e["to_acct"])
    nodes, inv = np.unique(np.concatenate([src, dst]), return_inverse=True)
    s, d = inv[:len(src)], inv[len(src):]
    graph = coo_matrix((np.ones(len(s), dtype=np.int8), (s, d)),
                       shape=(len(nodes), len(nodes))).tocsr()
    _, comp = connected_components(graph, directed=True, connection="strong")
    on_cycle = np.bincount(comp)[comp] > 1
    on_cycle[s[s == d]] = True
    # NULL keeps "acct IN (...)" valid SQL when the link graph is a DAG.
    return ", ".join(str(int(a)) for a in nodes[on_cycle]) or "NULL"


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Build rings for the active profile from layer_links.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to build into (default: {DEFAULT_DB})")
    args = ap.parse_args()

    t0 = time.perf_counter()

    if not SQL_PATH.is_file():
        raise SystemExit(f"SQL not found: {SQL_PATH}")
    if not args.db.is_file():
        raise SystemExit(f"database not found: {args.db} -- run engine\\ingest.py first")

    con = duckdb.connect(str(args.db))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")

        for t in ("tx", "scores", "layer_links", "rings", "cells", "cell_members"):
            if not con.execute(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema='main' AND table_name=?", [t]).fetchone()[0]:
                raise SystemExit(f"table {t} is missing -- run engine\\apply_schema.py "
                                 "and the earlier pipeline steps first")

        profile_id, profile = active_profile(con)
        params = ring_params(profile_id, profile)

        n_links, n_roles = con.execute(
            "SELECT (SELECT count(*) FROM layer_links WHERE profile_id = ?),"
            "       (SELECT count(*) FROM scores WHERE profile_id = ? AND role IS NOT NULL)",
            [profile_id, profile_id]).fetchone()
        if not n_links:
            raise SystemExit(f"no layer_links for profile {profile_id} -- run engine\\links.py first")
        if not n_roles:
            raise SystemExit(
                f"no roles in scores for profile {profile_id} -- run engine\\scoring.py (pass 2) first")

        print(f"database     : {args.db}")
        print(f"profile      : {profile_id}")
        print(f"  patterns   : SCATTER_GATHER >= {params['scatter_min']} branches,"
              f" FUNNEL >= {params['funnel_min']} mule senders, CYCLE = any directed cycle")

        raw = SQL_PATH.read_text(encoding="utf-8")
        # $cycle_accts is only known once the links are loaded; fill the rest now.
        sections = split_sections(Template(raw).safe_substitute(params))
        for name in SECTIONS:
            if name not in sections:
                raise SystemExit(f"{SQL_PATH.name} is missing section @@{name}")

        t_sql = time.perf_counter()
        for name in ("LINKS", "EDGES", "INIT"):
            con.execute(sections[name])

        # Min-label propagation. It converges within the longest shortest path
        # of any ring, and can never need more rounds than there are accounts.
        n_nodes = con.execute("SELECT count(*) FROM ring_comp").fetchone()[0]
        rounds = 0
        while True:
            con.execute(sections["STEP"])
            changed = con.execute(sections["CHANGED"]).fetchone()[0]
            con.execute("DROP TABLE ring_comp")
            con.execute("ALTER TABLE ring_comp_next RENAME TO ring_comp")
            if not changed:
                break
            rounds += 1
            if rounds > n_nodes:
                raise SystemExit("ring components did not converge")

        cycle_accts = accounts_on_cycles(con)
        con.execute(sections["MEMBERS"])
        con.execute(Template(sections["RINGS"]).substitute(cycle_accts=cycle_accts))
        con.execute(Template(sections["CELLS"]).substitute(cycle_accts=cycle_accts))

        # Refill this profile only; other profiles' rows are untouched (Section 9).
        con.execute("BEGIN")
        try:
            con.execute("DELETE FROM rings WHERE profile_id = ?", [profile_id])
            con.execute(
                f"INSERT INTO rings (profile_id, ring_id, {RING_FIELDS}) "
                f"SELECT ?, ring_id, {RING_FIELDS} FROM ring_build", [profile_id])
            con.execute("DELETE FROM cells WHERE profile_id = ?", [profile_id])
            con.execute("DELETE FROM cell_members WHERE profile_id = ?", [profile_id])
            con.execute(
                f"INSERT INTO cells (profile_id, cell_id, network_id, l1_acct, {RING_FIELDS}) "
                f"SELECT ?, cell_id, network_id, l1_acct, {RING_FIELDS} FROM cell_build",
                [profile_id])
            con.execute(
                "INSERT INTO cell_members (profile_id, cell_id, acct_id, role) "
                "SELECT ?, b.cell_id, m.acct, m.role FROM cell_member m "
                "JOIN cell_build b ON b.l1_acct = m.l1", [profile_id])
            # Stamp the ring on its links and on its member accounts.
            con.execute(
                "UPDATE layer_links SET ring_id = m.ring_id "
                "FROM (SELECT c.acct, b.ring_id FROM ring_comp c "
                "      JOIN ring_build b ON b.label = c.label) m "
                "WHERE layer_links.profile_id = ? AND layer_links.from_acct = m.acct",
                [profile_id])
            con.execute("UPDATE scores SET ring_id = NULL "
                        "WHERE profile_id = ? AND ring_id IS NOT NULL", [profile_id])
            con.execute(
                "UPDATE scores SET ring_id = m.ring_id "
                "FROM (SELECT c.acct, b.ring_id FROM ring_comp c "
                "      JOIN ring_build b ON b.label = c.label) m "
                "WHERE scores.profile_id = ? AND scores.acct_id = m.acct",
                [profile_id])
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
        sql_seconds = time.perf_counter() - t_sql

        # ---------------------------------------------------------- report
        n_rings, min_size, med_size, max_size, min_all, max_all = con.execute(
            "SELECT count(*), min(size), median(size), max(size),"
            "       min(size + victim_count), max(size + victim_count) "
            "FROM rings WHERE profile_id = ?", [profile_id]).fetchone()
        print(f"\nlinks        : {n_links:,}   accounts linked: {n_nodes:,}"
              f"   propagation rounds: {rounds}")
        print(f"rings        : {n_rings:,}")
        print(f"ring size    : {min_size}-{max_size} mule accounts (median {med_size:g});"
              f" {min_all}-{max_all} including victims")

        l1, l2, l3, unc, vic, total_in, holding = con.execute(
            "SELECT sum(l1_count), sum(l2_count), sum(l3_count), sum(unclassified_count),"
            "       sum(victim_count), sum(total_in_paise) / 100.0, sum(holding_paise) / 100.0 "
            "FROM rings WHERE profile_id = ?", [profile_id]).fetchone()
        print(f"members      : L1 {l1:,}  L2 {l2:,}  L3 {l3:,}  unclassified {unc:,}"
              f"  victims {vic:,}")
        print(f"money        : Rs {total_in:,.0f} entered from victims;"
              f" Rs {holding:,.0f} still held in ring accounts")

        print("\nring size distribution (mule accounts):")
        for lo, hi, n in con.execute(
                "SELECT min(size), max(size), count(*) FROM ("
                "  SELECT size, CASE WHEN size <= 5 THEN 0 WHEN size <= 10 THEN 1"
                "                    WHEN size <= 25 THEN 2 WHEN size <= 100 THEN 3 ELSE 4 END AS b"
                "  FROM rings WHERE profile_id = ?) GROUP BY b ORDER BY b",
                [profile_id]).fetchall():
            print(f"    {lo:>4}-{hi:<4} {n:>5,} rings")

        print("\npatterns (rings showing each):")
        pats = con.execute(
            "SELECT p, count(*) FROM (SELECT unnest(patterns) AS p FROM rings "
            "WHERE profile_id = ?) GROUP BY p ORDER BY p", [profile_id]).fetchall()
        for p, n in pats:
            print(f"    {p:<16} {n:>5,}")
        if not pats:
            print("    (none)")

        print("\nlargest rings:")
        for r in con.execute(
                "SELECT ring_id, size, l1_count, l2_count, l3_count, unclassified_count,"
                "       victim_count, total_in_paise / 100.0, holding_paise / 100.0,"
                "       first_ts, last_ts, patterns, left(fingerprint, 12) "
                "FROM rings WHERE profile_id = ? ORDER BY ring_id LIMIT 5",
                [profile_id]).fetchall():
            print(f"    ring {r[0]:<3} size {r[1]:<4} L1 {r[2]:<3} L2 {r[3]:<3} L3 {r[4]:<3}"
                  f" uncl {r[5]:<2} victims {r[6]:<3} in Rs {r[7]:>12,.0f}"
                  f" held Rs {r[8]:>12,.0f}  {r[9]} -> {r[10]}  {r[11]}  sha {r[12]}")

        # ------------------------------------------------------------ cells
        n_cells, c_min, c_med, c_max, c_min_all, c_max_all = con.execute(
            "SELECT count(*), min(size), median(size), max(size),"
            "       min(size + victim_count), max(size + victim_count) "
            "FROM cells WHERE profile_id = ?", [profile_id]).fetchone()
        print(f"\ncells        : {n_cells:,} (one per confirmed L1)")
        if n_cells:
            print(f"cell size    : {c_min}-{c_max} mule accounts (median {c_med:g});"
                  f" {c_min_all}-{c_max_all} including victims")
            v_min, v_max, in_min, in_max, h_min, h_max = con.execute(
                "SELECT min(victim_count), max(victim_count), min(total_in_paise) / 100.0,"
                "       max(total_in_paise) / 100.0, min(holding_paise) / 100.0,"
                "       max(holding_paise) / 100.0 FROM cells WHERE profile_id = ?",
                [profile_id]).fetchone()
            print(f"cell victims : {v_min}-{v_max};  in Rs {in_min:,.0f}-{in_max:,.0f};"
                  f"  held Rs {h_min:,.0f}-{h_max:,.0f}")
            shared, most = con.execute(
                "SELECT count(*) FILTER (WHERE n > 1), max(n) FROM ("
                "  SELECT count(*) AS n FROM cell_members WHERE profile_id = ? "
                "  AND role IS DISTINCT FROM 'VICTIM' GROUP BY acct_id)",
                [profile_id]).fetchone()
            print(f"shared mules : {shared:,} accounts are in more than one cell (most: {most})")
            print("cell patterns:", ", ".join(f"{p} {n:,}" for p, n in con.execute(
                "SELECT p, count(*) FROM (SELECT unnest(patterns) AS p FROM cells "
                "WHERE profile_id = ?) GROUP BY p ORDER BY p", [profile_id]).fetchall())
                or "(none)")

        l1_no_cell, mule_no_cell, cell_dup_fp, cell_bad, cell_no_net = con.execute(
            "SELECT"
            " (SELECT count(*) FROM scores s WHERE s.profile_id = $p AND s.role = 'L1'"
            "    AND s.role_confirmed AND s.acct_id NOT IN"
            "        (SELECT l1_acct FROM cells WHERE profile_id = $p)),"
            " (SELECT count(*) FROM scores s WHERE s.profile_id = $p AND s.is_flagged"
            "    AND s.ring_id IS NOT NULL AND s.acct_id NOT IN"
            "        (SELECT acct_id FROM cell_members WHERE profile_id = $p)),"
            " (SELECT count(*) - count(DISTINCT fingerprint) FROM cells WHERE profile_id = $p),"
            " (SELECT count(*) FROM cells c WHERE c.profile_id = $p AND c.size + c.victim_count <>"
            "    (SELECT count(*) FROM cell_members m WHERE m.profile_id = $p"
            "       AND m.cell_id = c.cell_id)),"
            " (SELECT count(*) FROM cells WHERE profile_id = $p AND network_id IS NULL)",
            {"p": profile_id}).fetchone()
        print(f"cell checks  : confirmed L1s without a cell={l1_no_cell},"
              f" linked mules in no cell={mule_no_cell}, duplicate fingerprints={cell_dup_fp},"
              f" cells whose size disagrees with cell_members={cell_bad},"
              f" cells without a network={cell_no_net}")

        # ----------------------------------------------------------- checks
        unringed, split_links, dup_fp, bad_members, lost_links = con.execute(
            "SELECT"
            " (SELECT count(*) FROM layer_links WHERE profile_id = $p AND ring_id IS NULL),"
            " (SELECT count(*) FROM layer_links l"
            "    JOIN scores a ON a.acct_id = l.from_acct AND a.profile_id = l.profile_id"
            "    JOIN scores b ON b.acct_id = l.to_acct   AND b.profile_id = l.profile_id"
            "   WHERE l.profile_id = $p AND (a.ring_id IS DISTINCT FROM l.ring_id"
            "                                OR b.ring_id IS DISTINCT FROM l.ring_id)),"
            " (SELECT count(*) - count(DISTINCT fingerprint) FROM rings WHERE profile_id = $p),"
            " (SELECT count(*) FROM rings r WHERE r.profile_id = $p AND r.size + r.victim_count <>"
            "    (SELECT count(*) FROM scores s WHERE s.profile_id = $p AND s.ring_id = r.ring_id)),"
            " (SELECT count(*) FROM layer_links WHERE profile_id = $p)"
            "   - (SELECT coalesce(sum(n_links), 0) FROM ring_build)",
            {"p": profile_id}).fetchone()
        print(f"\nchecks       : links without a ring={unringed}, links crossing rings={split_links},"
              f" duplicate fingerprints={dup_fp}, rings whose size disagrees with scores={bad_members},"
              f" links not counted in a ring={lost_links}")

        for t in ("ring_link", "ring_edge", "ring_comp", "ring_comp_next", "ring_member",
                  "ring_build", "cell_reach", "cell_link", "cell_member", "cell_build"):
            con.execute(f"DROP TABLE IF EXISTS {t}")

        print(f"\nsql seconds  : {sql_seconds:.2f}")
        print(f"total seconds: {time.perf_counter() - t0:.2f}")

        # "linked mules in no cell" is reported, not failed: a flagged account
        # joined to the network only above or beside every confirmed L1 has no
        # cell, and that is a finding for the officer rather than a bug.
        if (unringed or split_links or dup_fp or bad_members or lost_links
                or l1_no_cell or cell_dup_fp or cell_bad or cell_no_net):
            raise SystemExit("rings FAILED a consistency check (see above)")
    finally:
        con.close()


if __name__ == "__main__":
    main()
