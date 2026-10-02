"""Section F — Timestamp."""
from __future__ import annotations

import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        n_fail = con.execute("SELECT count(*) FROM t WHERE ts IS NULL").fetchone()[0]
        f1_ex = rows_to_dicts(
            con, "SELECT tx_id, ts_raw FROM t WHERE ts IS NULL LIMIT 5"
        )
        n_fmt = con.execute(
            "SELECT count(*) FROM t WHERE regexp_full_match(ts_raw, '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$') = false"
        ).fetchone()[0]

        span = con.execute(
            """
            SELECT min(ts), max(ts), datediff('day', min(ts), max(ts)) AS days,
                   count(DISTINCT CAST(ts AS DATE)) AS n_dates
            FROM t WHERE ts IS NOT NULL
            """
        ).fetchone()
        # "future" relative to dataset max is 0; relative to 2026-10-02 (context date)
        n_future = con.execute(
            "SELECT count(*) FROM t WHERE ts > TIMESTAMP '2026-10-02 23:59:59'"
        ).fetchone()[0]
        n_old = con.execute(
            "SELECT count(*) FROM t WHERE ts < TIMESTAMP '2026-09-01'"
        ).fetchone()[0]

        # F3 impossible that still parse: DuckDB strptime rejects hour=24 / sec=60.
        # Check raw components.
        f3 = con.execute(
            """
            SELECT
              sum(CASE WHEN CAST(substr(ts_raw,12,2) AS INT) > 23 THEN 1 ELSE 0 END) AS bad_hour,
              sum(CASE WHEN CAST(substr(ts_raw,15,2) AS INT) > 59 THEN 1 ELSE 0 END) AS bad_min,
              sum(CASE WHEN CAST(substr(ts_raw,18,2) AS INT) > 59 THEN 1 ELSE 0 END) AS bad_sec,
              sum(CASE WHEN CAST(substr(ts_raw,6,2) AS INT) > 12 THEN 1 ELSE 0 END) AS bad_mon,
              sum(CASE WHEN CAST(substr(ts_raw,9,2) AS INT) > 31 THEN 1 ELSE 0 END) AS bad_day
            FROM t
            """
        ).fetchone()

        per_day = con.execute(
            """
            SELECT CAST(ts AS DATE) AS d, count(*) n
            FROM t WHERE ts IS NOT NULL
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        days = [{"d": str(r[0]), "n": r[1]} for r in per_day]
        bar_png("F4_tx_per_day.png", "TX PER DAY", [str(r[0])[-5:] for r in per_day], [r[1] for r in per_day])

        per_hour = con.execute(
            """
            SELECT hour(ts) AS h, count(*) n
            FROM t WHERE ts IS NOT NULL
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        hours = [{"h": r[0], "n": r[1]} for r in per_hour]
        present_h = {r[0] for r in per_hour}
        missing_h = [h for h in range(24) if h not in present_h]
        bar_png("F4_tx_per_hour.png", "TX PER HOUR OF DAY", [str(r[0]) for r in per_hour], [r[1] for r in per_hour])

        f5 = con.execute(
            """
            SELECT
              sum(CASE WHEN second(ts)=0 THEN 1 ELSE 0 END) AS sec00,
              count(DISTINCT second(ts)) AS n_sec_vals,
              count(DISTINCT minute(ts)) AS n_min_vals
            FROM t WHERE ts IS NOT NULL
            """
        ).fetchone()
        sec_hist = con.execute(
            "SELECT second(ts) s, count(*) n FROM t GROUP BY 1 ORDER BY n DESC LIMIT 5"
        ).fetchall()

        top_ts = rows_to_dicts(
            con,
            "SELECT ts, count(*) n FROM t GROUP BY 1 ORDER BY n DESC LIMIT 10",
            limit=10,
        )

        # F7 minutes with many transfers from different accounts
        f7 = rows_to_dicts(
            con,
            """
            SELECT date_trunc('minute', ts) AS minute,
                   count(*) AS n_tx,
                   count(DISTINCT src_acct) AS n_src,
                   count(DISTINCT dst_acct) AS n_dst
            FROM t
            GROUP BY 1
            ORDER BY n_src DESC
            LIMIT 10
            """,
            limit=10,
        )
        f7_hi = con.execute(
            """
            SELECT count(*) FROM (
              SELECT date_trunc('minute', ts) m, count(DISTINCT src_acct) n_src
              FROM t GROUP BY 1 HAVING count(DISTINCT src_acct) >= 50
            )
            """
        ).fetchone()[0]

        # F8 row order vs time
        f8 = con.execute(
            """
            WITH x AS (
              SELECT ts, lag(ts) OVER (ORDER BY row_n) AS prev
              FROM t
            )
            SELECT
              count(*) n,
              sum(CASE WHEN prev IS NOT NULL AND ts < prev THEN 1 ELSE 0 END) AS decreases,
              sum(CASE WHEN prev IS NOT NULL AND ts = prev THEN 1 ELSE 0 END) AS ties,
              sum(CASE WHEN prev IS NOT NULL AND ts > prev THEN 1 ELSE 0 END) AS increases
            FROM x
            """
        ).fetchone()
    finally:
        con.close()

    checks = []
    checks.append(
        rec(
            "F1",
            f"strptime failures={n_fail}; raw not YYYY-MM-DD HH:MM:SS = {n_fmt}",
            int(n_fail + n_fmt),
            f1_ex,
            "CLEAN" if n_fail == 0 and n_fmt == 0 else "TRAP",
            "Keep explicit %Y-%m-%d %H:%M:%S; reject parse failures.",
        )
    )
    mn, mx, days_span, n_dates = span
    checks.append(
        rec(
            "F2",
            f"min={mn} max={mx} datediff_days={days_span} distinct_dates={n_dates}; "
            f"after 2026-10-02={n_future}; before 2026-09-01={n_old}",
            int(n_future + n_old),
            [{"min": str(mn), "max": str(mx), "days": days_span}],
            "CLEAN" if n_future == 0 and 10 <= (days_span or 0) <= 20 else "TRAP",
            "Restrict traces to the observed window; no future-date trap.",
        )
    )
    bad_h, bad_m, bad_s, bad_mon, bad_d = f3
    checks.append(
        rec(
            "F3",
            f"raw hour>23={bad_h} min>59={bad_m} sec>59={bad_s} month>12={bad_mon} day>31={bad_d}",
            int(bad_h + bad_m + bad_s + bad_mon + bad_d),
            [],
            "CLEAN" if bad_h + bad_m + bad_s + bad_mon + bad_d == 0 else "TRAP",
            "No impossible clock fields. strptime is sufficient.",
        )
    )
    day_ns = [d["n"] for d in days]
    spike = max(day_ns) / (sum(day_ns) / len(day_ns)) if day_ns else 0
    checks.append(
        rec(
            "F4",
            f"{len(days)} days, missing hours={missing_h}, max/mean day-count ratio={spike:.2f}. "
            f"hour counts={hours}",
            int(len(missing_h)),
            days[:5],
            "NOISE" if spike > 2 else "CLEAN",
            "Use hour-of-day as M9 (odd hours 1-5). Do not reject sparse hours.",
            extra={"per_day": days, "per_hour": hours, "missing_hours": missing_h},
        )
    )
    sec00, n_sec, n_min = f5
    checks.append(
        rec(
            "F5",
            f"second==00: {sec00}; distinct second values={n_sec}; distinct minutes={n_min}. top seconds={sec_hist}",
            int(sec00),
            [{"s": r[0], "n": r[1]} for r in sec_hist],
            "NOISE" if n_sec <= 2 else "CLEAN",
            "If seconds were always 00 it would be a generator artefact; mixed seconds are fine.",
        )
    )
    top1 = top_ts[0]["n"] if top_ts else 0
    checks.append(
        rec(
            "F6",
            f"top timestamp count={top1}; top10={top_ts}",
            int(top1),
            top_ts[:5],
            "TRAP" if top1 and top1 > 1000 else "CLEAN",
            "Exact-ts collisions at ~10 rows are chance, not a defaulted timestamp.",
            extra={"top10": top_ts},
        )
    )
    checks.append(
        rec(
            "F7",
            f"minutes with >=50 distinct senders={f7_hi}. busiest minutes (by n_src)={f7[:3]}",
            int(f7_hi),
            f7[:5],
            "SIGNAL" if f7_hi else "CLEAN",
            "Coordinated-burst minutes are an M2/M5 feature; do not drop those rows.",
            extra={"top_minutes": f7},
        )
    )
    n, dec, ties, inc = f8
    share_dec = dec / n if n else 0
    if share_dec < 0.01:
        f8v = "NOISE"  # file is time-sorted — tx_key correlates with time
        note = "File is almost strictly time-sorted, so row_n/tx_key tracks time."
    elif share_dec > 0.4:
        f8v = "CLEAN"
        note = "File order is not time order; tx_key is a file-row key only."
    else:
        f8v = "NOISE"
        note = "Partial time-ordering."
    checks.append(
        rec(
            "F8",
            f"row_n vs ts: decreases={dec}, ties={ties}, increases={inc}, decrease_share={share_dec:.4f}. {note}",
            int(dec),
            [{"decreases": dec, "ties": ties, "increases": inc}],
            f8v,
            "tx_key = source row number, not time. Always ORDER BY ts for traces.",
        )
    )
    dump_section("F", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
