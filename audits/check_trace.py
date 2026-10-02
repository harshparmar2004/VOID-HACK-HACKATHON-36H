"""
audits/check_trace.py -- checks engine/trace.py against an independent chain.

Read-only. Nothing here feeds the pipeline.

For EVERY send-only account (found by structure: it sends and never receives)
the audit runs trace_victim() and compares the accounts and transfers it
reached with a chain computed a second way, in plain SQL over `tx` alone:

    victim  ->  its payees  ->  their outflows  ->  ...  ->  sinks

The SQL chain uses no layer_links, no scores, no roles and no CSR arrays --
only who paid whom and when:
    hop 1   every payment the victim made
    hop 2   outflows of a payee leaving inside the SPLIT-forward window after
            the victim's money arrived
    hop 3+  outflows leaving inside the SINGLE-forward window after the money
            arrived at the previous account, up to the profile's trace.max_hops
The trace reaches the same windows from the other side (the candidate role each
layer link was proven under), so agreement means the links, the graph arrays
and the traversal all tell the same story as the raw transactions.

Also checked per trace: taint is conserved (what the victim paid = what is held
+ what left untraced), no account holds more than arrived, and every role shown
is the one stored in `scores`.

Reported: mismatching victims (expect 0), median / max / slowest trace time.

Usage:  .venv\\Scripts\\python.exe audits\\check_trace.py [--db PATH]
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine"))

import trace as tracer  # noqa: E402  (engine/trace.py, found through sys.path)
from features import active_profile  # noqa: E402

DEFAULT_DB = ROOT / "data" / "case.duckdb"
MEMORY_LIMIT = "3GB"


def structural_chain(con: duckdb.DuckDBPyConnection, profile: dict) -> None:
    """Build temp table `chain` (victim, hop, acct, tx_key) from tx alone."""
    w = profile["windows"]
    split_lo = int(w["split_forward_minutes"]["min"]) * 60
    split_hi = int(w["split_forward_minutes"]["max"]) * 60
    single_hi = int(w["single_forward_max_minutes"]) * 60
    max_hops = int((profile.get("trace") or {}).get("max_hops", 4))

    con.execute("""
        CREATE OR REPLACE TEMP TABLE chain AS
        SELECT x.src AS victim, 1 AS hop, x.dst AS acct, x.ts_sec AS t, x.tx_key
        FROM tx x
        WHERE x.src NOT IN (SELECT dst FROM tx)""")
    for hop in range(2, max_hops + 1):
        lo, hi = (split_lo, split_hi) if hop == 2 else (0, single_hi)
        con.execute(f"""
            INSERT INTO chain
            SELECT DISTINCT c.victim, {hop}, x.dst, x.ts_sec, x.tx_key
            FROM chain c
            JOIN tx x ON x.src = c.acct
                     AND x.ts_sec - c.t BETWEEN {lo} AND {hi}
            WHERE c.hop = {hop - 1}""")


def main() -> None:
    ap = argparse.ArgumentParser(description="Check the victim trace against tx structure.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to read (default: {DEFAULT_DB})")
    args = ap.parse_args()

    con = duckdb.connect(str(args.db), read_only=True)
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        profile_id, profile = active_profile(con)

        t0 = time.perf_counter()
        structural_chain(con, profile)
        sql_seconds = time.perf_counter() - t0

        victims = [r[0] for r in con.execute(
            "SELECT a.acct_no FROM (SELECT DISTINCT victim FROM chain) c "
            "JOIN accounts a ON a.acct_id = c.victim ORDER BY a.acct_no").fetchall()]
        expected_accts: dict[str, set] = {v: set() for v in victims}
        expected_tx: dict[str, set] = {v: set() for v in victims}
        for v, acct, tx_key in con.execute(
                "SELECT va.acct_no, a.acct_no, c.tx_key FROM chain c "
                "JOIN accounts va ON va.acct_id = c.victim "
                "JOIN accounts a  ON a.acct_id  = c.acct").fetchall():
            expected_accts[v].add(acct)
            expected_tx[v].add(tx_key)

        # Pure structure with no timing at all, for scale only: everything
        # downstream of the victim's payees. The timed chain must sit inside it.
        loose = con.execute("""
            WITH h1 AS (SELECT DISTINCT victim, acct FROM chain WHERE hop = 1),
                 h2 AS (SELECT DISTINCT h.victim, x.dst AS acct FROM h1 h JOIN tx x ON x.src = h.acct),
                 h3 AS (SELECT DISTINCT h.victim, x.dst AS acct FROM h2 h JOIN tx x ON x.src = h.acct)
            SELECT median(n) FROM (
                SELECT victim, count(DISTINCT acct) AS n
                FROM (SELECT * FROM h1 UNION SELECT * FROM h2 UNION SELECT * FROM h3)
                GROUP BY victim)""").fetchone()[0]

        roles = dict(con.execute(
            "SELECT a.acct_no, s.role FROM scores s JOIN accounts a USING (acct_id) "
            "WHERE s.profile_id = ?", [profile_id]).fetchall())
    finally:
        con.close()

    t0 = time.perf_counter()
    tracer.get_context(args.db)
    load_seconds = time.perf_counter() - t0

    times: list[tuple[float, str]] = []
    acct_mismatch, tx_mismatch, not_conserved, over_held, role_wrong, fallback = [], [], [], [], [], []
    sizes = []
    for v in victims:
        t0 = time.perf_counter()
        r = tracer.trace_victim(v, args.db)
        times.append((time.perf_counter() - t0, v))

        if not r["found"]:
            acct_mismatch.append((v, "not found", 0, 0))
            continue
        got_accts = {a["acct_no"] for a in r["accounts"]}
        got_tx = {t["tx_key"] for t in r["transfers"]}
        sizes.append(len(got_accts))
        if got_accts != expected_accts[v]:
            acct_mismatch.append((v, "accounts", len(got_accts - expected_accts[v]),
                                  len(expected_accts[v] - got_accts)))
        if got_tx != expected_tx[v]:
            tx_mismatch.append((v, "transfers", len(got_tx - expected_tx[v]),
                                len(expected_tx[v] - got_tx)))

        s = r["summary"]
        # Rounding to whole paise happens per account, so allow 1 paisa each.
        if abs(s["tainted_total"] - s["holding_total"] - s["untraced_total"]) > len(r["accounts"]) + 1:
            not_conserved.append(v)
        if any(a["holding"] > a["tainted_in"] or a["tainted_out"] > a["tainted_in"] + 1
               for a in r["accounts"]):
            over_held.append(v)
        if any(roles.get(a["acct_no"]) != a["role"] for a in r["accounts"]):
            role_wrong.append(v)
        if s["used_fallback"]:
            fallback.append(v)

    secs = [t for t, _ in times]
    slow_t, slow_v = max(times)
    print(f"database     : {args.db}")
    print(f"profile      : {profile_id}")
    print(f"send-only accounts traced : {len(victims)}")
    print(f"SQL chain    : built from tx alone in {sql_seconds:.2f}s;"
          f" median {statistics.median(len(s) for s in expected_accts.values()):g} accounts per victim"
          f" (untimed pure structure: median {loose:g})")
    print(f"trace        : median {statistics.median(sizes):g} accounts per victim,"
          f" range {min(sizes)}-{max(sizes)}")

    print(f"\nmismatches (accounts)  : {len(acct_mismatch)}   (expect 0)")
    print(f"mismatches (transfers) : {len(tx_mismatch)}   (expect 0)")
    for v, what, extra, missing in (acct_mismatch + tx_mismatch)[:10]:
        print(f"    {v}: {what} -- {extra} only in trace, {missing} only in SQL chain")
    print(f"taint not conserved    : {len(not_conserved)}")
    print(f"holding above arrivals : {len(over_held)}")
    print(f"role differs from scores : {len(role_wrong)}")
    print(f"traces that needed the fallback : {len(fallback)}")

    print(f"\ncontext load : {load_seconds * 1000:.0f} ms (once per process)")
    print(f"trace time   : median {statistics.median(secs) * 1000:.2f} ms,"
          f" max {slow_t * 1000:.2f} ms (slowest: {slow_v})")
    print(f"all traces   : {sum(secs):.2f} s")

    if acct_mismatch or tx_mismatch or not_conserved or over_held or role_wrong:
        raise SystemExit("check_trace FAILED (see above)")
    print("\ncheck_trace PASSED")


if __name__ == "__main__":
    main()
