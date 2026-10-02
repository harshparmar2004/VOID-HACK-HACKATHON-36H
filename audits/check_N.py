"""Section N — already-decided items, confirm only."""
from __future__ import annotations

import time

from _common import connect, dump_section, print_checks, rec


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        n_ids = con.execute(
            """
            SELECT count(*) FROM (
              SELECT tx_id FROM t GROUP BY 1 HAVING count(*) > 1
            )
            """
        ).fetchone()[0]
        n_rows = con.execute(
            """
            SELECT coalesce(sum(n),0) FROM (
              SELECT count(*) n FROM t GROUP BY tx_id HAVING count(*) > 1
            )
            """
        ).fetchone()[0]
        thrice = con.execute(
            """
            SELECT count(*) FROM (
              SELECT tx_id FROM t GROUP BY 1 HAVING count(*) = 3
            )
            """
        ).fetchone()[0]

        acct_ok = con.execute(
            """
            SELECT
              sum(CASE WHEN regexp_full_match(src_acct, '^[A-Z]{4}[0-9]{8}$') THEN 1 ELSE 0 END),
              count(*)
            FROM t
            """
        ).fetchone()

        shares = con.execute(
            """
            SELECT mode,
              round(avg(CASE WHEN narr_rail='UPI' THEN 1.0 ELSE 0.0 END), 3) AS p_upi,
              round(avg(CASE WHEN narr_rail='IMPS' THEN 1.0 ELSE 0.0 END), 3) AS p_imps,
              round(avg(CASE WHEN narr_rail='NEFT' THEN 1.0 ELSE 0.0 END), 3) AS p_neft
            FROM t GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        sh = [{"mode": r[0], "p_upi": r[1], "p_imps": r[2], "p_neft": r[3]} for r in shares]
    finally:
        con.close()

    checks = []
    checks.append(
        rec(
            "N1",
            f"Transaction_ID not unique: {n_ids} IDs over {n_rows} rows; thrice={thrice}. Handled with tx_key.",
            int(n_rows),
            [{"n_ids": n_ids, "n_rows": n_rows, "thrice": thrice}],
            "NOISE",
            "Already decided: keep both rows; join on tx_key.",
        )
    )
    ok, n = acct_ok
    checks.append(
        rec(
            "N2",
            f"accounts matching ^[A-Z]{{4}}[0-9]{{8}}$ : {ok}/{n}",
            int(n - ok),
            [],
            "CLEAN" if ok == n else "TRAP",
            "Already decided: 4 letters + 8 digits.",
        )
    )
    checks.append(
        rec(
            "N3",
            f"narration rail vs Payment_Mode shares by mode={sh}",
            0,
            sh,
            "NOISE",
            "Already decided: rail mismatch is noise, do not score.",
        )
    )
    dump_section("N", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
