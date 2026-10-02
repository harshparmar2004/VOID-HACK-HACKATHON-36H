"""Section L — graph and behaviour traps. DuckDB SQL; no igraph (not installed).

Range-joins for pass-through / fan-out skip sender accounts with >1500 outflows
(merchant hubs). Sample size of those skipped accounts is reported.
"""
from __future__ import annotations

import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts

OUT_CAP = 1500  # skip denser senders in 15-min range joins


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        _run(con, t0)
    finally:
        con.close()


def _run(con, t0: float) -> None:
        print("L building acct table...")
        con.execute(
            """
            CREATE TEMP TABLE acct AS
            WITH sends AS (
              SELECT src_acct AS acct,
                     count(*) AS n_out,
                     sum(amount) AS out_amt,
                     min(ts) AS first_out,
                     max(ts) AS last_out,
                     count(DISTINCT dst_acct) AS fanout,
                     sum(CAST(is_headless AS INT)) AS n_head_out,
                     sum(CAST(is_foreign AS INT)) AS n_for_out
              FROM t GROUP BY 1
            ),
            recvs AS (
              SELECT dst_acct AS acct,
                     count(*) AS n_in,
                     sum(amount) AS in_amt,
                     min(ts) AS first_in,
                     max(ts) AS last_in,
                     count(DISTINCT src_acct) AS fanin
              FROM t GROUP BY 1
            ),
            days AS (
              SELECT acct, count(DISTINCT d) AS days_active,
                     min(mn) AS first_ts, max(mx) AS last_ts
              FROM (
                SELECT src_acct AS acct, CAST(ts AS DATE) AS d, ts AS mn, ts AS mx FROM t
                UNION ALL
                SELECT dst_acct, CAST(ts AS DATE), ts, ts FROM t
              ) GROUP BY 1
            )
            SELECT
              coalesce(s.acct, r.acct) AS acct,
              coalesce(s.n_out, 0) AS n_out,
              coalesce(r.n_in, 0) AS n_in,
              coalesce(s.n_out, 0) + coalesce(r.n_in, 0) AS n_tx,
              coalesce(s.out_amt, 0) AS out_amt,
              coalesce(r.in_amt, 0) AS in_amt,
              coalesce(s.fanout, 0) AS fanout,
              coalesce(r.fanin, 0) AS fanin,
              coalesce(s.n_head_out, 0) AS n_head_out,
              coalesce(s.n_for_out, 0) AS n_for_out,
              d.days_active,
              d.first_ts,
              d.last_ts,
              date_diff('second', d.first_ts, d.last_ts) AS span_sec
            FROM sends s
            FULL OUTER JOIN recvs r ON s.acct = r.acct
            LEFT JOIN days d ON d.acct = coalesce(s.acct, r.acct)
            """
        )
        n_acct = con.execute("SELECT count(*) FROM acct").fetchone()[0]
        n_skip = con.execute(f"SELECT count(*) FROM acct WHERE n_out > {OUT_CAP}").fetchone()[0]
        print(f"  accounts={n_acct} skip_dense_senders={n_skip}")

        # L1 decoy merchants
        l1 = con.execute(
            """
            SELECT count(*) FROM acct
            WHERE fanin >= 50 AND days_active >= 10
              AND n_out <= 5
              AND (in_amt = 0 OR out_amt / nullif(in_amt,0) < 0.10)
            """
        ).fetchone()[0]
        l1_ex = rows_to_dicts(
            con,
            """
            SELECT acct, fanin, days_active, n_in, n_out, in_amt, out_amt
            FROM acct
            WHERE fanin >= 50 AND days_active >= 10 AND n_out <= 5
              AND (in_amt = 0 OR out_amt / nullif(in_amt,0) < 0.10)
            ORDER BY fanin DESC LIMIT 5
            """,
        )

        # L8 send-only / recv-only
        l8 = con.execute(
            """
            SELECT
              sum(CASE WHEN n_out > 0 AND n_in = 0 THEN 1 ELSE 0 END) AS send_only,
              sum(CASE WHEN n_in > 0 AND n_out = 0 THEN 1 ELSE 0 END) AS recv_only
            FROM acct
            """
        ).fetchone()
        l8_ex = rows_to_dicts(
            con,
            """
            SELECT acct, n_in, n_out, in_amt, out_amt, days_active
            FROM acct WHERE n_out > 0 AND n_in = 0
            ORDER BY out_amt DESC LIMIT 3
            """,
        ) + rows_to_dicts(
            con,
            """
            SELECT acct, n_in, n_out, in_amt, out_amt, days_active
            FROM acct WHERE n_in > 0 AND n_out = 0
            ORDER BY in_amt DESC LIMIT 2
            """,
        )

        # L10 short window
        l10 = con.execute(
            """
            SELECT count(*) FROM acct
            WHERE n_tx >= 5 AND span_sec < 2 * 3600
            """
        ).fetchone()[0]
        l10_ex = rows_to_dicts(
            con,
            """
            SELECT acct, n_tx, span_sec, first_ts, last_ts, n_head_out
            FROM acct WHERE n_tx >= 5 AND span_sec < 2 * 3600
            ORDER BY n_tx DESC LIMIT 5
            """,
        )

        # L11 dormant-then-burst: span >= 5 days but >= 70% of tx on a single day
        print("L11 daily bursts...")
        con.execute(
            """
            CREATE TEMP TABLE daily AS
            SELECT acct, d, count(*) n FROM (
              SELECT src_acct AS acct, CAST(ts AS DATE) d FROM t
              UNION ALL
              SELECT dst_acct, CAST(ts AS DATE) FROM t
            ) GROUP BY 1,2
            """
        )
        l11 = con.execute(
            """
            WITH m AS (
              SELECT acct, max(n) AS peak, sum(n) AS tot, count(*) AS n_days
              FROM daily GROUP BY 1
            )
            SELECT count(*) FROM m
            JOIN acct a USING (acct)
            WHERE a.span_sec >= 5 * 86400 AND tot >= 10 AND peak >= 0.7 * tot AND n_days <= 3
            """
        ).fetchone()[0]
        l11_ex = rows_to_dicts(
            con,
            """
            WITH m AS (
              SELECT acct, max(n) AS peak, sum(n) AS tot, count(*) AS n_days
              FROM daily GROUP BY 1
            )
            SELECT a.acct, tot, peak, n_days, a.span_sec, a.n_head_out
            FROM m JOIN acct a USING (acct)
            WHERE a.span_sec >= 5 * 86400 AND tot >= 10 AND peak >= 0.7 * tot AND n_days <= 3
            ORDER BY peak DESC LIMIT 5
            """,
        )

        # Range-join subset
        print("L range-join ins/outs (n_out <= cap)...")
        con.execute(
            f"""
            CREATE TEMP TABLE ins_s AS
            SELECT row_n, dst_acct AS acct, ts AS in_ts, amount AS in_amt
            FROM t
            WHERE dst_acct IN (SELECT acct FROM acct WHERE n_out BETWEEN 1 AND {OUT_CAP})
            """
        )
        con.execute(
            f"""
            CREATE TEMP TABLE outs_s AS
            SELECT row_n, src_acct AS acct, ts AS out_ts, amount AS out_amt, dst_acct AS out_dst
            FROM t
            WHERE src_acct IN (SELECT acct FROM acct WHERE n_out BETWEEN 1 AND {OUT_CAP})
            """
        )
        n_ins = con.execute("SELECT count(*) FROM ins_s").fetchone()[0]
        n_outs = con.execute("SELECT count(*) FROM outs_s").fetchone()[0]
        print(f"  ins_s={n_ins} outs_s={n_outs}")

        print("L3/L4 15-min fanout join...")
        con.execute(
            """
            CREATE TEMP TABLE inflow_15 AS
            SELECT
              i.acct,
              i.row_n AS in_row,
              i.in_ts,
              i.in_amt,
              count(*) AS n_out,
              count(DISTINCT o.out_dst) AS n_recv,
              sum(o.out_amt) AS out_sum,
              min(epoch(o.out_ts) - epoch(i.in_ts)) AS min_lag_sec,
              max(epoch(o.out_ts) - epoch(i.in_ts)) AS max_lag_sec,
              stddev_pop(o.out_amt) AS out_std,
              avg(o.out_amt) AS out_mean
            FROM ins_s i
            JOIN outs_s o
              ON i.acct = o.acct
             AND o.out_ts >= i.in_ts
             AND o.out_ts <= i.in_ts + INTERVAL 15 MINUTE
            GROUP BY i.acct, i.row_n, i.in_ts, i.in_amt
            """
        )
        n_i15 = con.execute("SELECT count(*) FROM inflow_15").fetchone()[0]
        print(f"  inflow_15 rows={n_i15}")

        l3_0 = con.execute("SELECT count(*) FROM inflow_15 WHERE min_lag_sec = 0").fetchone()[0]
        l3_lt3 = con.execute("SELECT count(*) FROM inflow_15 WHERE min_lag_sec < 180").fetchone()[0]
        l3_acct0 = con.execute(
            "SELECT count(DISTINCT acct) FROM inflow_15 WHERE min_lag_sec = 0"
        ).fetchone()[0]
        l3_acct3 = con.execute(
            "SELECT count(DISTINCT acct) FROM inflow_15 WHERE min_lag_sec < 180"
        ).fetchone()[0]
        l3_ex = rows_to_dicts(
            con,
            """
            SELECT acct, in_ts, in_amt, min_lag_sec, n_recv, out_sum
            FROM inflow_15 WHERE min_lag_sec < 180
            ORDER BY min_lag_sec, in_amt DESC LIMIT 5
            """,
        )

        # L2: pass-through >=90% with long history
        con.execute(
            """
            CREATE TEMP TABLE pt AS
            SELECT acct,
              count(*) AS n_in_matched,
              avg(least(out_sum / nullif(in_amt,0), 1.0)) AS pt_share,
              sum(CASE WHEN out_sum >= 0.90 * in_amt THEN 1 ELSE 0 END) AS n_fast90
            FROM inflow_15
            GROUP BY 1
            """
        )
        l2 = con.execute(
            """
            SELECT count(*) FROM pt p
            JOIN acct a USING (acct)
            WHERE p.n_in_matched >= 5
              AND p.n_fast90 >= 0.90 * p.n_in_matched
              AND a.days_active >= 10
              AND a.n_tx >= 40
            """
        ).fetchone()[0]
        l2_ex = rows_to_dicts(
            con,
            """
            SELECT a.acct, p.pt_share, p.n_fast90, p.n_in_matched, a.days_active, a.n_tx
            FROM pt p JOIN acct a USING (acct)
            WHERE p.n_in_matched >= 5 AND p.n_fast90 >= 0.90 * p.n_in_matched
              AND a.days_active >= 10 AND a.n_tx >= 40
            ORDER BY a.n_tx DESC LIMIT 5
            """,
        )

        l4_gt7 = con.execute("SELECT count(*) FROM inflow_15 WHERE n_recv > 7").fetchone()[0]
        l4_3_7 = con.execute(
            "SELECT count(*) FROM inflow_15 WHERE n_recv BETWEEN 3 AND 7"
        ).fetchone()[0]
        l4_dist = con.execute(
            """
            SELECT n_recv, count(*) n FROM inflow_15
            GROUP BY 1 ORDER BY 1 LIMIT 20
            """
        ).fetchall()
        l4_ex = rows_to_dicts(
            con,
            """
            SELECT acct, in_ts, in_amt, n_recv, n_out, out_sum
            FROM inflow_15 WHERE n_recv > 7
            ORDER BY n_recv DESC LIMIT 5
            """,
        )
        bar_png(
            "L4_fanout_per_inflow.png",
            "DISTINCT RECV WITHIN 15 MIN OF INFLOW",
            [str(r[0]) for r in l4_dist],
            [r[1] for r in l4_dist],
        )

        # L5 commission 60 min
        print("L5 60-min commission join...")
        con.execute(
            """
            CREATE TEMP TABLE inflow_60 AS
            SELECT i.acct, i.row_n AS in_row, i.in_amt,
                   sum(o.out_amt) AS out_sum, count(*) AS n_out
            FROM ins_s i
            JOIN outs_s o
              ON i.acct = o.acct
             AND o.out_ts >= i.in_ts
             AND o.out_ts <= i.in_ts + INTERVAL 60 MINUTE
            GROUP BY i.acct, i.row_n, i.in_amt
            """
        )
        l5_inflows = con.execute(
            """
            SELECT count(*) FROM inflow_60
            WHERE out_sum >= 0.95 * in_amt AND out_sum <= 0.99 * in_amt
            """
        ).fetchone()[0]
        l5_accts = con.execute(
            """
            SELECT count(*) FROM (
              SELECT acct FROM inflow_60
              WHERE out_sum >= 0.95 * in_amt AND out_sum <= 0.99 * in_amt
              GROUP BY 1
            )
            """
        ).fetchone()[0]
        l5_ex = rows_to_dicts(
            con,
            """
            SELECT acct, in_amt, out_sum, out_sum/in_amt AS ratio, n_out
            FROM inflow_60
            WHERE out_sum >= 0.95 * in_amt AND out_sum <= 0.99 * in_amt
            ORDER BY in_amt DESC LIMIT 5
            """,
        )

        # L6 equal-sized splits
        l6_inflows = con.execute(
            """
            SELECT count(*) FROM inflow_15
            WHERE n_recv BETWEEN 3 AND 7
              AND out_mean > 0 AND out_std / out_mean < 0.02
            """
        ).fetchone()[0]
        l6_accts = con.execute(
            """
            SELECT count(*) FROM (
              SELECT acct FROM inflow_15
              WHERE n_recv BETWEEN 3 AND 7 AND out_mean > 0 AND out_std / out_mean < 0.02
              GROUP BY 1
            )
            """
        ).fetchone()[0]
        l6_ex = rows_to_dicts(
            con,
            """
            SELECT acct, in_amt, n_recv, out_mean, out_std, out_std/out_mean AS cv
            FROM inflow_15
            WHERE n_recv BETWEEN 3 AND 7 AND out_mean > 0 AND out_std / out_mean < 0.02
            ORDER BY n_recv DESC, in_amt DESC LIMIT 5
            """,
        )

        # L7 running balance
        print("L7 running balance...")
        l7 = con.execute(
            """
            WITH ev AS (
              SELECT dst_acct AS acct, ts, amount AS delta, row_n FROM t
              UNION ALL
              SELECT src_acct, ts, -amount, row_n FROM t
            ),
            run AS (
              SELECT acct, ts, delta,
                     sum(delta) OVER (PARTITION BY acct ORDER BY ts, row_n) AS bal
              FROM ev
            )
            SELECT count(*) FROM (
              SELECT acct, min(bal) AS min_bal FROM run GROUP BY 1 HAVING min(bal) < -1
            )
            """
        ).fetchone()[0]
        l7_ex = rows_to_dicts(
            con,
            """
            WITH ev AS (
              SELECT dst_acct AS acct, ts, amount AS delta, row_n FROM t
              UNION ALL
              SELECT src_acct, ts, -amount, row_n FROM t
            ),
            run AS (
              SELECT acct, ts, delta,
                     sum(delta) OVER (PARTITION BY acct ORDER BY ts, row_n) AS bal
              FROM ev
            )
            SELECT acct, min(bal) AS min_bal, count(*) n_ev
            FROM run GROUP BY 1 HAVING min(bal) < -1
            ORDER BY min_bal LIMIT 5
            """,
        )

        # L9 reciprocal + short cycles on reciprocal subgraph
        print("L9 reciprocal pairs...")
        con.execute(
            """
            CREATE TEMP TABLE undirected AS
            SELECT src_acct, dst_acct, count(*) n
            FROM t GROUP BY 1,2
            """
        )
        n_recip = con.execute(
            """
            SELECT count(*) FROM undirected a
            JOIN undirected b
              ON a.src_acct = b.dst_acct AND a.dst_acct = b.src_acct
             AND a.src_acct < a.dst_acct
            """
        ).fetchone()[0]
        recip_ex = rows_to_dicts(
            con,
            """
            SELECT a.src_acct AS a, a.dst_acct AS b, a.n AS n_ab, b.n AS n_ba
            FROM undirected a
            JOIN undirected b
              ON a.src_acct = b.dst_acct AND a.dst_acct = b.src_acct
             AND a.src_acct < a.dst_acct
            ORDER BY a.n + b.n DESC LIMIT 5
            """,
        )
        print(f"  reciprocal undirected pairs={n_recip}")
        con.execute(
            """
            CREATE TEMP TABLE recip_nodes AS
            SELECT DISTINCT acct FROM (
              SELECT a.src_acct AS acct
              FROM undirected a
              JOIN undirected b
                ON a.src_acct = b.dst_acct AND a.dst_acct = b.src_acct
              UNION
              SELECT a.dst_acct
              FROM undirected a
              JOIN undirected b
                ON a.src_acct = b.dst_acct AND a.dst_acct = b.src_acct
            )
            """
        )
        n_rn = con.execute("SELECT count(*) FROM recip_nodes").fetchone()[0]
        # 3-cycles among reciprocal nodes, time-respecting, sampled via distinct node triples
        n_tri = 0
        tri_ex = []
        if n_rn and n_rn <= 8000:
            print(f"  3-cycle search on {n_rn} reciprocal nodes...")
            n_tri = con.execute(
                """
                WITH e AS (
                  SELECT DISTINCT src_acct AS a, dst_acct AS b
                  FROM t
                  WHERE src_acct IN (SELECT acct FROM recip_nodes)
                    AND dst_acct IN (SELECT acct FROM recip_nodes)
                    AND src_acct <> dst_acct
                )
                SELECT count(*) FROM e e1
                JOIN e e2 ON e1.b = e2.a AND e2.b <> e1.a
                JOIN e e3 ON e2.b = e3.a AND e3.b = e1.a
                WHERE e1.a < e1.b AND e1.a < e2.b
                """
            ).fetchone()[0]
            tri_ex = rows_to_dicts(
                con,
                """
                WITH e AS (
                  SELECT DISTINCT src_acct AS a, dst_acct AS b
                  FROM t
                  WHERE src_acct IN (SELECT acct FROM recip_nodes)
                    AND dst_acct IN (SELECT acct FROM recip_nodes)
                    AND src_acct <> dst_acct
                )
                SELECT e1.a AS n1, e1.b AS n2, e2.b AS n3
                FROM e e1
                JOIN e e2 ON e1.b = e2.a AND e2.b <> e1.a
                JOIN e e3 ON e2.b = e3.a AND e3.b = e1.a
                WHERE e1.a < e1.b AND e1.a < e2.b
                LIMIT 5
                """,
            )
        else:
            print(f"  skip full 3-cycle (reciprocal nodes={n_rn}); sample 2000 nodes")
            n_tri = con.execute(
                """
                WITH nodes AS (SELECT acct FROM recip_nodes USING SAMPLE 2000),
                e AS (
                  SELECT DISTINCT src_acct AS a, dst_acct AS b
                  FROM t
                  WHERE src_acct IN (SELECT acct FROM nodes)
                    AND dst_acct IN (SELECT acct FROM nodes)
                    AND src_acct <> dst_acct
                )
                SELECT count(*) FROM e e1
                JOIN e e2 ON e1.b = e2.a AND e2.b <> e1.a
                JOIN e e3 ON e2.b = e3.a AND e3.b = e1.a
                WHERE e1.a < e1.b AND e1.a < e2.b
                """
            ).fetchone()[0]

        # L12 victim-like then later inflows
        l12 = con.execute(
            """
            SELECT count(*) FROM acct
            WHERE n_out BETWEEN 1 AND 3 AND n_in >= 5
              AND out_amt >= 10000 AND in_amt >= out_amt
            """
        ).fetchone()[0]
        l12_ex = rows_to_dicts(
            con,
            """
            SELECT acct, n_out, n_in, out_amt, in_amt, days_active
            FROM acct
            WHERE n_out BETWEEN 1 AND 3 AND n_in >= 5
              AND out_amt >= 10000 AND in_amt >= out_amt
            ORDER BY in_amt DESC LIMIT 5
            """,
        )

        # L13 time-ignored paths: sample 30k edges
        print("L13 sample time-ignored 2-hops...")
        con.execute(
            """
            CREATE TEMP TABLE e_sample AS
            SELECT src_acct, dst_acct, ts, row_n
            FROM t USING SAMPLE 30000
            """
        )
        l13 = con.execute(
            """
            SELECT count(*) FROM e_sample a
            JOIN e_sample b ON a.dst_acct = b.src_acct AND a.src_acct <> b.dst_acct
            WHERE a.ts > b.ts
            """
        ).fetchone()[0]
        l13_ex = rows_to_dicts(
            con,
            """
            SELECT a.src_acct AS a, a.dst_acct AS b, b.dst_acct AS c,
                   a.ts AS ts_ab, b.ts AS ts_bc
            FROM e_sample a
            JOIN e_sample b ON a.dst_acct = b.src_acct AND a.src_acct <> b.dst_acct
            WHERE a.ts > b.ts
            LIMIT 5
            """,
        )
        n_sample_edges = con.execute("SELECT count(*) FROM e_sample").fetchone()[0]

        # L14 two-of-four flags
        print("L14 mule-like flags...")
        con.execute(
            """
            CREATE TEMP TABLE flags AS
            SELECT
              a.acct,
              (coalesce(p.n_in_matched,0) >= 3
               AND coalesce(p.n_fast90,0) >= 0.5 * p.n_in_matched) AS fast_pt,
              (a.fanin >= 15 AND a.n_in >= 20) AS burst_fanin,
              EXISTS (
                SELECT 1 FROM inflow_15 i
                WHERE i.acct = a.acct AND i.n_recv BETWEEN 3 AND 7
              ) AS split_3_7,
              (a.n_head_out > 0 OR a.n_for_out > 0) AS head_or_for
            FROM acct a
            LEFT JOIN pt p ON p.acct = a.acct
            """
        )
        l14 = con.execute(
            """
            SELECT
              sum(CASE WHEN CAST(fast_pt AS INT)+CAST(burst_fanin AS INT)
                            +CAST(split_3_7 AS INT)+CAST(head_or_for AS INT) >= 2
                       THEN 1 ELSE 0 END) AS n_two,
              sum(CAST(fast_pt AS INT)) AS n_pt,
              sum(CAST(burst_fanin AS INT)) AS n_fanin,
              sum(CAST(split_3_7 AS INT)) AS n_split,
              sum(CAST(head_or_for AS INT)) AS n_hf,
              count(*) AS n_acct
            FROM flags
            """
        ).fetchone()
        l14_ex = rows_to_dicts(
            con,
            """
            SELECT acct, fast_pt, burst_fanin, split_3_7, head_or_for
            FROM flags
            WHERE CAST(fast_pt AS INT)+CAST(burst_fanin AS INT)
                +CAST(split_3_7 AS INT)+CAST(head_or_for AS INT) >= 2
            LIMIT 5
            """,
        )

        n_two, n_pt, n_fanin, n_split, n_hf, n_acct_f = l14

        checks = []
        checks.append(
        rec(
            "L1",
            f"decoy-merchant accounts (fanin>=50, days>=10, n_out<=5, out/in<0.10)={l1}",
            int(l1),
            l1_ex,
            "SIGNAL" if l1 else "CLEAN",
            "Tag is_merchant from high fan-in + long life + little outflow; exclude from mule flags.",
        )
        )
        checks.append(
        rec(
            "L2",
            f"pass-through>=90% on >=5 inflows AND days_active>=10 AND n_tx>=40: {l2} accounts "
            f"(dense senders with n_out>{OUT_CAP} skipped={n_skip})",
            int(l2),
            l2_ex,
            "NOISE" if l2 else "CLEAN",
            "Long-history pass-through is a merchant/payroll lookalike — require a second mule signal (M10).",
        )
        )
        checks.append(
        rec(
            "L3",
            f"inflows (capped senders) with next out at 0s={l3_0} ({l3_acct0} accts); "
            f"next out <3 min={l3_lt3} ({l3_acct3} accts). inflow_15={n_i15}",
            int(l3_lt3),
            l3_ex,
            "SIGNAL" if l3_lt3 else "CLEAN",
            "0s and <3 min forwarding is faster than the 3-15 min PS window — keep as a velocity feature, not a reject.",
        )
        )
        checks.append(
        rec(
            "L4",
            f"inflows with 3-7 distinct receivers in 15 min={l4_3_7}; with >7={l4_gt7}. dist={l4_dist[:12]}",
            int(l4_gt7),
            l4_ex,
            "SIGNAL" if l4_3_7 else "INCONCLUSIVE",
            "3-7 split is L2/M3; >7 is still a split but weaker. Do not hard-cut at 7.",
            extra={"dist": [{"n_recv": r[0], "n": r[1]} for r in l4_dist]},
        )
        )
        checks.append(
        rec(
            "L5",
            f"inflows with 60-min out_sum in 95-99% of in={l5_inflows} across {l5_accts} accounts "
            f"(overlapping inflows can double-count — audit estimate)",
            int(l5_accts),
            l5_ex,
            "SIGNAL" if l5_accts else "CLEAN",
            "Commission band is M3. Scoring must allocate outflows without double-count (guardrail 16).",
        )
        )
        checks.append(
        rec(
            "L6",
            f"equal-sized 3-7 splits (cv<0.02) inflows={l6_inflows} accounts={l6_accts}",
            int(l6_accts),
            l6_ex,
            "SIGNAL" if l6_accts else "CLEAN",
            "Equal splits are M8/M3. Use coefficient of variation of outflow amounts after an inflow.",
        )
        )
        checks.append(
        rec(
            "L7",
            f"accounts whose running balance goes below -1 INR={l7} (money out before in, from a 0 start)",
            int(l7),
            l7_ex,
            "NOISE" if l7 else "CLEAN",
            "Starting balance is unknown. Negative running sum ≠ fraud; do not treat as a trap unless extreme vs inflows.",
        )
        )
        send_only, recv_only = l8
        checks.append(
        rec(
            "L8",
            f"send-never-receive={send_only}; receive-never-send={recv_only} of {n_acct} accounts",
            int(send_only + recv_only),
            l8_ex,
            "SIGNAL",
            "Send-only ≈ victims/sources; recv-only ≈ L3 sinks. Core role features, not rejects.",
        )
        )
        checks.append(
        rec(
            "L9",
            f"reciprocal pairs={n_recip}; 3-cycles among reciprocal nodes (or 2000-node sample)={n_tri} "
            f"(igraph not installed; SQL on subgraph of {n_rn} nodes)",
            int(n_recip),
            recip_ex[:5] + tri_ex[:2],
            "NOISE" if n_recip > 1000 else "SIGNAL",
            "Cycles (M6) must be computed on a candidate subgraph, not the full 2M-edge graph.",
            extra={"reciprocal_pairs": n_recip, "triangles": n_tri, "recip_nodes": n_rn},
        )
        )
        checks.append(
        rec(
            "L10",
            f"accounts with >=5 tx and lifespan <2 hours={l10}",
            int(l10),
            l10_ex,
            "SIGNAL" if l10 else "CLEAN",
            "Short burst lifespan is M10. Strong when combined with pass-through or headless.",
        )
        )
        checks.append(
        rec(
            "L11",
            f"dormant-then-burst (span>=5d, >=70% of activity on one day, <=3 active days, tot>=10)={l11}",
            int(l11),
            l11_ex,
            "SIGNAL" if l11 else "CLEAN",
            "Dormancy-then-burst is M10. Measure on calendar days, not just first/last ts.",
        )
        )
        checks.append(
        rec(
            "L12",
            f"victim-like (1-3 outs, large out_amt) that also receive (>=5 ins, in>=out)={l12}",
            int(l12),
            l12_ex,
            "SIGNAL" if l12 else "CLEAN",
            "A 'victim' that later receives large inflows may be an L1. Do not freeze the role at hop 0.",
        )
        )
        checks.append(
        rec(
            "L13",
            f"time-ignored 2-hop paths on a SAMPLE of {n_sample_edges} edges: {l13} pairs where A→B happens AFTER B→C",
            int(l13),
            l13_ex,
            "NOISE",
            "Always constrain traces by time (A.ts < B.ts). Sample-based; not a full count.",
            extra={"sample_edges": n_sample_edges},
        )
        )
        checks.append(
        rec(
            "L14",
            f"accounts with >=2 of {{fast_pt, burst_fanin, 3-7 split, headless/foreign}}={n_two} "
            f"(pt={n_pt} fanin={n_fanin} split={n_split} hf={n_hf}); expect ~1500. "
            f"fast_pt uses 15-min match on senders with n_out<={OUT_CAP} (skipped {n_skip}).",
            int(n_two) if n_two is not None else None,
            l14_ex,
            "SIGNAL" if n_two else "INCONCLUSIVE",
            "This is a loose candidate set, not the Final Index. Tune thresholds on features, not on this audit flag.",
            extra={
                "n_two": n_two,
                "n_pt": n_pt,
                "n_fanin": n_fanin,
                "n_split": n_split,
                "n_hf": n_hf,
                "skipped_dense": n_skip,
            },
        )
        )

        dump_section(
        "L",
        checks,
        time.perf_counter() - t0,
        extra={"n_acct": n_acct, "out_cap": OUT_CAP, "skipped_dense_senders": n_skip},
        )
        print_checks(checks)


if __name__ == "__main__":
    main()
