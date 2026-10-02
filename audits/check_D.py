"""Section D — IFSC."""
from __future__ import annotations

import time

from _common import connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        d1 = con.execute(
            """
            SELECT
              count(*) n,
              sum(CASE WHEN regexp_full_match(src_ifsc, '^[A-Z]{4}0[0-9A-Z]{6}$') THEN 1 ELSE 0 END) AS src_ok,
              sum(CASE WHEN regexp_full_match(dst_ifsc, '^[A-Z]{4}0[0-9A-Z]{6}$') THEN 1 ELSE 0 END) AS dst_ok,
              sum(CASE WHEN substr(src_ifsc,5,1)='0' THEN 1 ELSE 0 END) AS src_5th0,
              sum(CASE WHEN substr(dst_ifsc,5,1)='0' THEN 1 ELSE 0 END) AS dst_5th0,
              sum(CASE WHEN length(src_ifsc)<>11 OR length(dst_ifsc)<>11 THEN 1 ELSE 0 END) AS bad_len
            FROM t
            """
        ).fetchone()
        d1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_ifsc, dst_ifsc
            FROM t
            WHERE regexp_full_match(src_ifsc, '^[A-Z]{4}0[0-9A-Z]{6}$') = false
               OR regexp_full_match(dst_ifsc, '^[A-Z]{4}0[0-9A-Z]{6}$') = false
            LIMIT 5
            """,
        )

        prefixes = con.execute(
            """
            WITH u AS (
              SELECT src_ifsc_bank AS bank FROM t
              UNION ALL
              SELECT dst_ifsc_bank FROM t
            )
            SELECT bank, count(*) AS n FROM u GROUP BY 1 ORDER BY n DESC
            """
        ).fetchall()
        pref = [{"bank": r[0], "n": r[1]} for r in prefixes]

        branches = con.execute(
            """
            WITH u AS (
              SELECT src_ifsc_bank AS bank, substr(src_ifsc, 5, 7) AS branch FROM t
              UNION
              SELECT dst_ifsc_bank, substr(dst_ifsc, 5, 7) FROM t
            )
            SELECT bank, count(*) AS n_branches FROM u GROUP BY 1 ORDER BY n_branches DESC
            """
        ).fetchall()
        br = [{"bank": r[0], "n_branches": r[1]} for r in branches]
        reused = con.execute(
            """
            WITH u AS (
              SELECT src_ifsc_bank AS bank, substr(src_ifsc, 6, 6) AS code FROM t
              UNION
              SELECT dst_ifsc_bank, substr(dst_ifsc, 6, 6) FROM t
            )
            SELECT code, count(DISTINCT bank) AS n_banks, list(DISTINCT bank) AS banks
            FROM u GROUP BY 1 HAVING count(DISTINCT bank) > 1
            ORDER BY n_banks DESC, code LIMIT 5
            """
        ).fetchall()
        n_reused = con.execute(
            """
            WITH u AS (
              SELECT src_ifsc_bank AS bank, substr(src_ifsc, 6, 6) AS code FROM t
              UNION
              SELECT dst_ifsc_bank, substr(dst_ifsc, 6, 6) FROM t
            )
            SELECT count(*) FROM (
              SELECT code FROM u GROUP BY 1 HAVING count(DISTINCT bank) > 1
            )
            """
        ).fetchone()[0]
        reused_ex = [{"code": r[0], "n_banks": r[1], "banks": r[2]} for r in reused]

        d4 = con.execute(
            """
            SELECT
              count(*) AS n,
              sum(CASE WHEN src_ifsc_bank = dst_ifsc_bank THEN 1 ELSE 0 END) AS intra,
              sum(CASE WHEN src_ifsc = dst_ifsc THEN 1 ELSE 0 END) AS same_branch
            FROM t
            """
        ).fetchone()
        d4_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_ifsc, dst_ifsc, src_acct, dst_acct, amount
            FROM t WHERE src_ifsc = dst_ifsc LIMIT 5
            """,
        )
    finally:
        con.close()

    n, src_ok, dst_ok, src_5, dst_5, bad_len = d1
    checks = []
    checks.append(
        rec(
            "D1",
            f"src IFSC ok {src_ok}/{n}, dst {dst_ok}/{n}; 5th char '0' src {src_5}/{n} dst {dst_5}/{n}; bad_len={bad_len}",
            int(n - min(src_ok, dst_ok, src_5, dst_5)),
            d1_ex,
            "CLEAN" if src_ok == n and dst_ok == n else "TRAP",
            "Keep IFSC regex [A-Z]{4}0[A-Z0-9]{6}; 5th character is 0 on this file.",
        )
    )
    n_banks = len(pref)
    checks.append(
        rec(
            "D2",
            f"{n_banks} distinct IFSC prefixes (PS said 10): {pref}",
            n_banks,
            pref[:5],
            "NOISE" if n_banks != 10 else "CLEAN",
            f"Use the observed {n_banks} prefixes in bank_directory, not a hard-coded list of 10.",
            extra={"prefixes": pref},
        )
    )
    checks.append(
        rec(
            "D3",
            f"branch codes (chars 5-11) per bank={br}; 6-char codes reused across banks={n_reused}",
            int(n_reused),
            reused_ex,
            "NOISE" if n_reused else "CLEAN",
            "Branch codes are not globally unique; always key by full IFSC / (bank, branch).",
            extra={"branches_per_bank": br},
        )
    )
    n, intra, same_branch = d4
    checks.append(
        rec(
            "D4",
            f"intra-bank (same prefix)={intra}/{n} ({intra/n:.4f}); exact same IFSC={same_branch}/{n}",
            int(intra),
            d4_ex,
            "CLEAN",
            "Intra-bank share is a context feature, not a reject rule.",
        )
    )
    dump_section("D", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
