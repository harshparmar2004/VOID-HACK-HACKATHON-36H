"""Section C — accounts."""
from __future__ import annotations

import time
from collections import defaultdict

from _common import PAY_BANKS, bar_png, connect, dump_section, print_checks, rec, rows_to_dicts


def hamming(a: str, b: str) -> int:
    return sum(x != y for x, y in zip(a, b))


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        # C1 [KNOWN]
        c1 = con.execute(
            """
            SELECT
              count(*) AS n,
              sum(CASE WHEN regexp_full_match(src_acct, '^[A-Z]{4}[0-9]{8}$') THEN 1 ELSE 0 END) AS src_ok,
              sum(CASE WHEN regexp_full_match(dst_acct, '^[A-Z]{4}[0-9]{8}$') THEN 1 ELSE 0 END) AS dst_ok,
              sum(CASE WHEN src_bank = src_ifsc_bank THEN 1 ELSE 0 END) AS src_pref_ok,
              sum(CASE WHEN dst_bank = dst_ifsc_bank THEN 1 ELSE 0 END) AS dst_pref_ok
            FROM t
            """
        ).fetchone()
        c1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_acct, src_ifsc, dst_acct, dst_ifsc
            FROM t
            WHERE regexp_full_match(src_acct, '^[A-Z]{4}[0-9]{8}$') = false
               OR regexp_full_match(dst_acct, '^[A-Z]{4}[0-9]{8}$') = false
               OR src_bank <> src_ifsc_bank OR dst_bank <> dst_ifsc_bank
            LIMIT 5
            """,
        )

        # C2 whitespace / lowercase variants
        c2 = con.execute(
            """
            SELECT
              sum(CASE WHEN src_acct <> trim(src_acct) OR dst_acct <> trim(dst_acct) THEN 1 ELSE 0 END) AS spaced,
              sum(CASE WHEN src_acct <> upper(src_acct) OR dst_acct <> upper(dst_acct) THEN 1 ELSE 0 END) AS lowerish
            FROM t
            """
        ).fetchone()
        # same digits different case would show up as distinct if mixed
        variant = con.execute(
            """
            WITH u AS (
              SELECT src_acct AS acct FROM t
              UNION ALL
              SELECT dst_acct FROM t
            )
            SELECT count(*) FROM (
              SELECT upper(trim(acct)) AS k, count(DISTINCT acct) AS n
              FROM u GROUP BY 1 HAVING count(DISTINCT acct) > 1
            )
            """
        ).fetchone()[0]

        # C3 one account, multiple IFSC
        c3_src = con.execute(
            """
            SELECT src_acct, count(DISTINCT src_ifsc) AS n_ifsc
            FROM t GROUP BY 1 HAVING count(DISTINCT src_ifsc) > 1
            ORDER BY n_ifsc DESC LIMIT 5
            """
        ).fetchall()
        c3_dst = con.execute(
            """
            SELECT dst_acct, count(DISTINCT dst_ifsc) AS n_ifsc
            FROM t GROUP BY 1 HAVING count(DISTINCT dst_ifsc) > 1
            ORDER BY n_ifsc DESC LIMIT 5
            """
        ).fetchall()
        c3_both = con.execute(
            """
            WITH s AS (SELECT src_acct AS acct, src_ifsc AS ifsc FROM t
                       UNION ALL SELECT dst_acct, dst_ifsc FROM t)
            SELECT count(*) FROM (
              SELECT acct, count(DISTINCT ifsc) n FROM s GROUP BY 1 HAVING count(DISTINCT ifsc) > 1
            )
            """
        ).fetchone()[0]
        n_c3_src = con.execute(
            "SELECT count(*) FROM (SELECT src_acct FROM t GROUP BY 1 HAVING count(DISTINCT src_ifsc)>1)"
        ).fetchone()[0]
        n_c3_dst = con.execute(
            "SELECT count(*) FROM (SELECT dst_acct FROM t GROUP BY 1 HAVING count(DISTINCT dst_ifsc)>1)"
        ).fetchone()[0]
        c3_ex = [
            {"side": "src", "acct": r[0], "n_ifsc": r[1]} for r in c3_src
        ] + [
            {"side": "dst", "acct": r[0], "n_ifsc": r[1]} for r in c3_dst
        ]

        # C4 self-transfers
        n_self = con.execute("SELECT count(*) FROM t WHERE src_acct = dst_acct").fetchone()[0]
        self_ex = rows_to_dicts(
            con,
            "SELECT tx_id, src_acct, dst_acct, amount, ts, mode FROM t WHERE src_acct = dst_acct LIMIT 5",
        )

        # C5 distinct accounts, send-only / recv-only / both
        c5 = con.execute(
            """
            WITH s AS (SELECT DISTINCT src_acct AS acct FROM t),
                 r AS (SELECT DISTINCT dst_acct AS acct FROM t)
            SELECT
              (SELECT count(*) FROM (SELECT src_acct FROM t UNION SELECT dst_acct FROM t)) AS n_accts,
              (SELECT count(*) FROM s) AS n_senders,
              (SELECT count(*) FROM r) AS n_receivers,
              (SELECT count(*) FROM s JOIN r USING (acct)) AS n_both,
              (SELECT count(*) FROM s ANTI JOIN r USING (acct)) AS send_only,
              (SELECT count(*) FROM r ANTI JOIN s USING (acct)) AS recv_only
            """
        ).fetchone()

        # C6 lookalike (hamming 1 on 8-digit tail, per bank prefix) — account list only
        accts = con.execute(
            """
            SELECT DISTINCT acct, substr(acct,1,4) AS bank, substr(acct,5,8) AS digits
            FROM (SELECT src_acct AS acct FROM t UNION SELECT dst_acct FROM t)
            """
        ).fetchall()
        by_bank = defaultdict(list)
        for acct, bank, digits in accts:
            by_bank[bank].append((acct, digits))
        lookalike_pairs = []
        n_pairs = 0
        for bank, items in by_bank.items():
            n = len(items)
            for i in range(n):
                d_i = items[i][1]
                for j in range(i + 1, n):
                    if hamming(d_i, items[j][1]) == 1:
                        n_pairs += 1
                        if len(lookalike_pairs) < 5:
                            lookalike_pairs.append(
                                {"a": items[i][0], "b": items[j][0], "bank": bank}
                            )

        # C7 bank prefix distribution + headless/foreign over-representation
        c7 = con.execute(
            """
            SELECT src_bank,
                   count(*) AS n_tx,
                   count(DISTINCT src_acct) AS n_accts,
                   sum(CAST(is_headless AS INT)) AS n_headless,
                   sum(CAST(is_foreign AS INT)) AS n_foreign
            FROM t
            GROUP BY 1
            ORDER BY n_tx DESC
            """
        ).fetchall()
        c7_dicts = [
            {"bank": r[0], "n_tx": r[1], "n_accts": r[2], "n_headless": r[3], "n_foreign": r[4],
             "headless_rate": round(r[3] / r[1], 6) if r[1] else None}
            for r in c7
        ]
        pay = [d for d in c7_dicts if d["bank"] in PAY_BANKS]
        others = [d for d in c7_dicts if d["bank"] not in PAY_BANKS]
        pay_h = sum(d["n_headless"] for d in pay)
        pay_n = sum(d["n_tx"] for d in pay)
        oth_h = sum(d["n_headless"] for d in others)
        oth_n = sum(d["n_tx"] for d in others)
        labels = [d["bank"] for d in c7_dicts]
        bar_png("C7_tx_by_bank.png", "TX COUNT BY SRC BANK", labels, [d["n_tx"] for d in c7_dicts])
        bar_png(
            "C7_headless_rate_by_bank.png",
            "HEADLESS RATE BY SRC BANK",
            labels,
            [d["headless_rate"] or 0 for d in c7_dicts],
        )

        # C8 8-digit ranges vs headless
        c8 = con.execute(
            """
            SELECT
              is_headless,
              count(*) n,
              min(CAST(substr(src_acct,5,8) AS BIGINT)) AS dmin,
              approx_quantile(CAST(substr(src_acct,5,8) AS BIGINT), 0.5) AS dp50,
              max(CAST(substr(src_acct,5,8) AS BIGINT)) AS dmax
            FROM t GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        c8d = [{"is_headless": r[0], "n": r[1], "dmin": r[2], "dp50": r[3], "dmax": r[4]} for r in c8]
        h = next((x for x in c8d if x["is_headless"]), None)
        nrm = next((x for x in c8d if not x["is_headless"]), None)
        disjoint = (
            h and nrm and (h["dmax"] < nrm["dmin"] or nrm["dmax"] < h["dmin"])
        )

        # C9 tx per account
        c9 = con.execute(
            """
            WITH u AS (
              SELECT src_acct AS acct FROM t
              UNION ALL
              SELECT dst_acct FROM t
            ),
            c AS (SELECT acct, count(*) AS n FROM u GROUP BY 1)
            SELECT
              count(*) AS n_accts,
              min(n), approx_quantile(n, 0.5), approx_quantile(n, 0.9),
              approx_quantile(n, 0.99), max(n),
              sum(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS n_exact_1
            FROM c
            """
        ).fetchone()
        top20 = rows_to_dicts(
            con,
            """
            WITH u AS (
              SELECT src_acct AS acct FROM t UNION ALL SELECT dst_acct FROM t
            )
            SELECT acct, count(*) AS n FROM u GROUP BY 1 ORDER BY n DESC LIMIT 20
            """,
            limit=20,
        )
        bar_png(
            "C9_top20_accounts.png",
            "TOP 20 ACCOUNTS BY TX INVOLVEMENT",
            [str(i + 1) for i in range(len(top20))],
            [r["n"] for r in top20],
        )
    finally:
        con.close()

    n, src_ok, dst_ok, src_pref, dst_pref = c1
    checks = []
    checks.append(
        rec(
            "C1",
            f"src format ok {src_ok}/{n}, dst {dst_ok}/{n}; prefix=IFSC prefix src {src_pref}/{n} dst {dst_pref}/{n}",
            int(n - min(src_ok, dst_ok, src_pref, dst_pref)),
            c1_ex,
            "CLEAN" if src_ok == n and dst_ok == n and src_pref == n and dst_pref == n else "TRAP",
            "Keep ^[A-Z]{4}[0-9]{8}$ and prefix=IFSC-prefix as ingest rules.",
        )
    )
    spaced, lowerish = c2
    checks.append(
        rec(
            "C2",
            f"whitespace variants in rows={spaced}, non-upper={lowerish}, case/trim collisions across distinct strings={variant}",
            int(spaced + lowerish + variant),
            [],
            "CLEAN" if spaced == 0 and lowerish == 0 and variant == 0 else "TRAP",
            "Do not case-fold or trim accounts; reject whitespace.",
        )
    )
    checks.append(
        rec(
            "C3",
            f"accounts with >1 IFSC as sender={n_c3_src}, as receiver={n_c3_dst}, across both sides={c3_both}",
            int(c3_both),
            c3_ex[:5],
            "CLEAN" if c3_both == 0 else "TRAP",
            "If an account maps to multiple IFSC, keep a conflict flag; do not min() silently without logging.",
        )
    )
    checks.append(
        rec(
            "C4",
            f"self-transfers (sender=receiver)={n_self}",
            int(n_self),
            self_ex,
            "CLEAN" if n_self == 0 else "NOISE",
            "Self-transfers are not expected; quarantine if they appear.",
        )
    )
    n_accts, n_senders, n_receivers, n_both, send_only, recv_only = c5
    checks.append(
        rec(
            "C5",
            f"distinct accounts={n_accts} (expect ~25000); senders={n_senders}, receivers={n_receivers}, "
            f"both={n_both}, send-only={send_only}, recv-only={recv_only}",
            int(n_accts),
            [{"send_only": send_only, "recv_only": recv_only, "both": n_both}],
            "CLEAN" if 20000 <= n_accts <= 30000 else "TRAP",
            "Send-only ≈ victims/sources; recv-only ≈ sinks. Use as features, not rejects.",
        )
    )
    # lookalikes: many hamming-1 pairs among 8-digit sequential generator numbers is NOISE
    checks.append(
        rec(
            "C6",
            f"same-bank hamming-1 account pairs={n_pairs} (compared {len(accts)} accounts grouped by prefix)",
            int(n_pairs),
            lookalike_pairs,
            "NOISE" if n_pairs > 100 else ("CLEAN" if n_pairs == 0 else "INCONCLUSIVE"),
            "Do not treat single-digit neighbours as typos; generator numbers are dense per bank.",
        )
    )
    pay_rate = (pay_h / pay_n) if pay_n else 0
    oth_rate = (oth_h / oth_n) if oth_n else 0
    ratio = (pay_rate / oth_rate) if oth_rate else None
    c7_verdict = "SIGNAL" if ratio and ratio >= 3 else ("NOISE" if ratio and ratio >= 1.5 else "CLEAN")
    checks.append(
        rec(
            "C7",
            f"{len(c7_dicts)} bank prefixes. payments-bank headless rate={pay_rate:.6f} vs others={oth_rate:.6f} "
            f"(ratio={ratio}). See C7 figures.",
            len(c7_dicts),
            c7_dicts[:5],
            c7_verdict,
            "Bank prefix may be a weak L3 correlate (payments banks). Do not use prefix alone as a mule label.",
            extra={"by_bank": c7_dicts, "pay_rate": pay_rate, "other_rate": oth_rate},
        )
    )
    checks.append(
        rec(
            "C8",
            f"headless vs normal 8-digit ranges disjoint={disjoint}: {c8d}",
            int(bool(disjoint)),
            c8d,
            "TRAP" if disjoint else "CLEAN",
            "Do NOT score on the 8-digit account-number range (leakage risk). Overlap means no shortcut here.",
        )
    )
    n_a, mn, p50, p90, p99, mx, n1 = c9
    checks.append(
        rec(
            "C9",
            f"tx-involvements per account: min={mn} p50={p50} p90={p90} p99={p99} max={mx}; exactly 1={n1} / {n_a}",
            int(n1),
            top20[:5],
            "SIGNAL" if mx and mx > 10000 else "CLEAN",
            "Cap merchant-like hubs in graph features; keep a tx_count feature. Top-20 listed in extra.",
            extra={"top20": top20, "exact_1": n1, "max": mx},
        )
    )
    dump_section("C", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
