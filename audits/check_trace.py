"""
audits/check_trace.py -- checks engine/victim_trace.py against an independent chain.

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

Cells (Section 4.4b): for every cell, the victims reverse_trace_cell walks back
to must be exactly the victims whose FORWARD trace reaches that cell's L1, and
their count and total must equal the `cells` row. The same is checked for each
network, and a merged trace of each cell's victims must add up to the single
traces.

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

import victim_trace as tracer  # noqa: E402  (engine/victim_trace.py, through sys.path)
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
        cells = con.execute(
            "SELECT c.cell_id, c.network_id, a.acct_no, c.victim_count, c.total_in_paise "
            "FROM cells c JOIN accounts a ON a.acct_id = c.l1_acct "
            "WHERE c.profile_id = ? ORDER BY c.cell_id", [profile_id]).fetchall()
    finally:
        con.close()

    t0 = time.perf_counter()
    tracer.get_context(args.db)
    load_seconds = time.perf_counter() - t0

    times: list[tuple[float, str]] = []
    acct_mismatch, tx_mismatch, not_conserved, over_held, role_wrong, fallback = [], [], [], [], [], []
    sizes = []
    reached: dict[str, set] = {}       # account -> victims whose forward trace reaches it
    paid: dict[str, int] = {}
    for v in victims:
        t0 = time.perf_counter()
        r = tracer.trace_victim(v, args.db)
        times.append((time.perf_counter() - t0, v))

        if not r["found"]:
            acct_mismatch.append((v, "not found", 0, 0))
            continue
        got_accts = {a["acct_no"] for a in r["accounts"]}
        paid[v] = r["summary"]["tainted_total"]
        for a in got_accts:
            reached.setdefault(a, set()).add(v)
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

    # ------------------------------------------------------------- cells
    cell_mismatch, cell_rows_wrong, merge_wrong = [], [], []
    rev_secs, merge_secs, sum_secs = [], [], []
    by_network: dict[int, set] = {}
    for cell_id, network_id, l1_no, victim_count, total_in in cells:
        t0 = time.perf_counter()
        rev = tracer.reverse_trace_cell(cell_id, args.db)
        rev_secs.append(time.perf_counter() - t0)
        got = {x["acct_no"] for x in rev["victims"]}
        forward = reached.get(l1_no, set())
        by_network.setdefault(network_id, set()).update(forward)
        if got != forward:
            cell_mismatch.append((cell_id, len(got - forward), len(forward - got)))
        t0 = time.perf_counter()
        cs = tracer.cell_summary(cell_id, args.db)
        sum_secs.append(time.perf_counter() - t0)
        if (rev["victim_count"] != victim_count or rev["total_in"] != total_in
                or cs["victim_count"] != victim_count or cs["total_in"] != total_in
                or cs["mules"] != sum(cs["mules_by_role"].values())):
            cell_rows_wrong.append(cell_id)
        # Merged trace of the cell's victims: per-victim parts add up to the
        # single traces, and every account's parts add up to its total.
        t0 = time.perf_counter()
        m = tracer.trace_victims(sorted(got), args.db)
        merge_secs.append(time.perf_counter() - t0)
        if (m["summary"]["tainted_total"] != sum(paid.get(v, 0) for v in got)
                or any(a[k] != sum(p[k] for p in a["by_victim"].values())
                       for a in m["accounts"] for k in ("tainted_in", "holding"))
                or any(t["tainted"] > t["amount"] + len(t["by_victim"]) for t in m["transfers"])):
            merge_wrong.append(cell_id)
    net_mismatch = []
    t0 = time.perf_counter()
    for network_id, forward in sorted(by_network.items()):
        got = {x["acct_no"] for x in tracer.reverse_trace_network(network_id, args.db)["victims"]}
        if got != forward:
            net_mismatch.append(network_id)
    net_seconds = time.perf_counter() - t0

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

    print(f"\ncells checked          : {len(cells)}")
    print(f"cell victim mismatches (reverse vs forward) : {len(cell_mismatch)}   (expect 0)")
    for cell_id, extra, missing in cell_mismatch[:10]:
        print(f"    cell {cell_id}: {extra} only in reverse, {missing} only in forward")
    print(f"cells disagreeing with the cells table      : {len(cell_rows_wrong)}")
    print(f"merged traces that do not add up            : {len(merge_wrong)}")
    print(f"networks checked {len(by_network)}, victim mismatches : {len(net_mismatch)}")
    if cells:
        print(f"reverse cell : median {statistics.median(rev_secs) * 1000:.3f} ms,"
              f" max {max(rev_secs) * 1000:.3f} ms")
        print(f"cell summary : median {statistics.median(sum_secs) * 1000:.3f} ms,"
              f" max {max(sum_secs) * 1000:.3f} ms")
        print(f"merged trace : median {statistics.median(merge_secs) * 1000:.2f} ms,"
              f" max {max(merge_secs) * 1000:.2f} ms (all victims of one cell)")
        print(f"reverse network : {net_seconds * 1000:.2f} ms for {len(by_network)} network(s)")

    if cell_mismatch or cell_rows_wrong or merge_wrong or net_mismatch:
        raise SystemExit("check_trace FAILED (see above)")
    if acct_mismatch or tx_mismatch or not_conserved or over_held or role_wrong:
        raise SystemExit("check_trace FAILED (see above)")
    print("\ncheck_trace PASSED")


if __name__ == "__main__":
    main()
