"""Section B — Transaction_ID."""
from __future__ import annotations

import math
import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        # B1 [KNOWN] confirm counts only
        b1 = con.execute(
            """
            WITH d AS (
                SELECT tx_id, count(*) AS n
                FROM t
                GROUP BY tx_id
                HAVING count(*) > 1
            )
            SELECT
                count(*) AS n_ids,
                sum(n) AS n_rows,
                sum(CASE WHEN n = 2 THEN 1 ELSE 0 END) AS ids_twice,
                sum(CASE WHEN n = 3 THEN 1 ELSE 0 END) AS ids_thrice,
                sum(CASE WHEN n > 3 THEN 1 ELSE 0 END) AS ids_gt3,
                max(n) AS max_n
            FROM d
            """
        ).fetchone()
        b1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, count(*) AS n
            FROM t GROUP BY tx_id HAVING count(*) > 1
            ORDER BY n DESC, tx_id LIMIT 5
            """,
        )

        # B2 spaces / case / prefix
        b2 = con.execute(
            """
            SELECT
              sum(CASE WHEN tx_id <> trim(tx_id) THEN 1 ELSE 0 END) AS spaced,
              sum(CASE WHEN tx_id <> upper(tx_id) THEN 1 ELSE 0 END) AS not_upper,
              sum(CASE WHEN starts_with(lower(tx_id), 'txn') = false THEN 1 ELSE 0 END) AS other_prefix,
              sum(CASE WHEN length(tx_id) <> 12 THEN 1 ELSE 0 END) AS bad_len
            FROM t
            """
        ).fetchone()
        b2_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_acct, dst_acct, ts
            FROM t
            WHERE tx_id <> trim(tx_id) OR tx_id <> upper(tx_id)
               OR starts_with(lower(tx_id), 'txn') = false
               OR length(tx_id) <> 12
            LIMIT 5
            """,
        )

        # B3 format
        n_bad_fmt = con.execute(
            "SELECT count(*) FROM t WHERE regexp_full_match(tx_id, '^TXN[0-9]{9}$') = false"
        ).fetchone()[0]
        b3_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, length(tx_id) AS n, src_acct, ts
            FROM t WHERE regexp_full_match(tx_id, '^TXN[0-9]{9}$') = false
            LIMIT 5
            """,
        )

        # B4 ID order vs timestamp
        corr = con.execute(
            """
            SELECT corr(CAST(substr(tx_id, 4) AS BIGINT), epoch(ts))
            FROM t WHERE regexp_full_match(tx_id, '^TXN[0-9]{9}$') AND ts IS NOT NULL
            """
        ).fetchone()[0]
        inversions = con.execute(
            """
            WITH x AS (
              SELECT
                CAST(substr(tx_id, 4) AS BIGINT) AS idn,
                ts,
                lag(CAST(substr(tx_id, 4) AS BIGINT)) OVER (ORDER BY ts, row_n) AS prev_id
              FROM t
              WHERE regexp_full_match(tx_id, '^TXN[0-9]{9}$') AND ts IS NOT NULL
            )
            SELECT
              count(*) AS n,
              sum(CASE WHEN prev_id IS NOT NULL AND idn < prev_id THEN 1 ELSE 0 END) AS id_decreases
            FROM x
            """
        ).fetchone()

        # B5 leakage: ID numeric range vs headless/foreign
        b5 = con.execute(
            """
            SELECT
              is_headless,
              is_foreign,
              count(*) AS n,
              min(CAST(substr(tx_id, 4) AS BIGINT)) AS id_min,
              approx_quantile(CAST(substr(tx_id, 4) AS BIGINT), 0.5) AS id_p50,
              max(CAST(substr(tx_id, 4) AS BIGINT)) AS id_max
            FROM t
            WHERE regexp_full_match(tx_id, '^TXN[0-9]{9}$')
            GROUP BY 1, 2
            ORDER BY 1, 2
            """
        ).fetchall()
        b5_dicts = [
            {"is_headless": r[0], "is_foreign": r[1], "n": r[2], "id_min": r[3], "id_p50": r[4], "id_max": r[5]}
            for r in b5
        ]
        # overlap of ranges
        rng = con.execute(
            """
            SELECT
              min(CASE WHEN is_headless THEN CAST(substr(tx_id,4) AS BIGINT) END) AS h_min,
              max(CASE WHEN is_headless THEN CAST(substr(tx_id,4) AS BIGINT) END) AS h_max,
              min(CASE WHEN NOT is_headless THEN CAST(substr(tx_id,4) AS BIGINT) END) AS n_min,
              max(CASE WHEN NOT is_headless THEN CAST(substr(tx_id,4) AS BIGINT) END) AS n_max,
              min(CASE WHEN is_foreign THEN CAST(substr(tx_id,4) AS BIGINT) END) AS f_min,
              max(CASE WHEN is_foreign THEN CAST(substr(tx_id,4) AS BIGINT) END) AS f_max
            FROM t
            WHERE regexp_full_match(tx_id, '^TXN[0-9]{9}$')
            """
        ).fetchone()
    finally:
        con.close()

    n_ids, n_rows, twice, thrice, gt3, max_n = b1
    checks = []
    known_ok = (int(n_ids) == 2250 and int(n_rows) == 4502 and int(thrice) == 2) or (
        abs(int(n_ids) - 2250) <= 2
    )
    checks.append(
        rec(
            "B1",
            f"duplicate IDs={n_ids}, covering {n_rows} rows; twice={twice}, thrice={thrice}, >3={gt3}, max={max_n}",
            int(n_rows),
            b1_ex,
            "NOISE" if known_ok or int(thrice) >= 1 else "TRAP",
            "Keep both rows; join on tx_key not tx_id; cite tx_id with ts/amount/parties on notices.",
            extra={"ids_twice": int(twice), "ids_thrice": int(thrice)},
        )
    )
    spaced, not_upper, other_prefix, bad_len = b2
    b2_n = int(spaced + not_upper + other_prefix + bad_len)
    checks.append(
        rec(
            "B2",
            f"leading/trailing space={spaced}, not upper={not_upper}, prefix not txn={other_prefix}, len!=12={bad_len}",
            b2_n,
            b2_ex,
            "CLEAN" if b2_n == 0 else "TRAP",
            "Reject IDs with whitespace or unexpected prefix; do not trim-to-fix silently.",
        )
    )
    checks.append(
        rec(
            "B3",
            f"rows not matching ^TXN[0-9]{{9}}$ : {n_bad_fmt}",
            int(n_bad_fmt),
            b3_ex,
            "CLEAN" if n_bad_fmt == 0 else "TRAP",
            "Validate ^TXN[0-9]{9}$ at ingest; keep original ID even when duplicated.",
        )
    )
    inv_n, inv_dec = inversions
    share = (inv_dec / inv_n) if inv_n else None
    # sequential IDs would have ~0 inversions; random ~0.5
    if share is None:
        v = "INCONCLUSIVE"
    elif share < 0.05:
        v = "SIGNAL"
    elif 0.4 <= share <= 0.6:
        v = "CLEAN"
    else:
        v = "NOISE"
    checks.append(
        rec(
            "B4",
            f"corr(id_numeric, epoch(ts))={corr}; time-ordered ID decreases={inv_dec}/{inv_n} share={share}",
            int(inv_dec or 0),
            [{"corr": corr, "decrease_share": share}],
            v,
            "Do not treat ID magnitude as time or as a feature. IDs look assigned independently of ts."
            if share and share > 0.3
            else "If IDs are sequential with time, do not use that as a mule signal.",
        )
    )
    # leakage if headless IDs sit in a disjoint range
    h_min, h_max, n_min, n_max, f_min, f_max = rng
    disjoint_h = h_min is not None and n_min is not None and (h_max < n_min or n_max < h_min)
    checks.append(
        rec(
            "B5",
            f"headless id range [{h_min},{h_max}] vs normal [{n_min},{n_max}] disjoint={disjoint_h}; "
            f"foreign [{f_min},{f_max}]",
            int(disjoint_h),
            b5_dicts[:5],
            "TRAP" if disjoint_h else "CLEAN",
            "Do NOT score on Transaction_ID numeric range (leakage). Ranges overlap — no shortcut.",
            extra={"groups": b5_dicts},
        )
    )

    dump_section("B", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
