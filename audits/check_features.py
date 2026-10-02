"""
audits/check_features.py -- sanity checks for the `features` table.

Read-only. Nothing here feeds the pipeline; it exists to confirm that the
features built by engine/features.py reproduce the structure recorded in
PROJECT_CONTEXT.md Section 3b, under the definitions fixed in Section 4.6.

Every cohort below is defined by STRUCTURE ONLY -- who sends to whom, and who
never receives -- never by a ground-truth label, an account-number range or a
device count (guardrail 9, Section 3b LEAKAGE):

    send-only      : n_in = 0, n_out > 0                    (expect 300)
    receive-only   : n_out = 0, n_in > 0                    (expect 385)
    group A        : every distinct sender to it is send-only
    group B        : receives from any group-A account
    normal         : none of the above

Usage:  .venv\\Scripts\\python.exe audits\\check_features.py [--db PATH]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "case.duckdb"
MEMORY_LIMIT = "3GB"

# Cohort views, derived from tx and the structural flags alone. Group B uses
# "any sender in group A" to match reports/features_review.md; on this file
# "any" and "every" select the same 559 accounts.
COHORT_SQL = """
CREATE OR REPLACE TEMP VIEW send_only AS
    SELECT acct_id FROM features WHERE is_send_only;

CREATE OR REPLACE TEMP VIEW receive_only AS
    SELECT acct_id FROM features WHERE is_receive_only;

CREATE OR REPLACE TEMP VIEW in_edge AS
    SELECT DISTINCT dst AS acct, src AS sender FROM tx;

CREATE OR REPLACE TEMP VIEW group_a AS
    SELECT e.acct
    FROM in_edge e
    GROUP BY e.acct
    HAVING count(*) = count(*) FILTER (
        WHERE e.sender IN (SELECT acct_id FROM send_only));

CREATE OR REPLACE TEMP VIEW group_b AS
    SELECT DISTINCT e.acct
    FROM in_edge e
    WHERE e.sender IN (SELECT acct FROM group_a);
