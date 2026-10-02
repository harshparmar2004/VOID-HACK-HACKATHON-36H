"""Section G — Payment_Mode."""
from __future__ import annotations

import time

from _common import connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        g1 = con.execute(
            """
            SELECT mode, count(*) n, sum(CASE WHEN mode <> trim(mode) THEN 1 ELSE 0 END) AS spaced
            FROM t GROUP BY 1 ORDER BY n DESC
            """
        ).fetchall()
        vals = [{"mode": r[0], "n": r[1], "spaced": r[2]} for r in g1]
        n_other = con.execute(
            "SELECT count(*) FROM t WHERE mode NOT IN ('UPI','IMPS','NEFT','RTGS')"
        ).fetchone()[0]
        g1_ex = rows_to_dicts(
            con,
            "SELECT tx_id, mode, amount FROM t WHERE mode NOT IN ('UPI','IMPS','NEFT','RTGS') LIMIT 5",
        )

        # G2 [KNOWN] narration rail vs mode
        g2 = con.execute(
            """
            SELECT mode, narr_rail, count(*) n
            FROM t
            GROUP BY 1,2
            ORDER BY 1, n DESC
            """
        ).fetchall()
        g2d = [{"mode": r[0], "rail": r[1], "n": r[2]} for r in g2]
        # per-mode rail shares
        shares = con.execute(
            """
            SELECT mode,
              count(*) n,
              avg(CASE WHEN narr_rail='UPI' THEN 1.0 ELSE 0.0 END) AS p_upi,
              avg(CASE WHEN narr_rail='IMPS' THEN 1.0 ELSE 0.0 END) AS p_imps,
              avg(CASE WHEN narr_rail='NEFT' THEN 1.0 ELSE 0.0 END) AS p_neft,
              avg(CASE WHEN narr_rail='RTGS' THEN 1.0 ELSE 0.0 END) AS p_rtgs,
              avg(CASE WHEN narr_rail NOT IN ('UPI','IMPS','NEFT','RTGS') THEN 1.0 ELSE 0.0 END) AS p_other
            FROM t GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        sh = [
            {"mode": r[0], "n": r[1], "p_upi": r[2], "p_imps": r[3], "p_neft": r[4], "p_rtgs": r[5], "p_other": r[6]}
            for r in shares
        ]
    finally:
        con.close()

    checks = []
    modes = {v["mode"] for v in vals}
    expected = {"UPI", "IMPS", "NEFT", "RTGS"}
    checks.append(
        rec(
            "G1",
            f"distinct modes={vals}; other-than-4={n_other}",
            int(n_other),
            g1_ex if n_other else vals,
            "CLEAN" if modes <= expected and n_other == 0 else "TRAP",
            "Exact set UPI/IMPS/NEFT/RTGS, no case variants. Reject anything else.",
            extra={"values": vals},
        )
    )
    # confirm ~71/14/14 independent of mode
    upi_shares = [s["p_upi"] for s in sh]
    spread = max(upi_shares) - min(upi_shares) if upi_shares else 0
    checks.append(
        rec(
            "G2",
            f"per-mode rail shares={sh}; max-min UPI-rail share={spread:.4f}",
            0,
            sh,
            "NOISE",
            "Rail vs Payment_Mode mismatch is generator noise — do not score it (Section 3b).",
            extra={"cells": g2d, "shares": sh},
        )
    )
    dump_section("G", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
