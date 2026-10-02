"""Section E — Amount."""
from __future__ import annotations

import math
import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts

BENFORD = {d: math.log10(1 + 1 / d) for d in range(1, 10)}
LIMITS = [9999, 49999, 99999, 199999, 499999, 999999]


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        e1 = con.execute(
            """
            SELECT
              sum(CASE WHEN amount IS NULL THEN 1 ELSE 0 END) AS non_numeric,
              sum(CASE WHEN instr(amount_raw, ',') > 0 THEN 1 ELSE 0 END) AS has_comma,
              sum(CASE WHEN regexp_matches(amount_raw, '[₹$]|Rs') THEN 1 ELSE 0 END) AS has_sym,
              sum(CASE WHEN amount_raw <> trim(amount_raw) THEN 1 ELSE 0 END) AS spaced
            FROM t
            """
        ).fetchone()
        e1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, amount_raw, src_acct, ts
            FROM t
            WHERE amount IS NULL OR instr(amount_raw, ',') > 0
               OR amount_raw <> trim(amount_raw)
            LIMIT 5
            """,
        )

        e2 = con.execute(
            """
            SELECT
              sum(CASE WHEN amount = 0 THEN 1 ELSE 0 END) AS zero,
              sum(CASE WHEN amount < 0 THEN 1 ELSE 0 END) AS neg,
              sum(CASE WHEN amount_paise IS NOT NULL AND amount_paise <= 0 THEN 1 ELSE 0 END) AS paise_le0
            FROM t
            """
        ).fetchone()

        e3 = con.execute(
            """
            SELECT
              sum(CASE WHEN instr(amount_raw,'.')=0 THEN 1 ELSE 0 END) AS no_dot,
              sum(CASE WHEN length(split_part(amount_raw,'.',2))=1 THEN 1 ELSE 0 END) AS d1,
              sum(CASE WHEN length(split_part(amount_raw,'.',2))=2 THEN 1 ELSE 0 END) AS d2,
              sum(CASE WHEN length(split_part(amount_raw,'.',2))>2 THEN 1 ELSE 0 END) AS dgt2,
              sum(CASE WHEN amount_raw LIKE '%.0' THEN 1 ELSE 0 END) AS ends_0,
              sum(CASE WHEN amount_raw LIKE '%.00' THEN 1 ELSE 0 END) AS ends_00
            FROM t
            """
        ).fetchone()
        e3_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, amount_raw FROM t
            WHERE length(split_part(amount_raw,'.',2))>2
            LIMIT 5
            """,
        )

        e4 = con.execute(
            """
            SELECT min(amount), max(amount),
                   approx_quantile(amount, 0.5),
                   approx_quantile(amount, 0.9),
                   approx_quantile(amount, 0.99),
                   approx_quantile(amount, 0.999),
                   avg(amount)
            FROM t WHERE amount IS NOT NULL
            """
        ).fetchone()
        hist = con.execute(
            """
            SELECT CAST(floor(log10(amount) * 2) AS INTEGER) AS b, count(*) n,
                   min(amount), max(amount)
            FROM t WHERE amount > 0
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        bar_png(
            "E4_amount_log_buckets.png",
            "AMOUNT LOG10 BUCKETS",
            [str(r[0]) for r in hist],
            [r[1] for r in hist],
        )
        top_outliers = rows_to_dicts(
            con,
            "SELECT tx_id, amount, src_acct, dst_acct, ts, device FROM t ORDER BY amount DESC LIMIT 5",
        )

        e5 = con.execute(
            """
            SELECT
              count(*) n,
              sum(CASE WHEN amount_paise % 10000 = 0 THEN 1 ELSE 0 END) AS mult_100,
              sum(CASE WHEN amount_paise % 50000 = 0 THEN 1 ELSE 0 END) AS mult_500,
              sum(CASE WHEN amount_paise % 100000 = 0 THEN 1 ELSE 0 END) AS mult_1000,
              sum(CASE WHEN amount_paise % 1000000 = 0 THEN 1 ELSE 0 END) AS mult_10000
            FROM t WHERE amount_paise IS NOT NULL
            """
        ).fetchone()
        e5_by = con.execute(
            """
            SELECT is_headless, is_foreign,
              count(*) n,
              avg(CASE WHEN amount_paise % 10000 = 0 THEN 1.0 ELSE 0.0 END) AS p_mult100
            FROM t WHERE amount_paise IS NOT NULL
            GROUP BY 1,2 ORDER BY 1,2
            """
        ).fetchall()
        e5_dicts = [
            {"is_headless": r[0], "is_foreign": r[1], "n": r[2], "p_mult100": r[3]} for r in e5_by
        ]

        # E6 clusters just below limits ±1%
        e6_rows = []
        e6_total = 0
        for lim in LIMITS:
            lo, hi = lim * 0.99, lim
            n = con.execute(
                "SELECT count(*) FROM t WHERE amount >= ? AND amount <= ?",
                [lo, hi],
            ).fetchone()[0]
            e6_total += n
            ex = rows_to_dicts(
                con,
                f"SELECT tx_id, amount, mode, device FROM t WHERE amount >= {lo} AND amount <= {hi} LIMIT 1",
                limit=1,
            )
            e6_rows.append({"limit": lim, "lo": lo, "hi": hi, "n": n, "example": ex[0] if ex else None})

        e7 = rows_to_dicts(
            con,
            """
            SELECT amount_raw, count(*) AS n
            FROM t GROUP BY 1 ORDER BY n DESC LIMIT 30
            """,
            limit=30,
        )

        e8 = con.execute(
            """
            SELECT
              sum(CASE WHEN mode='UPI' AND amount > 100000 THEN 1 ELSE 0 END) AS upi_gt_1l,
              sum(CASE WHEN mode='RTGS' AND amount < 200000 THEN 1 ELSE 0 END) AS rtgs_lt_2l,
              sum(CASE WHEN mode='IMPS' AND amount > 500000 THEN 1 ELSE 0 END) AS imps_gt_5l,
              sum(CASE WHEN mode='UPI' THEN 1 ELSE 0 END) AS n_upi,
              sum(CASE WHEN mode='RTGS' THEN 1 ELSE 0 END) AS n_rtgs,
              sum(CASE WHEN mode='IMPS' THEN 1 ELSE 0 END) AS n_imps
            FROM t
            """
        ).fetchone()
        e8_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, mode, amount, src_acct, dst_acct FROM t
            WHERE (mode='UPI' AND amount > 100000)
               OR (mode='RTGS' AND amount < 200000)
               OR (mode='IMPS' AND amount > 500000)
            LIMIT 5
            """,
        )

        # E9 Benford
        digits = con.execute(
            """
            SELECT CAST(floor(amount / pow(10, floor(log10(amount)))) AS INTEGER) AS d,
                   count(*) n
            FROM t WHERE amount > 0
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        total = sum(r[1] for r in digits if r[0] and 1 <= r[0] <= 9)
        obs = {r[0]: r[1] for r in digits if r[0] and 1 <= r[0] <= 9}
        chi2 = 0.0
        ben_rows = []
        for d in range(1, 10):
            e = BENFORD[d] * total
            o = obs.get(d, 0)
            chi2 += (o - e) ** 2 / e if e else 0
            ben_rows.append({"d": d, "obs": o, "exp": round(e, 1), "share": round(o / total, 4) if total else None})
        bar_png("E9_benford.png", "FIRST DIGIT VS BENFORD", [str(d) for d in range(1, 10)],
                [obs.get(d, 0) / total if total else 0 for d in range(1, 10)])

        e10 = con.execute(
            """
            SELECT is_headless,
              count(*) n,
              min(amount), approx_quantile(amount,0.5), approx_quantile(amount,0.9), max(amount), avg(amount)
            FROM t GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        e10d = [
            {"is_headless": r[0], "n": r[1], "min": r[2], "p50": r[3], "p90": r[4], "max": r[5], "avg": r[6]}
            for r in e10
        ]
        bar_png(
            "E10_avg_amount_headless.png",
            "AVG AMOUNT HEADLESS VS NORMAL",
            ["normal" if not r["is_headless"] else "headless" for r in e10d],
            [r["avg"] or 0 for r in e10d],
        )
    finally:
        con.close()

    checks = []
    non_numeric, has_comma, has_sym, spaced = e1
    checks.append(
        rec(
            "E1",
            f"non-numeric={non_numeric}, comma={has_comma}, currency-symbol={has_sym}, spaced={spaced}",
            int(non_numeric + has_comma + has_sym + spaced),
            e1_ex,
            "CLEAN" if non_numeric == 0 and has_comma == 0 else "TRAP",
            "Reject non-numeric amounts; none seen.",
        )
    )
    zero, neg, paise_le0 = e2
    checks.append(
        rec(
            "E2",
            f"zero={zero}, negative={neg}, amount_paise<=0={paise_le0}",
            int(zero + neg),
            [],
            "CLEAN" if zero == 0 and neg == 0 else "TRAP",
            "Reject amount <= 0; do not ABS.",
        )
    )
    no_dot, d1, d2, dgt2, ends_0, ends_00 = e3
    checks.append(
        rec(
            "E3",
            f"no decimal={no_dot}, 1dp={d1}, 2dp={d2}, >2dp={dgt2}, ends .0={ends_0}, ends .00={ends_00}",
            int(dgt2),
            e3_ex,
            "TRAP" if dgt2 else "NOISE",
            "Store integer paise; 1 vs 2 decimal formatting is a generator artefact, not fraud.",
        )
    )
    mn, mx, p50, p90, p99, p999, avg = e4
    checks.append(
        rec(
            "E4",
            f"min={mn} max={mx} median={p50} p90={p90} p99={p99} p99.9={p999} avg={avg}",
            0 if mx and mx < 1_000_000 else 1,
            top_outliers,
            "CLEAN" if mx is not None and mx < 1_000_000 else "TRAP",
            "Cap is under ₹10 lakh as profiled; no extra outlier reject needed.",
            extra={"hist": [{"bucket": r[0], "n": r[1], "min": r[2], "max": r[3]} for r in hist]},
        )
    )
    n, m100, m500, m1000, m10000 = e5
    checks.append(
        rec(
            "E5",
            f"share multiples of 100={m100/n:.4f}, 500={m500/n:.4f}, 1000={m1000/n:.4f}, 10000={m10000/n:.4f}",
            int(m100),
            e5_dicts,
            "NOISE",
            "Round-amount share is a structuring feature (M8), not an ingest reject. Compare rates by device in extra.",
            extra={"by_flag": e5_dicts},
        )
    )
    checks.append(
        rec(
            "E6",
            "just-below-limit ±1% counts: " + ", ".join(f"{r['limit']}={r['n']}" for r in e6_rows),
            int(e6_total),
            e6_rows[:5],
            "SIGNAL" if e6_total > 1000 else "NOISE",
            "Use as M8 structuring feature; do not auto-flag a single near-limit payment.",
            extra={"bands": e6_rows},
        )
    )
    top1 = e7[0]["n"] if e7 else 0
    checks.append(
        rec(
            "E7",
            f"most frequent exact amount appears {top1} times; top-5={e7[:5]}",
            int(top1),
            e7[:5],
            "NOISE" if top1 < 500 else "SIGNAL",
            "Repeated exact rupee amounts are a generator/structuring clue; keep as a feature.",
            extra={"top30": e7},
        )
    )
    upi_gt, rtgs_lt, imps_gt, n_upi, n_rtgs, n_imps = e8
    e8_n = int(upi_gt + rtgs_lt + imps_gt)
    checks.append(
        rec(
            "E8",
            f"UPI>1e5: {upi_gt}/{n_upi}; RTGS<2e5: {rtgs_lt}/{n_rtgs}; IMPS>5e5: {imps_gt}/{n_imps}",
            e8_n,
            e8_ex,
            "NOISE" if e8_n else "CLEAN",
            "Real rail limits are NOT respected by the generator — do not reject on them; optional weak feature only.",
        )
    )
    # chi2 critical 15.51 at 8 df 0.05; generator often fails Benford
    checks.append(
        rec(
            "E9",
            f"Benford chi-square={chi2:.1f} (df=8; 5% crit≈15.5). shares={[{'d':r['d'],'share':r['share']} for r in ben_rows]}",
            round(chi2, 1),
            ben_rows,
            "NOISE" if chi2 > 15.5 else "CLEAN",
            "Do not use Benford as a mule detector here; deviation is likely the generator.",
            extra={"chi2": chi2, "digits": ben_rows},
        )
    )
    checks.append(
        rec(
            "E10",
            f"amount by headless={e10d}",
            int(e10d[1]["n"] if len(e10d) > 1 else 0),
            e10d,
            "SIGNAL" if len(e10d) == 2 and e10d[0]["avg"] and e10d[1]["avg"]
            and abs(e10d[0]["avg"] - e10d[1]["avg"]) / max(e10d[0]["avg"], e10d[1]["avg"]) > 0.3
            else "CLEAN",
            "Keep amount distribution by device as an L3/M4 input, not a hard rule.",
        )
    )
    dump_section("E", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