"""

COHORTS = (
    ("send-only", "is_send_only"),
    ("group A", "acct_id IN (SELECT acct FROM group_a)"),
    ("group B", "acct_id IN (SELECT acct FROM group_b)"),
    ("receive-only", "is_receive_only"),
    ("normal", "NOT is_send_only AND NOT is_receive_only "
               "AND acct_id NOT IN (SELECT acct FROM group_a) "
               "AND acct_id NOT IN (SELECT acct FROM group_b)"),
)

PASS, FAIL, INFO = "PASS", "FAIL", "----"
results: list[tuple[str, str, str]] = []


def check(label: str, ok: bool | None, detail: str) -> None:
    results.append((label, PASS if ok else (INFO if ok is None else FAIL), detail))
    print(f"  [{results[-1][1]}] {label}\n         {detail}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Sanity-check the features table.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to read (default: {DEFAULT_DB})")
    args = ap.parse_args()
    if not args.db.is_file():
        raise SystemExit(f"database not found: {args.db}")

    con = duckdb.connect(str(args.db), read_only=True)
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        con.execute(COHORT_SQL)
        one = lambda s: con.execute(s).fetchone()

        print("=" * 78)
        print("A. COHORT SIZES (structure only)")
        print("=" * 78)
        n_send = one("SELECT count(*) FROM send_only")[0]
        check("accounts with is_send_only = 300", n_send == 300, f"got {n_send:,}")
        n_recv = one("SELECT count(*) FROM receive_only")[0]
        check("accounts with is_receive_only = 385", n_recv == 385, f"got {n_recv:,}")
        check("cohort sizes", None, "  ".join(
            f"{label}={one(f'SELECT count(*) FROM features WHERE {pred}')[0]:,}"
            for label, pred in COHORTS))

        print("\n" + "=" * 78)
        print("B. GROUP TABLE (median per cohort; NULL = not applicable)")
        print("=" * 78)
        hdr = ("cohort", "n", "pass_thru", "commission", "split", "hold_h",
               "dev_cons", "recur")
        print(f"  {hdr[0]:<14}{hdr[1]:>7}{hdr[2]:>11}{hdr[3]:>12}{hdr[4]:>7}"
              f"{hdr[5]:>9}{hdr[6]:>10}{hdr[7]:>8}")
        for label, pred in COHORTS:
            r = one(f"""SELECT count(*), median(pass_through_share),
                               median(commission_ratio_median),
                               median(split_count_median), median(median_hold_hours),
                               median(device_consistency),
                               median(recurring_sender_share)
                        FROM features WHERE {pred}""")
            f = lambda v, w, p: f"{v:>{w}.{p}f}" if v is not None else f"{'NULL':>{w}}"
            print(f"  {label:<14}{r[0]:>7,}{f(r[1],11,4)}{f(r[2],12,4)}{f(r[3],7,1)}"
                  f"{f(r[4],9,2)}{f(r[5],10,2)}{f(r[6],8,3)}")

        print("\n" + "=" * 78)
        print("C. VERIFIED CHAIN SHAPE (Section 3b)")
        print("=" * 78)
        r = one("""SELECT median(commission_ratio_median), min(commission_ratio_median),
                          max(commission_ratio_median), median(split_count_median),
                          min(split_count_median), max(split_count_median),
                          median(forward_lag_median_s)
                   FROM features WHERE acct_id IN (SELECT acct FROM group_a)""")
        check("group A median commission ~ 0.98",
              r[0] is not None and 0.975 <= r[0] <= 0.985,
              f"median={r[0]:.4f}  min={r[1]:.4f}  max={r[2]:.4f}")
        check("group A median distinct receivers per inflow in 3..6",
              r[3] is not None and 3 <= r[3] <= 6,
              f"median={r[3]}  min={r[4]}  max={r[5]}  "
              f"median lag={r[6]:.0f}s ({r[6]/60:.1f} min)")

        r = one("""SELECT median(commission_ratio_median), min(commission_ratio_median),
                          max(commission_ratio_median), median(split_count_median),
                          min(split_count_median), max(split_count_median),
                          median(forward_lag_median_s)
                   FROM features WHERE acct_id IN (SELECT acct FROM group_b)""")
        check("group B median commission ~ 0.96",
              r[0] is not None and 0.95 <= r[0] <= 0.97,
              f"median={r[0]:.4f}  min={r[1]:.4f}  max={r[2]:.4f}")
        check("group B median distinct receivers per inflow = 1",
              r[3] == 1,
              f"median={r[3]}  min={r[4]}  max={r[5]}  "
              f"median lag={r[6]:.0f}s ({r[6]/60:.1f} min)")

        print("\n" + "=" * 78)
        print("D. ALLOCATION: group-B pass-through after the re-offer fix")
        print("=" * 78)
        n_low, n_b = one("""SELECT
                  count(*) FILTER (WHERE pass_through_share < 0.9),
                  count(*)
                FROM features WHERE acct_id IN (SELECT acct FROM group_b)""")
        check("group-B accounts with pass_through_share < 0.9 is 0 or near 0",
              n_low <= 5, f"{n_low} of {n_b:,}")
        if n_low:
            print("     remaining low rows:")
            for row in con.execute("""
                    SELECT acct_id, round(pass_through_share, 4),
                           round(commission_ratio_median, 4), n_in, n_out, tx_count
                    FROM features WHERE acct_id IN (SELECT acct FROM group_b)
                      AND pass_through_share < 0.9
                    ORDER BY pass_through_share LIMIT 10""").fetchall():
                print(f"       acct={row[0]:<6} pts={row[1]} comm={row[2]} "
                      f"n_in={row[3]} n_out={row[4]} tx={row[5]}")
        check("group-A accounts with pass_through_share < 0.9", None,
              f"{one('''SELECT count(*) FROM features
                        WHERE acct_id IN (SELECT acct FROM group_a)
                          AND pass_through_share < 0.9''')[0]}")

        print("\n" + "=" * 78)
        print("E. INVARIANTS")
        print("=" * 78)
        n_bad = one("SELECT count(*) FROM features WHERE commission_ratio_median > 1.0")[0]
        check("no commission_ratio_median > 1.0 anywhere", n_bad == 0,
              f"{n_bad} rows above 1.0; max = "
              f"{one('SELECT max(commission_ratio_median) FROM features')[0]}")
        n_pts = one("""SELECT count(*) FROM features
                       WHERE pass_through_share < 0 OR pass_through_share > 1""")[0]
        check("pass_through_share within 0..1", n_pts == 0,
              f"{n_pts} rows outside range; max = "
              f"{one('SELECT max(pass_through_share) FROM features')[0]:.6f}")
        n_rows, n_accts = one(
            "SELECT (SELECT count(*) FROM features), (SELECT count(*) FROM accounts)")
        check("one features row per account", n_rows == n_accts,
              f"features={n_rows:,} accounts={n_accts:,}")
        n_dupe = one("SELECT count(*) FROM (SELECT acct_id FROM features "
                     "GROUP BY 1 HAVING count(*) > 1)")[0]
        check("acct_id unique in features", n_dupe == 0, f"{n_dupe} duplicated acct_id")
        # Section 4.6: a sink must not earn balance-retention trust.
        n_sink_hold = one("""SELECT count(*) FROM features
                             WHERE is_receive_only AND median_hold_hours IS NOT NULL""")[0]
        check("receive-only accounts have NULL median_hold_hours", n_sink_hold == 0,
              f"{n_sink_hold} sinks carry a hold time")
        # device_consistency is a boolean per 4.6, not a ratio.
        n_ratio = one("""SELECT count(*) FROM features
                         WHERE device_consistency IS NOT NULL
                           AND device_consistency NOT IN (0.0, 1.0)""")[0]
        check("device_consistency is boolean 0/1 only", n_ratio == 0,
              f"{n_ratio} rows hold a fractional value")
        n_dev1_foreign = one("""SELECT count(*) FROM features f
              WHERE f.device_consistency = 1
                AND f.acct_id IN (SELECT DISTINCT src FROM tx
                                  WHERE is_foreign_ip OR is_reserved_ip)""")[0]
        check("no device_consistency = 1 account sends from a foreign/reserved IP",
              n_dev1_foreign == 0, f"{n_dev1_foreign} such accounts")

        print("\n" + "=" * 78)
        print("F. tx_count DISTRIBUTION")
        print("=" * 78)
        print(f"  {'cohort':<14} {'n':>7} {'min':>6} {'p25':>7} {'median':>8} "
              f"{'p75':>7} {'max':>7} {'mean':>8}")
        for label, pred in COHORTS:
            s = one(f"""SELECT count(*), min(tx_count),
                          quantile_cont(tx_count, 0.25), median(tx_count),
                          quantile_cont(tx_count, 0.75), max(tx_count),
                          round(avg(tx_count), 1)
                        FROM features WHERE {pred}""")
            print(f"  {label:<14} {s[0]:>7,} {s[1]:>6} {s[2]:>7.1f} {s[3]:>8.1f} "
                  f"{s[4]:>7.1f} {s[5]:>7} {s[6]:>8}")

        print("\n" + "=" * 78)
        print("G. DESCRIBE features")
        print("=" * 78)
        print(f"  {'column':<26} {'type':<10} null")
        for c, t, n, *_ in con.execute("DESCRIBE features").fetchall():
            print(f"  {c:<26} {t:<10} {n}")

        print("\n" + "=" * 78)
        n_fail = sum(1 for _, v, _ in results if v == FAIL)
        n_pass = sum(1 for _, v, _ in results if v == PASS)
        print(f"SUMMARY: {n_pass} passed, {n_fail} failed, "
              f"{sum(1 for _, v, _ in results if v == INFO)} informational")
        for label, verdict, detail in results:
            if verdict == FAIL:
                print(f"  FAILED: {label} -- {detail}")
        print("=" * 78)
    finally:
        con.close()


if __name__ == "__main__":
    main()
