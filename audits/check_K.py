"""Section K — cross-column consistency."""
from __future__ import annotations

import time

from _common import connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        k1 = con.execute(
            """
            SELECT
              sum(CASE WHEN src_bank <> src_ifsc_bank THEN 1 ELSE 0 END) AS src_mm,
              sum(CASE WHEN dst_bank <> dst_ifsc_bank THEN 1 ELSE 0 END) AS dst_mm
            FROM t
            """
        ).fetchone()
        k1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_acct, src_ifsc, dst_acct, dst_ifsc
            FROM t
            WHERE src_bank <> src_ifsc_bank OR dst_bank <> dst_ifsc_bank
            LIMIT 5
            """,
        )

        k2 = con.execute(
            """
            WITH u AS (
              SELECT src_acct AS acct, src_bank AS bank FROM t
              UNION ALL
              SELECT dst_acct, dst_bank FROM t
            )
            SELECT count(*) FROM (
              SELECT acct, count(DISTINCT bank) n FROM u GROUP BY 1 HAVING count(DISTINCT bank) > 1
            )
            """
        ).fetchone()[0]
        k2_ex = rows_to_dicts(
            con,
            """
            WITH u AS (
              SELECT src_acct AS acct, src_bank AS bank FROM t
              UNION ALL
              SELECT dst_acct, dst_bank FROM t
            )
            SELECT acct, count(DISTINCT bank) n_banks, list(DISTINCT bank) banks
            FROM u GROUP BY 1 HAVING count(DISTINCT bank) > 1
            LIMIT 5
            """,
        )

        k3 = con.execute(
            """
            SELECT
              sum(CASE WHEN mode='UPI' AND amount > 100000 THEN 1 ELSE 0 END) AS upi_gt_1l,
              sum(CASE WHEN mode='RTGS' AND amount < 200000 THEN 1 ELSE 0 END) AS rtgs_lt_2l,
              sum(CASE WHEN mode='IMPS' AND amount > 500000 THEN 1 ELSE 0 END) AS imps_gt_5l
            FROM t
            """
        ).fetchone()
        k3_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, mode, amount FROM t
            WHERE (mode='UPI' AND amount > 100000)
               OR (mode='RTGS' AND amount < 200000)
               OR (mode='IMPS' AND amount > 500000)
            LIMIT 5
            """,
        )

        k4 = con.execute(
            """
            SELECT device, is_foreign, count(*) n
            FROM t
            GROUP BY 1,2
            ORDER BY 1,2
            """
        ).fetchall()
        k4d = [{"device": r[0], "is_foreign": r[1], "n": r[2]} for r in k4]
        ios_foreign = next((r["n"] for r in k4d if r["device"] == "iOS" and r["is_foreign"]), 0)
        and_foreign = next((r["n"] for r in k4d if r["device"] == "Android" and r["is_foreign"]), 0)
        win_foreign = next((r["n"] for r in k4d if r["device"] == "Windows_Browser" and r["is_foreign"]), 0)
        k4_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, device, ip, src_acct FROM t
            WHERE is_foreign AND device IN ('iOS','Android','Windows_Browser')
            LIMIT 5
            """,
        )
    finally:
        con.close()

    checks = []
    src_mm, dst_mm = k1
    checks.append(
        rec(
            "K1",
            f"account-prefix vs IFSC-prefix mismatches: src={src_mm} dst={dst_mm}",
            int(src_mm + dst_mm),
            k1_ex,
            "CLEAN" if src_mm + dst_mm == 0 else "TRAP",
            "Confirmed 0 mismatches. Keep as an ingest consistency check.",
        )
    )
    checks.append(
        rec(
            "K2",
            f"accounts whose bank prefix changes across rows={k2}",
            int(k2),
            k2_ex,
            "CLEAN" if k2 == 0 else "TRAP",
            "One account = one bank prefix. If this ever fires, conflict-flag the account.",
        )
    )
    upi, rtgs, imps = k3
    checks.append(
        rec(
            "K3",
            f"generator vs real rail limits — UPI>1L={upi}, RTGS<2L={rtgs}, IMPS>5L={imps} (same as E8)",
            int(upi + rtgs + imps),
            k3_ex,
            "NOISE",
            "Do not enforce NPCI/RBI rail limits at ingest; the file does not follow them.",
        )
    )
    phone_foreign = ios_foreign + and_foreign + win_foreign
    checks.append(
        rec(
            "K4",
            f"foreign IP on iOS={ios_foreign} Android={and_foreign} Windows_Browser={win_foreign}; "
            f"full device×foreign matrix={k4d}",
            int(phone_foreign),
            k4_ex if k4_ex else k4d[:5],
            "SIGNAL" if phone_foreign == 0 else "NOISE",
            "If foreign IPs appear only on headless devices, that is the injected L3 combo — one signal, not two.",
            extra={"matrix": k4d},
        )
    )
    dump_section("K", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
