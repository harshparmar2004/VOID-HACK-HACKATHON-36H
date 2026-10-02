"""Victim -> mule chain audit (analysis only).

In-memory DuckDB; never opens data\\case.duckdb.
Does not use account-number ranges, 1,327/1,327 counts, or device
proportions to select or label accounts.
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

import duckdb

from _common import (
    AUDITS_DIR,
    REPORTS_DIR,
    connect,
    jsonable,
)

WINDOW_SQL = "INTERVAL 60 MINUTE"
L3_CATS = ("P2A", "WALLET_LOAD")


def q_all(con, sql: str, params=None) -> list[dict]:
    res = con.execute(sql, params) if params is not None else con.execute(sql)
    cols = [c[0] for c in res.description]
    return [{c: jsonable(v) for c, v in zip(cols, tup)} for tup in res.fetchall()]


def q1(con, sql: str, params=None):
    row = con.execute(sql, params).fetchone() if params is not None else con.execute(sql).fetchone()
    return row[0] if row else None


def scalar_row(con, sql: str, params=None) -> dict:
    rows = q_all(con, sql, params)
    return rows[0] if rows else {}


def md_table(headers: list[str], rows: list[list]) -> str:
    def cell(x) -> str:
        if x is None:
            return "—"
        if isinstance(x, float):
            if abs(x) >= 1000:
                return f"{x:,.2f}"
            if abs(x) >= 1:
                return f"{x:.4f}".rstrip("0").rstrip(".")
            return f"{x:.6f}".rstrip("0").rstrip(".")
        return str(x)

    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    for r in rows:
        lines.append("| " + " | ".join(cell(c) for c in r) + " |")
    return "\n".join(lines)


def build(con) -> dict[str, str]:
    """Create analysis tables. Returns the SQL used for each step."""
    sql: dict[str, str] = {}

    sql["acct"] = """
CREATE TABLE acct AS
WITH s AS (
  SELECT src_acct AS acct,
         count(*) AS n_out,
         sum(amount) AS out_amt,
         min(ts) AS first_out,
         max(ts) AS last_out
  FROM t GROUP BY 1
), r AS (
  SELECT dst_acct AS acct,
         count(*) AS n_in,
         sum(amount) AS in_amt,
         min(ts) AS first_in,
         max(ts) AS last_in
  FROM t GROUP BY 1
)
SELECT
  coalesce(s.acct, r.acct) AS acct,
  coalesce(s.n_out, 0) AS n_out,
  coalesce(r.n_in, 0) AS n_in,
  coalesce(s.n_out, 0) + coalesce(r.n_in, 0) AS n_tx,
  coalesce(s.out_amt, 0) AS out_amt,
  coalesce(r.in_amt, 0) AS in_amt,
  least(coalesce(s.first_out, r.first_in), coalesce(r.first_in, s.first_out)) AS first_ts,
  greatest(coalesce(s.last_out, r.last_in), coalesce(r.last_in, s.last_out)) AS last_ts,
  datediff('day',
           least(coalesce(s.first_out, r.first_in), coalesce(r.first_in, s.first_out)),
           greatest(coalesce(s.last_out, r.last_in), coalesce(r.last_in, s.last_out)))
    + 1 AS days_active
FROM s FULL JOIN r ON s.acct = r.acct
"""
    con.execute(sql["acct"])

    sql["victims"] = """
CREATE TABLE victims AS
SELECT acct FROM acct WHERE n_out > 0 AND n_in = 0
"""
    con.execute(sql["victims"])

    sql["sinks"] = """
CREATE TABLE sinks AS
SELECT acct FROM acct WHERE n_in > 0 AND n_out = 0
"""
    con.execute(sql["sinks"])

    # L3-combo row = headless device AND foreign IP AND cash-out category.
    # Category token is the 2nd slash-separated field (P2A / WALLET_LOAD).
    # Selection is behavioural only — no account-digit filter, no 1327 counts.
    sql["l3_rows"] = """
CREATE TABLE l3_rows AS
SELECT
  file_row_number AS tx_key,
  tx_id,
  src_acct,
  dst_acct,
  amount,
  ts,
  narration,
  device,
  split_part(narration, '/', 2) AS narr_cat
FROM t
WHERE is_headless
  AND is_foreign
  AND split_part(narration, '/', 2) IN ('P2A', 'WALLET_LOAD')
"""
    con.execute(sql["l3_rows"])

    sql["l3_senders"] = """
CREATE TABLE l3_senders AS
SELECT src_acct AS acct, count(*) AS n_l3, sum(amount) AS l3_amt
FROM l3_rows
GROUP BY 1
"""
    con.execute(sql["l3_senders"])

    sql["vpay"] = """
CREATE TABLE vpay AS
SELECT
  t.file_row_number AS tx_key,
  t.tx_id,
  t.src_acct AS victim,
  t.dst_acct AS hop1,
  t.amount,
  t.amount_paise,
  t.ts,
  t.mode,
  t.device,
  t.narration,
  t.is_headless,
  t.is_foreign
FROM t
JOIN victims v ON t.src_acct = v.acct
"""
    con.execute(sql["vpay"])
    print(f"  vpay={con.execute('SELECT count(*) FROM vpay').fetchone()[0]}")

    sql["hop1_fanin"] = """
CREATE TABLE hop1_fanin AS
SELECT
  hop1,
  count(*) AS n_vpay,
  count(DISTINCT victim) AS n_victims,
  sum(amount) AS in_from_victims,
  min(ts) AS first_v,
  max(ts) AS last_v
FROM vpay
GROUP BY 1
"""
    con.execute(sql["hop1_fanin"])

    # Hop 2: first-mule outflows AFTER the victim payment, within 60 minutes.
    sql["h2_edge"] = """
CREATE TABLE h2_edge AS
SELECT
  v.tx_key AS in_tx_key,
  v.tx_id AS in_tx_id,
  v.victim,
  v.hop1 AS from_acct,
  v.amount AS in_amt,
  v.ts AS in_ts,
  t.file_row_number AS out_tx_key,
  t.tx_id AS out_tx_id,
  t.dst_acct AS to_acct,
  t.amount AS out_amt,
  t.ts AS out_ts,
  t.mode,
  t.narration,
  t.device,
  t.is_headless,
  t.is_foreign,
  datediff('second', v.ts, t.ts) AS lag_sec
FROM vpay v
JOIN t
  ON t.src_acct = v.hop1
 AND t.ts >= v.ts
 AND t.ts <= v.ts + INTERVAL 60 MINUTE
"""
    con.execute(sql["h2_edge"])
    print(f"  h2_edge={con.execute('SELECT count(*) FROM h2_edge').fetchone()[0]}")

    sql["h2_agg"] = """
CREATE TABLE h2_agg AS
SELECT
  in_tx_key,
  any_value(victim) AS victim,
  any_value(from_acct) AS hop1,
  any_value(in_amt) AS in_amt,
  any_value(in_ts) AS in_ts,
  count(*) AS n_out,
  count(DISTINCT to_acct) AS n_recv,
  sum(out_amt) AS out_sum,
  min(lag_sec) AS min_lag,
  quantile_cont(lag_sec, 0.5) AS med_lag,
  max(lag_sec) AS max_lag,
  sum(out_amt) / nullif(any_value(in_amt), 0) AS ratio
FROM h2_edge
GROUP BY in_tx_key
"""
    con.execute(sql["h2_agg"])

    sql["h3_edge"] = """
CREATE TABLE h3_edge AS
SELECT
  e.in_tx_key AS v_tx_key,
  e.victim,
  e.from_acct AS hop1,
  e.out_tx_key AS in_tx_key,
  e.out_tx_id AS in_tx_id,
  e.to_acct AS from_acct,
  e.out_amt AS in_amt,
  e.out_ts AS in_ts,
  t.file_row_number AS out_tx_key,
  t.tx_id AS out_tx_id,
  t.dst_acct AS to_acct,
  t.amount AS out_amt,
  t.ts AS out_ts,
  t.mode,
  t.narration,
  t.device,
  t.is_headless,
  t.is_foreign,
  datediff('second', e.out_ts, t.ts) AS lag_sec
FROM h2_edge e
JOIN t
  ON t.src_acct = e.to_acct
 AND t.ts >= e.out_ts
 AND t.ts <= e.out_ts + INTERVAL 60 MINUTE
"""
    con.execute(sql["h3_edge"])
    print(f"  h3_edge={con.execute('SELECT count(*) FROM h3_edge').fetchone()[0]}")

    sql["h3_agg"] = """
CREATE TABLE h3_agg AS
SELECT
  in_tx_key,
  any_value(v_tx_key) AS v_tx_key,
  any_value(victim) AS victim,
  any_value(from_acct) AS hop2_acct,
  any_value(in_amt) AS in_amt,
  any_value(in_ts) AS in_ts,
  count(*) AS n_out,
  count(DISTINCT to_acct) AS n_recv,
  sum(out_amt) AS out_sum,
  min(lag_sec) AS min_lag,
  quantile_cont(lag_sec, 0.5) AS med_lag,
  max(lag_sec) AS max_lag,
  sum(out_amt) / nullif(any_value(in_amt), 0) AS ratio
FROM h3_edge
GROUP BY in_tx_key
"""
    con.execute(sql["h3_agg"])

    sql["h4_edge"] = """
CREATE TABLE h4_edge AS
SELECT
  e.v_tx_key,
  e.victim,
  e.in_tx_key AS hop3_in_key,
  e.out_tx_key AS in_tx_key,
  e.out_tx_id AS in_tx_id,
  e.to_acct AS from_acct,
  e.out_amt AS in_amt,
  e.out_ts AS in_ts,
  t.file_row_number AS out_tx_key,
  t.tx_id AS out_tx_id,
  t.dst_acct AS to_acct,
  t.amount AS out_amt,
  t.ts AS out_ts,
  t.mode,
  t.narration,
  t.device,
  t.is_headless,
  t.is_foreign,
  datediff('second', e.out_ts, t.ts) AS lag_sec
FROM h3_edge e
JOIN t
  ON t.src_acct = e.to_acct
 AND t.ts >= e.out_ts
 AND t.ts <= e.out_ts + INTERVAL 60 MINUTE
"""
    con.execute(sql["h4_edge"])
    print(f"  h4_edge={con.execute('SELECT count(*) FROM h4_edge').fetchone()[0]}")

    sql["h4_agg"] = """
CREATE TABLE h4_agg AS
SELECT
  in_tx_key,
  any_value(v_tx_key) AS v_tx_key,
  any_value(victim) AS victim,
  any_value(from_acct) AS hop3_acct,
  any_value(in_amt) AS in_amt,
  any_value(in_ts) AS in_ts,
  count(*) AS n_out,
  count(DISTINCT to_acct) AS n_recv,
  sum(out_amt) AS out_sum,
  min(lag_sec) AS min_lag,
  quantile_cont(lag_sec, 0.5) AS med_lag,
  max(lag_sec) AS max_lag,
  sum(out_amt) / nullif(any_value(in_amt), 0) AS ratio
FROM h4_edge
GROUP BY in_tx_key
"""
    con.execute(sql["h4_agg"])

    # Per-victim-payment endpoints (first hop at which an L3 sender or sink is reached).
    sql["chain"] = """
CREATE TABLE chain AS
WITH
h1_acct AS (
  SELECT tx_key AS v_tx_key, hop1 AS acct, 1 AS hop FROM vpay
),
h2_acct AS (
  SELECT in_tx_key AS v_tx_key, to_acct AS acct, 2 AS hop FROM h2_edge
),
h3_acct AS (
  SELECT v_tx_key, to_acct AS acct, 3 AS hop FROM h3_edge
),
h4_acct AS (
  SELECT v_tx_key, to_acct AS acct, 4 AS hop FROM h4_edge
),
nodes AS (
  SELECT * FROM h1_acct
  UNION ALL SELECT * FROM h2_acct
  UNION ALL SELECT * FROM h3_acct
  UNION ALL SELECT * FROM h4_acct
),
reach AS (
  SELECT
    n.v_tx_key,
    min(CASE WHEN l.acct IS NOT NULL THEN n.hop END) AS l3_hop,
    min(CASE WHEN s.acct IS NOT NULL THEN n.hop END) AS sink_hop
  FROM nodes n
  LEFT JOIN l3_senders l ON l.acct = n.acct
  LEFT JOIN sinks s ON s.acct = n.acct
  GROUP BY 1
)
SELECT
  v.tx_key AS v_tx_key,
  v.victim,
  v.hop1,
  v.amount,
  v.ts,
  v.tx_id,
  r.l3_hop,
  r.sink_hop,
  (a.in_tx_key IS NOT NULL) AS has_h2,
  a.n_recv AS h2_n_recv,
  a.ratio AS h2_ratio,
  a.min_lag AS h2_min_lag,
  a.out_sum AS h2_out_sum
FROM vpay v
LEFT JOIN reach r ON r.v_tx_key = v.tx_key
LEFT JOIN h2_agg a ON a.in_tx_key = v.tx_key
"""
    con.execute(sql["chain"])
    return sql


def hop_metrics(con, agg_table: str, edge_table: str, to_col: str) -> dict:
    n_edges = q1(con, f"SELECT count(*) FROM {edge_table}") or 0
    n_accts = q1(con, f"SELECT count(DISTINCT {to_col}) FROM {edge_table}") or 0
    n_inflows = q1(con, f"SELECT count(*) FROM {agg_table}") or 0
    empty_lag = {
        "min_lag": None, "med_lag": None, "max_lag": None, "avg_lag": None,
        "n_lag0": 0, "n_lag_lt3": 0, "n_backwards": 0,
    }
    empty_ratio = {
        "min_r": None, "med_r": None, "max_r": None, "avg_r": None,
        "n_exact_098": 0, "n_round_098": 0, "n_band_95_99": 0,
        "n_exceeds": 0, "n_exceeds_1_5": 0,
    }
    empty_split = {"n1": 0, "n2": 0, "n3_7": 0, "n_gt7": 0}
    if n_edges == 0:
        return {
            "n_edges": 0,
            "n_accts": 0,
            "n_inflows_with_out": 0,
            "lag": empty_lag,
            "ratio": empty_ratio,
            "recv_dist": [],
            "split_band": empty_split,
        }
    lag = scalar_row(
        con,
        f"""
        SELECT
          min(lag_sec) AS min_lag,
          quantile_cont(lag_sec, 0.5) AS med_lag,
          max(lag_sec) AS max_lag,
          avg(lag_sec) AS avg_lag,
          sum(CASE WHEN lag_sec = 0 THEN 1 ELSE 0 END) AS n_lag0,
          sum(CASE WHEN lag_sec > 0 AND lag_sec < 180 THEN 1 ELSE 0 END) AS n_lag_lt3,
          sum(CASE WHEN lag_sec < 0 THEN 1 ELSE 0 END) AS n_backwards
        FROM {edge_table}
        """,
    )
    ratio = scalar_row(
        con,
        f"""
        SELECT
          min(ratio) AS min_r,
          quantile_cont(ratio, 0.5) AS med_r,
          max(ratio) AS max_r,
          avg(ratio) AS avg_r,
          sum(CASE WHEN abs(ratio - 0.98) < 1e-5 THEN 1 ELSE 0 END) AS n_exact_098,
          sum(CASE WHEN round(ratio, 2) = 0.98 THEN 1 ELSE 0 END) AS n_round_098,
          sum(CASE WHEN ratio BETWEEN 0.95 AND 0.99 THEN 1 ELSE 0 END) AS n_band_95_99,
          sum(CASE WHEN out_sum > in_amt THEN 1 ELSE 0 END) AS n_exceeds,
          sum(CASE WHEN out_sum > 1.5 * in_amt THEN 1 ELSE 0 END) AS n_exceeds_1_5
        FROM {agg_table}
        """,
    )
    recv_dist = q_all(
        con,
        f"""
        SELECT n_recv, count(*) AS n_inflows
        FROM {agg_table}
        GROUP BY 1 ORDER BY 1
        LIMIT 20
        """,
    )
    split_band = scalar_row(
        con,
        f"""
        SELECT
          sum(CASE WHEN n_recv = 1 THEN 1 ELSE 0 END) AS n1,
          sum(CASE WHEN n_recv = 2 THEN 1 ELSE 0 END) AS n2,
          sum(CASE WHEN n_recv BETWEEN 3 AND 7 THEN 1 ELSE 0 END) AS n3_7,
          sum(CASE WHEN n_recv > 7 THEN 1 ELSE 0 END) AS n_gt7
        FROM {agg_table}
        """,
    )
    return {
        "n_edges": n_edges,
        "n_accts": n_accts,
        "n_inflows_with_out": n_inflows,
        "lag": lag,
        "ratio": ratio,
        "recv_dist": recv_dist,
        "split_band": split_band,
    }


def collect(con, sql: dict[str, str]) -> dict:
    out: dict = {"sql": sql, "steps": []}

    n_victims = q1(con, "SELECT count(*) FROM victims")
    n_sinks = q1(con, "SELECT count(*) FROM sinks")
    n_l3_senders = q1(con, "SELECT count(*) FROM l3_senders")
    n_l3_rows = q1(con, "SELECT count(*) FROM l3_rows")
    n_vpay = q1(con, "SELECT count(*) FROM vpay")

    v_n_out = q_all(
        con,
        """
        SELECT n_out, count(*) AS n_accts
        FROM acct
        WHERE n_out > 0 AND n_in = 0
        GROUP BY 1 ORDER BY 1
        LIMIT 20
        """,
    )
    v_amt = scalar_row(
        con,
        """
        SELECT
          count(*) AS n,
          min(amount) AS min_amt,
          quantile_cont(amount, 0.5) AS med_amt,
          avg(amount) AS avg_amt,
          quantile_cont(amount, 0.9) AS p90_amt,
          max(amount) AS max_amt,
          sum(CASE WHEN amount >= 400000 THEN 1 ELSE 0 END) AS n_ge_4L,
          sum(CASE WHEN amount >= 100000 THEN 1 ELSE 0 END) AS n_ge_1L,
          sum(amount) AS sum_amt
        FROM vpay
        """,
    )
    v_time = scalar_row(
        con,
        """
        SELECT
          min(ts) AS min_ts,
          max(ts) AS max_ts,
          count(DISTINCT CAST(ts AS DATE)) AS n_dates
        FROM vpay
        """,
    )
    v_by_date = q_all(
        con,
        """
        SELECT CAST(CAST(ts AS DATE) AS VARCHAR) AS d, count(*) AS n, round(sum(amount), 2) AS amt
        FROM vpay GROUP BY 1 ORDER BY 1
        """,
    )
    v_ex = q_all(
        con,
        """
        SELECT tx_key, tx_id, victim, hop1, amount, ts, mode
        FROM vpay ORDER BY amount DESC LIMIT 5
        """,
    )
    n_not_one = q1(
        con,
        """
        SELECT count(*) FROM acct
        WHERE n_out > 0 AND n_in = 0 AND n_out <> 1
        """,
    )

    out["step1"] = {
        "n_victims": n_victims,
        "n_vpay": n_vpay,
        "n_not_exactly_one_out": n_not_one,
        "n_out_dist": v_n_out,
        "amount": v_amt,
        "time": v_time,
        "by_date": v_by_date,
        "examples": v_ex,
    }

    n_hop1 = q1(con, "SELECT count(*) FROM hop1_fanin")
    fanin_dist = q_all(
        con,
        """
        SELECT n_victims, count(*) AS n_mules, sum(n_vpay) AS n_payments
        FROM hop1_fanin
        GROUP BY 1 ORDER BY 1
        LIMIT 20
        """,
    )
    n_multi_victim = q1(con, "SELECT count(*) FROM hop1_fanin WHERE n_victims > 1")
    max_fanin = q1(con, "SELECT max(n_victims) FROM hop1_fanin")
    hop1_busy = scalar_row(
        con,
        """
        SELECT
          count(*) AS n_mules,
          avg(a.n_tx) AS avg_n_tx,
          quantile_cont(a.n_tx, 0.5) AS med_n_tx,
          min(a.n_tx) AS min_n_tx,
          max(a.n_tx) AS max_n_tx,
          avg(a.n_in) AS avg_n_in,
          avg(a.n_out) AS avg_n_out,
          avg(a.days_active) AS avg_days,
          sum(CASE WHEN a.n_in = f.n_vpay THEN 1 ELSE 0 END) AS n_only_victim_inflows,
          sum(CASE WHEN a.n_in > f.n_vpay THEN 1 ELSE 0 END) AS n_extra_inflows,
          sum(CASE WHEN a.n_tx >= 50 THEN 1 ELSE 0 END) AS n_tx_ge_50,
          sum(CASE WHEN a.n_in >= 10 THEN 1 ELSE 0 END) AS n_in_ge_10
        FROM hop1_fanin f
        JOIN acct a ON a.acct = f.hop1
        """,
    )
    hop1_ex = q_all(
        con,
        """
        SELECT f.hop1, f.n_victims, f.n_vpay, f.in_from_victims,
               a.n_in, a.n_out, a.n_tx, a.days_active
        FROM hop1_fanin f JOIN acct a ON a.acct = f.hop1
        ORDER BY f.n_victims DESC, a.n_tx DESC
        LIMIT 5
        """,
    )
    hop1_l3 = q1(
        con,
        """
        SELECT count(*) FROM hop1_fanin f
        JOIN l3_senders l ON l.acct = f.hop1
        """,
    )

    out["step2"] = {
        "n_distinct_first_mules": n_hop1,
        "n_multi_victim_mules": n_multi_victim,
        "max_victims_per_mule": max_fanin,
        "fanin_dist": fanin_dist,
        "lifetime": hop1_busy,
        "n_first_mules_are_l3_senders": hop1_l3,
        "examples": hop1_ex,
    }

    n_vpay_no_h2 = q1(
        con,
        """
        SELECT count(*) FROM vpay v
        ANTI JOIN h2_agg a ON v.tx_key = a.in_tx_key
        """,
    )
    n_h2_back = q1(con, "SELECT count(*) FROM h2_edge WHERE lag_sec < 0")
    h2 = hop_metrics(con, "h2_agg", "h2_edge", "to_acct")
    h2["n_vpay_no_forward"] = n_vpay_no_h2
    h2["n_backwards_edges"] = n_h2_back
    h2["examples"] = q_all(
        con,
        """
        SELECT in_tx_key, victim, hop1, in_amt, n_out, n_recv, out_sum, ratio,
               min_lag, med_lag, max_lag
        FROM h2_agg
        ORDER BY abs(ratio - 0.98) ASC, n_recv DESC
        LIMIT 5
        """,
    )
    h2["busy_examples"] = q_all(
        con,
        """
        SELECT in_tx_key, victim, hop1, in_amt, n_recv, out_sum, ratio, min_lag
        FROM h2_agg
        WHERE out_sum > in_amt
        ORDER BY ratio DESC
        LIMIT 5
        """,
    )
    out["step3"] = h2

    h3 = hop_metrics(con, "h3_agg", "h3_edge", "to_acct")
    n_h2_no_h3 = q1(
        con,
        """
        SELECT count(*) FROM h2_edge e
        ANTI JOIN h3_agg a ON e.out_tx_key = a.in_tx_key
        """,
    )
    h3["n_inflows_no_forward"] = n_h2_no_h3
    h3["n_backwards_edges"] = q1(con, "SELECT count(*) FROM h3_edge WHERE lag_sec < 0")
    h3["examples"] = q_all(
        con,
        """
        SELECT in_tx_key, victim, hop2_acct, in_amt, n_out, n_recv, out_sum, ratio, min_lag
        FROM h3_agg
        ORDER BY abs(coalesce(ratio, 0) - 0.98) ASC
        LIMIT 5
        """,
    )
    out["step4_h3"] = h3

    h4 = hop_metrics(con, "h4_agg", "h4_edge", "to_acct")
    n_h3_no_h4 = q1(
        con,
        """
        SELECT count(*) FROM h3_edge e
        ANTI JOIN h4_agg a ON e.out_tx_key = a.in_tx_key
        """,
    )
    h4["n_inflows_no_forward"] = n_h3_no_h4
    h4["n_backwards_edges"] = q1(con, "SELECT count(*) FROM h4_edge WHERE lag_sec < 0")
    h4["examples"] = q_all(
        con,
        """
        SELECT in_tx_key, victim, hop3_acct, in_amt, n_out, n_recv, out_sum, ratio, min_lag
        FROM h4_agg
        ORDER BY abs(coalesce(ratio, 0) - 0.98) ASC
        LIMIT 5
        """,
    )
    out["step4_h4"] = h4

    n_accts_h1 = q1(con, "SELECT count(DISTINCT hop1) FROM vpay")
    n_accts_h2 = q1(con, "SELECT count(DISTINCT to_acct) FROM h2_edge")
    n_accts_h3 = q1(con, "SELECT count(DISTINCT to_acct) FROM h3_edge")
    n_accts_h4 = q1(con, "SELECT count(DISTINCT to_acct) FROM h4_edge")

    union_sql = """
CREATE TABLE hop_accts AS
SELECT hop1 AS acct, 1 AS hop FROM vpay
UNION
SELECT to_acct, 2 FROM h2_edge
UNION
SELECT to_acct, 3 FROM h3_edge
UNION
SELECT to_acct, 4 FROM h4_edge
"""
    con.execute(union_sql)
    sql["hop_accts"] = union_sql

    n_union = q1(con, "SELECT count(DISTINCT acct) FROM hop_accts")
    overlap_l3 = scalar_row(
        con,
        """
        SELECT
          count(DISTINCT h.acct) AS n_overlap,
          count(DISTINCT CASE WHEN h.hop = 1 THEN h.acct END) AS n_h1,
          count(DISTINCT CASE WHEN h.hop = 2 THEN h.acct END) AS n_h2,
          count(DISTINCT CASE WHEN h.hop = 3 THEN h.acct END) AS n_h3,
          count(DISTINCT CASE WHEN h.hop = 4 THEN h.acct END) AS n_h4
        FROM hop_accts h
        JOIN l3_senders l ON l.acct = h.acct
        """,
    )
    l3_not_in_chain = q1(
        con,
        """
        SELECT count(*) FROM l3_senders l
        ANTI JOIN (SELECT DISTINCT acct FROM hop_accts) h USING (acct)
        """,
    )
    hop_role_mix = q_all(
        con,
        """
        SELECT h.hop,
               count(DISTINCT h.acct) AS n_accts,
               count(DISTINCT CASE WHEN l.acct IS NOT NULL THEN h.acct END) AS n_l3,
               count(DISTINCT CASE WHEN s.acct IS NOT NULL THEN h.acct END) AS n_sink
        FROM hop_accts h
        LEFT JOIN l3_senders l ON l.acct = h.acct
        LEFT JOIN sinks s ON s.acct = h.acct
        GROUP BY 1 ORDER BY 1
        """,
    )

    endpoints = scalar_row(
        con,
        """
        SELECT
          count(*) AS n_chains,
          sum(CASE WHEN l3_hop IS NOT NULL THEN 1 ELSE 0 END) AS n_reach_l3,
          sum(CASE WHEN l3_hop = 1 THEN 1 ELSE 0 END) AS l3_at_1,
          sum(CASE WHEN l3_hop = 2 THEN 1 ELSE 0 END) AS l3_at_2,
          sum(CASE WHEN l3_hop = 3 THEN 1 ELSE 0 END) AS l3_at_3,
          sum(CASE WHEN l3_hop = 4 THEN 1 ELSE 0 END) AS l3_at_4,
          sum(CASE WHEN sink_hop IS NOT NULL THEN 1 ELSE 0 END) AS n_reach_sink,
          sum(CASE WHEN sink_hop = 1 THEN 1 ELSE 0 END) AS sink_at_1,
          sum(CASE WHEN sink_hop = 2 THEN 1 ELSE 0 END) AS sink_at_2,
          sum(CASE WHEN sink_hop = 3 THEN 1 ELSE 0 END) AS sink_at_3,
          sum(CASE WHEN sink_hop = 4 THEN 1 ELSE 0 END) AS sink_at_4,
          sum(CASE WHEN l3_hop IS NULL AND sink_hop IS NULL THEN 1 ELSE 0 END) AS n_neither,
          sum(CASE WHEN has_h2 = FALSE THEN 1 ELSE 0 END) AS n_dead_after_h1
        FROM chain
        """,
    )
    out["step5"] = {
        "n_sinks": n_sinks,
        "n_l3_senders": n_l3_senders,
        "n_l3_rows": n_l3_rows,
        "endpoints": endpoints,
    }
    out["step6"] = {
        "n_h1": n_accts_h1,
        "n_h2": n_accts_h2,
        "n_h3": n_accts_h3,
        "n_h4": n_accts_h4,
        "n_union_1_4": n_union,
        "expected_mules": 1500,
        "overlap_l3": overlap_l3,
        "l3_senders_not_in_chains": l3_not_in_chain,
        "hop_role_mix": hop_role_mix,
        "n_l3_senders": n_l3_senders,
    }

    # Hypothesis breakers
    out["breakers"] = {
        "victims_not_exactly_one_out": n_not_one,
        "vpay_with_no_60min_forward": n_vpay_no_h2,
        "h2_backwards_edges": n_h2_back,
        "h3_backwards_edges": h3["n_backwards_edges"],
        "h4_backwards_edges": h4["n_backwards_edges"],
        "first_mules_with_extra_inflows": hop1_busy.get("n_extra_inflows"),
        "first_mules_n_tx_ge_50": hop1_busy.get("n_tx_ge_50"),
        "h2_inflows_out_exceeds_in": h2["ratio"].get("n_exceeds"),
        "h2_inflows_out_gt_1_5_in": h2["ratio"].get("n_exceeds_1_5"),
        "h2_split_gt7": h2["split_band"].get("n_gt7"),
        "h2_split_1": h2["split_band"].get("n1"),
        "h2_exact_098": h2["ratio"].get("n_exact_098"),
        "chains_never_reach_l3_or_sink": endpoints.get("n_neither"),
        "first_mules_that_are_l3": hop1_l3,
        "multi_victim_first_mules": n_multi_victim,
    }

    # Cycle-ish: hop2/3/4 receiver equals hop1
    out["breakers"]["h2_back_to_hop1"] = q1(
        con, "SELECT count(*) FROM h2_edge WHERE to_acct = from_acct"
    )
    out["breakers"]["h2_back_to_victim"] = q1(
        con, "SELECT count(*) FROM h2_edge WHERE to_acct = victim"
    )
    out["breakers"]["h3_to_hop1"] = q1(
        con, "SELECT count(*) FROM h3_edge WHERE to_acct = hop1"
    )

    def edge_combo(table: str) -> dict:
        return scalar_row(
            con,
            f"""
            SELECT
              count(*) AS n,
              sum(CASE WHEN is_headless THEN 1 ELSE 0 END) AS n_headless,
              sum(CASE WHEN is_foreign THEN 1 ELSE 0 END) AS n_foreign,
              sum(CASE WHEN is_headless AND is_foreign
                        AND split_part(narration, '/', 2) IN ('P2A', 'WALLET_LOAD')
                       THEN 1 ELSE 0 END) AS n_l3combo,
              sum(CASE WHEN split_part(narration, '/', 2) = 'P2A' THEN 1 ELSE 0 END) AS n_p2a,
              sum(CASE WHEN split_part(narration, '/', 2) = 'WALLET_LOAD' THEN 1 ELSE 0 END) AS n_wallet
            FROM {table}
            """,
        )

    out["edge_combo"] = {
        "vpay": edge_combo("vpay"),
        "h2": edge_combo("h2_edge"),
        "h3": edge_combo("h3_edge"),
    }
    out["h3_exact_096"] = q1(
        con,
        "SELECT count(*) FROM h3_agg WHERE abs(ratio - 0.96) < 1e-4",
    )
    out["vpay_narr"] = q_all(
        con,
        """
        SELECT split_part(narration, '/', 2) AS cat, count(*) AS n
        FROM vpay GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        """,
    )
    return out


def pick_examples(con) -> list[dict]:
    """Three complete paths: textbook 0.98 split to L3; to a sink; a breaker."""
    textbook = q_all(
        con,
        """
        SELECT c.v_tx_key, c.victim, c.hop1, c.amount, c.ts, c.tx_id,
               c.l3_hop, c.sink_hop, c.h2_n_recv, c.h2_ratio, c.h2_min_lag
        FROM chain c
        WHERE c.l3_hop IS NOT NULL
          AND c.h2_n_recv BETWEEN 2 AND 7
          AND c.h2_ratio BETWEEN 0.95 AND 0.99
        ORDER BY abs(c.h2_ratio - 0.98), c.h2_n_recv DESC
        LIMIT 1
        """,
    )
    skip = textbook[0]["v_tx_key"] if textbook else -1
    sink = q_all(
        con,
        """
        SELECT c.v_tx_key, c.victim, c.hop1, c.amount, c.ts, c.tx_id,
               c.l3_hop, c.sink_hop, c.h2_n_recv, c.h2_ratio, c.h2_min_lag
        FROM chain c
        WHERE c.sink_hop IS NOT NULL
          AND c.v_tx_key <> ?
        ORDER BY c.sink_hop, c.amount DESC
        LIMIT 1
        """,
        [skip],
    )
    skip2 = sink[0]["v_tx_key"] if sink else -1
    small = q_all(
        con,
        """
        SELECT c.v_tx_key, c.victim, c.hop1, c.amount, c.ts, c.tx_id,
               c.l3_hop, c.sink_hop, c.h2_n_recv, c.h2_ratio, c.h2_min_lag,
               a.n_tx AS hop1_n_tx, a.n_in AS hop1_n_in, a.n_out AS hop1_n_out
        FROM chain c
        JOIN acct a ON a.acct = c.hop1
        WHERE c.v_tx_key NOT IN (?, ?)
        ORDER BY c.amount ASC
        LIMIT 1
        """,
        [skip, skip2],
    )
    chosen = []
    for label, rows in (
        ("textbook_098_to_L3", textbook),
        ("reaches_sink", sink),
        ("smallest_victim_not_5_lakh", small),
    ):
        if not rows:
            continue
        row = rows[0]
        key = row["v_tx_key"]
        path = one_path(con, key)
        h2_sibs = q_all(
            con,
            """
            SELECT out_tx_key, out_tx_id, to_acct, out_amt, out_ts, lag_sec
            FROM h2_edge WHERE in_tx_key = ?
            ORDER BY out_ts, out_tx_key
            LIMIT 10
            """,
            [key],
        )
        chosen.append({"label": label, "meta": row, "path": path, "h2_siblings": h2_sibs})
    return chosen


def one_path(con, v_tx_key: int) -> list[dict]:
    """Greedy path: prefer next hop that is an L3 sender, else a sink, else largest amount."""
    hops = []
    v = scalar_row(
        con,
        """
        SELECT tx_key, tx_id, victim AS from_acct, hop1 AS to_acct, amount, ts,
               mode, device, narration
        FROM vpay WHERE tx_key = ?
        """,
        [v_tx_key],
    )
    if not v:
        return hops
    hops.append({**v, "hop": 1, "lag_sec": None})
    in_key = v_tx_key
    tables = [
        (2, "h2_edge", "in_tx_key"),
        (3, "h3_edge", "in_tx_key"),
        (4, "h4_edge", "in_tx_key"),
    ]
    for hop, table, keycol in tables:
        nxt = q_all(
            con,
            f"""
            SELECT
              e.out_tx_key AS tx_key,
              e.out_tx_id AS tx_id,
              e.from_acct,
              e.to_acct,
              e.out_amt AS amount,
              e.out_ts AS ts,
              e.lag_sec,
              e.mode,
              e.device,
              e.narration,
              (l.acct IS NOT NULL) AS to_is_l3,
              (s.acct IS NOT NULL) AS to_is_sink
            FROM {table} e
            LEFT JOIN l3_senders l ON l.acct = e.to_acct
            LEFT JOIN sinks s ON s.acct = e.to_acct
            WHERE e.{keycol} = ?
            ORDER BY to_is_l3 DESC, to_is_sink DESC, e.out_amt DESC, e.out_tx_key
            LIMIT 1
            """,
            [in_key],
        )
        if not nxt:
            break
        row = nxt[0]
        hops.append({**row, "hop": hop})
        in_key = row["tx_key"]
    return hops


def fmt_amt(x) -> str:
    if x is None:
        return "—"
    return f"₹{float(x):,.2f}"


def fmt_lag(sec) -> str:
    if sec is None:
        return "—"
    sec = int(sec)
    if sec < 60:
        return f"{sec}s"
    return f"{sec}s ({sec/60:.1f} min)"


def write_report(stats: dict, examples: list[dict], runtime_s: float, duckdb_ver: str) -> Path:
    s1 = stats["step1"]
    s2 = stats["step2"]
    s3 = stats["step3"]
    s4a = stats["step4_h3"]
    s4b = stats["step4_h4"]
    s5 = stats["step5"]
    s6 = stats["step6"]
    br = stats["breakers"]
    ep = s5["endpoints"]
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def hop_row(hop, n_accts, n_xfer, m):
        lag = m["lag"]
        ratio = m["ratio"]
        sb = m["split_band"]
        return [
            hop,
            n_accts,
            n_xfer,
            f"min={lag.get('min_lag')} med={lag.get('med_lag')} max={lag.get('max_lag')}; "
            f"0s={lag.get('n_lag0')} <3min={lag.get('n_lag_lt3')} back={lag.get('n_backwards')}",
            f"med={ratio.get('med_r')} exact0.98={ratio.get('n_exact_098')} "
            f"round0.98={ratio.get('n_round_098')} band95-99={ratio.get('n_band_95_99')} "
            f"exceeds={ratio.get('n_exceeds')}",
            f"1={sb.get('n1')} 2={sb.get('n2')} 3-7={sb.get('n3_7')} >7={sb.get('n_gt7')}",
        ]

    summary_rows = [
        ["1 victims", "Send-only accounts (n_in=0, n_out>0)", s1["n_victims"]],
        ["1 outflows", "Outgoing txs from those accounts", s1["n_vpay"]],
        ["1 not-one", "Send-only accounts with n_out ≠ 1", s1["n_not_exactly_one_out"]],
        ["1 amount", f"min={s1['amount'].get('min_amt')} med={s1['amount'].get('med_amt')} "
         f"max={s1['amount'].get('max_amt')}; ≥₹4L={s1['amount'].get('n_ge_4L')}",
         s1["amount"].get("n_ge_4L")],
        ["2 first mules", "Distinct hop-1 receivers of victim payments", s2["n_distinct_first_mules"]],
        ["2 fan-in", "First mules that receive from >1 victim", s2["n_multi_victim_mules"]],
        ["2 max fan-in", "Max distinct victims per first mule", s2["max_victims_per_mule"]],
        ["2 extra in", "First mules with inflows besides victim payments",
         s2["lifetime"].get("n_extra_inflows")],
        ["3 no forward", "Victim payments with no 60-min outflow from first mule",
         s3["n_vpay_no_forward"]],
        ["3 h2 edges", "Hop-2 transfers (first mule → next, 60 min)", s3["n_edges"]],
        ["3 h2 accts", "Distinct hop-2 receivers", s3["n_accts"]],
        ["3 exact 0.98", "Hop-2 inflows with out/in exactly 0.98", s3["ratio"].get("n_exact_098")],
        ["3 exceeds", "Hop-2 inflows where out_sum > victim amount", s3["ratio"].get("n_exceeds")],
        ["4 h3 edges", "Hop-3 transfers", s4a["n_edges"]],
        ["4 h3 accts", "Distinct hop-3 receivers", s4a["n_accts"]],
        ["4 h4 edges", "Hop-4 transfers", s4b["n_edges"]],
        ["4 h4 accts", "Distinct hop-4 receivers", s4b["n_accts"]],
        ["5 reach L3", "Victim payments whose chain hits an L3-combo sender", ep.get("n_reach_l3")],
        ["5 L3 hop1-4", f"at1={ep.get('l3_at_1')} at2={ep.get('l3_at_2')} "
         f"at3={ep.get('l3_at_3')} at4={ep.get('l3_at_4')}", ep.get("n_reach_l3")],
        ["5 reach sink", "Victim payments whose chain hits a receive-only account",
         ep.get("n_reach_sink")],
        ["5 neither", "Chains that hit neither L3 sender nor sink within 4 hops",
         ep.get("n_neither")],
        ["6 union", "Distinct accounts at hops 1–4 combined", s6["n_union_1_4"]],
        ["6 vs 1500", "Union minus expected ~1,500 mules",
         (s6["n_union_1_4"] or 0) - 1500],
        ["6 ∩ L3", "Hop 1–4 accounts that are L3-combo senders",
         s6["overlap_l3"].get("n_overlap")],
        ["6 L3 miss", "L3-combo senders never reached by these chains",
         s6["l3_senders_not_in_chains"]],
        ["break busy", "First mules with lifetime n_tx ≥ 50", br.get("first_mules_n_tx_ge_50")],
        ["break back", "Hop-2 edges with lag_sec < 0 (should be 0)", br.get("h2_backwards_edges")],
        ["combo h2", "Hop-2 edges that are L3-combo rows",
         (stats.get("edge_combo") or {}).get("h2", {}).get("n_l3combo")],
        ["combo h3", "Hop-3 edges that are L3-combo rows",
         (stats.get("edge_combo") or {}).get("h3", {}).get("n_l3combo")],
    ]

    lines = []
    a = lines.append
    a("# Victim → mule chain report")
    a("")
    a("Independent analysis of the hypothesis in `reports\\traps_report.md`:")
    a("the 300 send-only accounts are victims; each sends one large payment (~₹5 lakh)")
    a("to a first mule, which forwards ~98% (2% commission) to 2–7 accounts within 60 minutes;")
    a("money then continues and may end in the L3 cluster (headless + foreign IP +")
    a("P2A/WALLET_LOAD narration).")
    a("")
    a("**No project code was modified. `data\\case.duckdb` was not opened. `abhedya\\` was not touched.**")
    a("**Leakage unused:** account-number ranges, 1,327/1,327 counts, and device proportions")
    a("were not used to select or label anything. L3 is defined only by the behavioural combo")
    a("`is_headless AND is_foreign AND narr_cat IN ('P2A','WALLET_LOAD')`.")
    a("")
    a("| Field | Value |")
    a("|---|---|")
    a(f"| Written | {now} |")
    a(f"| DuckDB | {duckdb_ver} |")
    a("| CSV rows | 2,000,000 |")
    a(f"| Runtime | {runtime_s:.1f} s |")
    a("| Script | `audits\\victim_chains.py` |")
    a("| Window | 60 minutes after each hop's inflow, `ts >= in_ts` (0-second forwards allowed) |")
    a("")
    a("## Summary")
    a("")
    a(md_table(["step", "finding", "count"], summary_rows))
    a("")
    a("## Per-hop metrics")
    a("")
    a("Hop 1 is the victim payment itself (no lag / no out-in ratio). Hops 2–4 are")
    a("time-respecting outflows within 60 minutes of the previous hop's inflow.")
    a("Out/in at hop *k* is `sum(out in window) / inflow_amount` of that hop, not of the original victim amount.")
    a("")
    hop1_recv = s1["n_out_dist"]
    hop1_recv_s = ", ".join(f"n_out={r['n_out']}:{r['n_accts']}" for r in hop1_recv)
    a(md_table(
        ["hop", "accounts", "transfers", "lag stats", "out/in ratio stats", "receivers per sender"],
        [
            [
                1,
                s2["n_distinct_first_mules"],
                s1["n_vpay"],
                "n/a (origin)",
                "n/a (origin)",
                hop1_recv_s or "—",
            ],
            hop_row(2, s3["n_accts"], s3["n_edges"], s3),
            hop_row(3, s4a["n_accts"], s4a["n_edges"], s4a),
            hop_row(4, s4b["n_accts"], s4b["n_edges"], s4b),
        ],
    ))
    a("")
    a("### Receivers-per-inflow distributions")
    a("")
    a("**Hop 2** (first mule, 60 min after victim payment):")
    a("")
    a(md_table(
        ["n_recv", "n_inflows"],
        [[r["n_recv"], r["n_inflows"]] for r in s3["recv_dist"]],
    ))
    a("")
    a("**Hop 3:**")
    a("")
    a(md_table(
        ["n_recv", "n_inflows"],
        [[r["n_recv"], r["n_inflows"]] for r in s4a["recv_dist"]] or [["—", 0]],
    ))
    a("")
    a("**Hop 4:**")
    a("")
    a(md_table(
        ["n_recv", "n_inflows"],
        [[r["n_recv"], r["n_inflows"]] for r in s4b["recv_dist"]] or [["—", 0]],
    ))
    a("")
    a("## Step 1 — 300 send-only accounts")
    a("")
    a(f"- Send-only accounts: **{s1['n_victims']}**")
    a(f"- Outgoing transactions from them: **{s1['n_vpay']}**")
    a(f"- Accounts with `n_out ≠ 1`: **{s1['n_not_exactly_one_out']}**")
    a(f"- `n_out` distribution: {hop1_recv_s}")
    amt = s1["amount"]
    a(f"- Amount min/median/mean/p90/max: {fmt_amt(amt.get('min_amt'))} / "
      f"{fmt_amt(amt.get('med_amt'))} / {fmt_amt(amt.get('avg_amt'))} / "
      f"{fmt_amt(amt.get('p90_amt'))} / {fmt_amt(amt.get('max_amt'))}")
    a(f"- Count ≥ ₹1 lakh: {amt.get('n_ge_1L')}; ≥ ₹4 lakh: {amt.get('n_ge_4L')}; "
      f"sum = {fmt_amt(amt.get('sum_amt'))}")
    tm = s1["time"]
    a(f"- Time window: {tm.get('min_ts')} → {tm.get('max_ts')} ({tm.get('n_dates')} dates)")
    if stats.get("vpay_narr"):
        a("- Victim-payment narration categories: " +
          ", ".join(f"{r['cat']}={r['n']}" for r in stats["vpay_narr"]))
    a("")
    a("Victim payments by date:")
    a("")
    a(md_table(
        ["date", "n", "amount"],
        [[r["d"], r["n"], fmt_amt(r["amt"])] for r in s1["by_date"]],
    ))
    a("")
    a("Largest victim payments (5):")
    a("")
    a(md_table(
        ["tx_key", "tx_id", "victim", "first_mule", "amount", "ts", "mode"],
        [[r["tx_key"], r["tx_id"], r["victim"], r["hop1"], fmt_amt(r["amount"]), r["ts"], r["mode"]]
         for r in s1["examples"]],
    ))
    a("")
    a("## Step 2 — Hop 1 first mules")
    a("")
    a(f"- Distinct first mules: **{s2['n_distinct_first_mules']}**")
    a(f"- First mules with >1 victim: **{s2['n_multi_victim_mules']}** (max victims/mule = {s2['max_victims_per_mule']})")
    a(f"- First mules that are themselves L3-combo senders: **{s2['n_first_mules_are_l3_senders']}**")
    a("")
    a("Victims per first mule:")
    a("")
    a(md_table(
        ["n_victims", "n_mules", "n_payments"],
        [[r["n_victims"], r["n_mules"], r["n_payments"]] for r in s2["fanin_dist"]],
    ))
    a("")
    lt = s2["lifetime"]
    a("First-mule **lifetime** activity (whole file, not the 60-min window):")
    a("")
    a(md_table(
        ["metric", "value"],
        [
            ["avg / median / min / max n_tx",
             f"{lt.get('avg_n_tx')} / {lt.get('med_n_tx')} / {lt.get('min_n_tx')} / {lt.get('max_n_tx')}"],
            ["avg n_in / n_out / days_active",
             f"{lt.get('avg_n_in')} / {lt.get('avg_n_out')} / {lt.get('avg_days')}"],
            ["only victim inflows (n_in = n_vpay)", lt.get("n_only_victim_inflows")],
            ["extra non-victim inflows", lt.get("n_extra_inflows")],
            ["n_tx ≥ 50 (busy-like)", lt.get("n_tx_ge_50")],
            ["n_in ≥ 10", lt.get("n_in_ge_10")],
        ],
    ))
    a("")
    a("Example first mules:")
    a("")
    a(md_table(
        ["hop1", "n_victims", "n_vpay", "in_from_victims", "n_in", "n_out", "n_tx", "days"],
        [[r["hop1"], r["n_victims"], r["n_vpay"], fmt_amt(r["in_from_victims"]),
          r["n_in"], r["n_out"], r["n_tx"], r["days_active"]]
         for r in s2["examples"]],
    ))
    a("")
    a("## Step 3 — Hop 2 (60 min after victim payment)")
    a("")
    a(f"- Victim payments with **no** 60-min forward: **{s3['n_vpay_no_forward']}**")
    a(f"- Hop-2 edges: **{s3['n_edges']}**; distinct receivers: **{s3['n_accts']}**")
    a(f"- Inflows that produced at least one out: **{s3['n_inflows_with_out']}**")
    a(f"- Backwards edges (lag < 0): **{s3['n_backwards_edges']}**")
    a(f"- Exact ratio 0.98: **{s3['ratio'].get('n_exact_098')}**; "
      f"round(ratio,2)=0.98: **{s3['ratio'].get('n_round_098')}**; "
      f"band 0.95–0.99: **{s3['ratio'].get('n_band_95_99')}**")
    a(f"- out_sum > in_amt: **{s3['ratio'].get('n_exceeds')}**; "
      f"out_sum > 1.5×in: **{s3['ratio'].get('n_exceeds_1_5')}**")
    a(f"- Lag on edges: min={s3['lag'].get('min_lag')}s med={s3['lag'].get('med_lag')}s "
      f"max={s3['lag'].get('max_lag')}s; 0s={s3['lag'].get('n_lag0')}; "
      f"<3 min (excluding 0)={s3['lag'].get('n_lag_lt3')}")
    a("")
    a("Closest-to-0.98 hop-2 inflows:")
    a("")
    a(md_table(
        ["victim", "hop1", "in_amt", "n_recv", "out_sum", "ratio", "min_lag"],
        [[r["victim"], r["hop1"], fmt_amt(r["in_amt"]), r["n_recv"],
          fmt_amt(r["out_sum"]), r["ratio"], r["min_lag"]]
         for r in s3["examples"]],
    ))
    a("")
    if s3.get("busy_examples"):
        a("Hop-2 inflows where outflows exceed the victim amount (busy-mule candidates):")
        a("")
        a(md_table(
            ["victim", "hop1", "in_amt", "n_recv", "out_sum", "ratio", "min_lag"],
            [[r["victim"], r["hop1"], fmt_amt(r["in_amt"]), r["n_recv"],
              fmt_amt(r["out_sum"]), r["ratio"], r["min_lag"]]
             for r in s3["busy_examples"]],
        ))
        a("")
    a("## Step 4 — Hops 3 and 4")
    a("")
    a(f"Hop-2 edges with no 60-min onward out: **{s4a.get('n_inflows_no_forward')}**")
    a(f"Hop-3 edges with no 60-min onward out: **{s4b.get('n_inflows_no_forward')}**")
    a("")
    a("See the per-hop metrics table. Hop 3/4 out/in is versus **that hop's inflow**, not the original ₹5 lakh.")
    a("")
    a("## Step 5 — Endpoints")
    a("")
    a(f"L3-combo senders in the file (behavioural definition): **{s5['n_l3_senders']}** "
      f"({s5['n_l3_rows']} rows). Receive-only sinks: **{s5['n_sinks']}**.")
    a("")
    a(md_table(
        ["endpoint", "chains", "at hop1", "at hop2", "at hop3", "at hop4"],
        [
            ["reaches L3-combo sender", ep.get("n_reach_l3"),
             ep.get("l3_at_1"), ep.get("l3_at_2"), ep.get("l3_at_3"), ep.get("l3_at_4")],
            ["reaches receive-only sink", ep.get("n_reach_sink"),
             ep.get("sink_at_1"), ep.get("sink_at_2"), ep.get("sink_at_3"), ep.get("sink_at_4")],
        ],
    ))
    a("")
    a(f"- Chains that never hit L3 or a sink in 4 hops: **{ep.get('n_neither')}**")
    a(f"- Dead after hop 1 (no 60-min forward): **{ep.get('n_dead_after_h1')}**")
    a("")
    a("A chain “reaches L3” when any account on hops 1–4 is a sender of at least one")
    a("L3-combo row anywhere in the file (not necessarily the chain edge itself).")
    a("")
    a("## Step 6 — Distinct accounts vs ~1,500 mules")
    a("")
    a(md_table(
        ["set", "distinct accounts", "of which L3 senders", "of which sinks"],
        [
            ["hop 1 (first mules)", s6["n_h1"],
             next((r["n_l3"] for r in s6["hop_role_mix"] if r["hop"] == 1), 0),
             next((r["n_sink"] for r in s6["hop_role_mix"] if r["hop"] == 1), 0)],
            ["hop 2", s6["n_h2"],
             next((r["n_l3"] for r in s6["hop_role_mix"] if r["hop"] == 2), 0),
             next((r["n_sink"] for r in s6["hop_role_mix"] if r["hop"] == 2), 0)],
            ["hop 3", s6["n_h3"],
             next((r["n_l3"] for r in s6["hop_role_mix"] if r["hop"] == 3), 0),
             next((r["n_sink"] for r in s6["hop_role_mix"] if r["hop"] == 3), 0)],
            ["hop 4", s6["n_h4"],
             next((r["n_l3"] for r in s6["hop_role_mix"] if r["hop"] == 4), 0),
             next((r["n_sink"] for r in s6["hop_role_mix"] if r["hop"] == 4), 0)],
            ["hops 1–4 union", s6["n_union_1_4"],
             s6["overlap_l3"].get("n_overlap"), "—"],
            ["expected injected mules", 1500, "—", "—"],
            ["L3 senders not on these chains", s6["l3_senders_not_in_chains"],
             s6["l3_senders_not_in_chains"], "—"],
        ],
    ))
    a("")
    a(f"Union of hops 1–4 = **{s6['n_union_1_4']}** vs expected **~1,500** mules "
      f"(delta { (s6['n_union_1_4'] or 0) - 1500 }).")
    a("Accounts can appear at more than one hop (overlap); the union column de-duplicates.")
    a("")
    a("## Example chains")
    a("")
    a("Each path is one greedy walk: at every hop prefer a next account that is an L3 sender,")
    a("else a sink, else the largest outflow. Hop-2 siblings (full 60-min fan-out, up to 10)")
    a("are listed under the path. Transaction_ID is cited with timestamp and amount because IDs are not unique.")
    a("")
    for i, ex in enumerate(examples, 1):
        meta = ex["meta"]
        a(f"### Example {i}: `{ex['label']}`")
        a("")
        a(f"- Victim `{meta.get('victim')}` → first mule `{meta.get('hop1')}`")
        a(f"- Victim payment `{meta.get('tx_id')}` at `{meta.get('ts')}` amount {fmt_amt(meta.get('amount'))} (tx_key={meta.get('v_tx_key')})")
        a(f"- Hop-2 n_recv={meta.get('h2_n_recv')} ratio={meta.get('h2_ratio')} min_lag={fmt_lag(meta.get('h2_min_lag'))}")
        a(f"- First L3 hop={meta.get('l3_hop')}; first sink hop={meta.get('sink_hop')}")
        if meta.get("hop1_n_tx") is not None:
            a(f"- First mule lifetime n_tx={meta.get('hop1_n_tx')} n_in={meta.get('hop1_n_in')} n_out={meta.get('hop1_n_out')}")
        a("")
        a("| hop | from | to | tx_id | ts | amount | lag | flags |")
        a("|---|---|---|---|---|---|---|---|")
        for p in ex["path"]:
            flags = []
            if p.get("to_is_l3"):
                flags.append("L3-sender")
            if p.get("to_is_sink"):
                flags.append("sink")
            a(
                f"| {p.get('hop')} | `{p.get('from_acct')}` | `{p.get('to_acct')}` | "
                f"`{p.get('tx_id')}` | {p.get('ts')} | {fmt_amt(p.get('amount'))} | "
                f"{fmt_lag(p.get('lag_sec'))} | {', '.join(flags) or '—'} |"
            )
        a("")
        if ex.get("h2_siblings"):
            a("Hop-2 siblings (60-min fan-out from the first mule):")
            a("")
            a(md_table(
                ["tx_id", "to", "amount", "ts", "lag"],
                [[r["out_tx_id"], r["to_acct"], fmt_amt(r["out_amt"]), r["out_ts"], fmt_lag(r["lag_sec"])]
                 for r in ex["h2_siblings"]],
            ))
            a("")
    a("## What breaks the hypothesis")
    a("")
    a(md_table(
        ["check", "count", "implication"],
        [
            ["Send-only with n_out ≠ 1", br.get("victims_not_exactly_one_out"),
             "Hypothesis said exactly one outflow"],
            ["Victim payments with no 60-min forward", br.get("vpay_with_no_60min_forward"),
             "No L1/L2 layering after the first mule"],
            ["Hop-2 lag < 0", br.get("h2_backwards_edges"),
             "Time-travel (join bug or data error); expect 0"],
            ["Hop-2 back to first mule (self)", br.get("h2_back_to_hop1"),
             "Self-transfer in the window"],
            ["Hop-2 back to victim", br.get("h2_back_to_victim"),
             "Impossible if victims are send-only"],
            ["Hop-3 returns to first mule", br.get("h3_to_hop1"),
             "Cycle / bounce, not a clean downward chain"],
            ["First mules with extra inflows", br.get("first_mules_with_extra_inflows"),
             "Not dedicated collectors of only these victims"],
            ["First mules lifetime n_tx ≥ 50", br.get("first_mules_n_tx_ge_50"),
             "Look like ordinary busy accounts, not one-shot mules"],
            ["Hop-2 out_sum > victim amount", br.get("h2_inflows_out_exceeds_in"),
             "Window captured unrelated outs, or mule mixes other funds"],
            ["Hop-2 out_sum > 1.5× victim", br.get("h2_inflows_out_gt_1_5_in"),
             "Strong busy-account contamination"],
            ["Hop-2 n_recv = 1 (pass-through, not 2–7 split)", br.get("h2_split_1"),
             "First mule is a forwarder, not a splitter"],
            ["Hop-2 n_recv > 7", br.get("h2_split_gt7"),
             "Wider than the PS 3–7 split"],
            ["Hop-2 exact 0.98 ratio", br.get("h2_exact_098"),
             "Supports the 2% commission story — here it is ALL 300"],
            ["First mule is already an L3 sender", br.get("first_mules_that_are_l3"),
             "Cash-out device is the splitter; L3 is not a later hop"],
            ["First mules with >1 victim", br.get("multi_victim_first_mules"),
             "Collector-style fan-in exists (max 8)"],
            ["Chains never reach L3 or sink", br.get("chains_never_reach_l3_or_sink"),
             "Money stays in intermediate accounts or window is too short"],
            ["Victim amount ≥ ₹4 lakh", s1["amount"].get("n_ge_4L"),
             "Only 71/300 are ~₹5 lakh; median is ₹2.85 lakh"],
            ["Hop-2 lag < 3 min", s3["lag"].get("n_lag_lt3"),
             "Victim-chain hop-2 is 3–15 min only (min lag 180s)"],
            ["Hop-3 3–7 splits", s4a["split_band"].get("n3_7"),
             "Hop-3 is 1-way pass-through, not another splitter"],
            ["Hop-4 edges", s4b["n_edges"],
             "No fourth hop; sinks do not forward"],
        ],
    ))
    a("")
    combo = stats.get("edge_combo") or {}
    a("## Implications for roles")
    a("")
    a("Suggestions only — **nothing applied** to scoring or ingest.")
    a("")
    a("Observed shape (every one of the 300 victim payments):")
    a("")
    a("```")
    a("Victim (send-only, 1 tx, phone device, TASK/REFUND narration)")
    a("  └─▶ Hop1 first mule (129 accounts): collector fan-in 1–8 victims")
    a("        AND 3–6 way split at out/in = 0.98 after 3–15 min")
    a("        AND the split rows are L3-combo (headless + foreign + P2A)")
    a("        └─▶ Hop2 (559 accounts): 1-way pass-through at out/in ≈ 0.96")
    a("              AND those rows are L3-combo (headless + foreign + WALLET_LOAD)")
    a("              └─▶ Hop3 (385 receive-only sinks): no hop 4")
    a("```")
    a("")
    a("1. **Victims (300).** Confirmed. Every send-only account has exactly one outflow.")
    a("   Amounts are large but **not** all ~₹5 lakh: min ₹51,698.58, median ₹285,009,")
    a("   71/300 ≥ ₹4 lakh, 276/300 ≥ ₹1 lakh. Narration on the victim debit is TASK/REFUND,")
    a("   device is a phone — not the L3 combo. Treat as trace starts, not mules.")
    a("")
    a("2. **Hop 1 is collector AND splitter AND cash-out device — not a pure L1.**")
    a(f"   129 first mules; 91 receive from 2–8 victims (max 8); 38 are 1:1.")
    a("   They have **zero** inflows except these victim payments (dedicated).")
    a("   Lifetime n_tx is 4–41 (median 11), not background-busy (~169).")
    a("   After 180–898 s (3.0–15.0 min) they split **every** victim inflow 3/4/5/6 ways")
    a("   (never 1, 2, or >6) at out/in **exactly 0.98**. Those split rows are the P2A")
    a("   L3-combo. So the first mule fires L1 (fan-in), L2 (3–6 + 2% commission) and")
    a("   L3 (headless/foreign/P2A) on the **same account**. Role scores must allow")
    a("   a high L1 *and* L2 *and* L3 on hop-1; do not force a single layer.")
    a("   Guardrail 11 still holds: do not assign the role *because* it is hop 1.")
    a("")
    a("3. **Hop 2 is a pass-through cash-out layer, not another 3–7 splitter.**")
    a("   559 accounts, all L3-combo senders. 1,318/1,327 inflows go to **one** sink;")
    a("   9 go to two. Commission is ~4% (median out/in = 0.96), not 2%.")
    a("   Rows are WALLET_LOAD + Linux_Script in the examples. This is L3-like")
    a("   (cash-out narration, headless, then a sink), not L2.")
    a("")
    a("4. **The 688 L3-combo senders are hop1 ∪ hop2, not a third layer.**")
    a("   129 + 559 = 688, disjoint, and every L3 sender in the file sits on these chains.")
    a("   Money does **not** stop there: every chain continues to a receive-only sink at hop 3.")
    a("   M4 (cash-out) will light up both the splitter and the pass-through. That is correct")
    a("   behaviourally; it is **not** independent evidence stacked on top of hop number.")
    a("   Do not treat headless, 185/194, and P2A/WALLET_LOAD as three proofs.")
    a("")
    a("5. **Sinks (385) are the terminals.** Hop-3 accounts = the full receive-only set,")
    a("   disjoint from L3 senders. They never send, so they cannot carry P2A narration.")
    a("   Freeze priority is here (holding). Keep a sink / one-way-in feature; do not")
    a("   require M4 cash-out text on an account with n_out = 0.")
    a("")
    a("6. **Coverage vs ~1,500 mules.** Hops 1–4 union = **1,073** = 129 + 559 + 385.")
    a("   1,500 − 1,073 = **427 accounts not on these chains**. They are not extra hops")
    a("   of this money (hop 4 is empty). Scoring still has to find them some other way")
    a("   (or the 1,500 includes accounts this victim set never touches). Do not pad")
    a("   the flag list with busy counterparties — hop-1/2 are dedicated, not busy.")
    a("")
    a("7. **Trace.** 60-min window is enough (all hop-2 fits in 3–15 min; hop-3 lags")
    a("   up to 3,450 s ≈ 57 min). Include the 3-minute floor; these victim chains have")
    a("   **no** 0–3 min hop-2 forwards. Follow amount-capped outs: hop-2 never exceeds")
    a("   the victim amount. Rank hop-1 by the 0.98 × 3–6 split; fan-in is extra, not required.")
    a("")
    a("8. **What the original hypothesis got wrong**")
    a("   - Amounts are median ~₹2.85 lakh, not uniformly ~₹5 lakh.")
    a("   - First mule is a collector+splitter, not a collector that hands off to a separate L2.")
    a("   - L3-combo is used on hops 1→2 and 2→3, not only at the end.")
    a("   - There is no hop 4. Terminals are the 385 sinks.")
    a("   - Hop-3 commission is 4% (0.96), not 2%.")
    a("")
    a("9. **Forbidden shortcuts remain forbidden.** Do not select mules by the 8-digit")
    a("   account band, by Linux_Script = Web_Emulator counts, or by 185.x/194.x alone.")
    a("   Hop-2 edge count happening to equal 1,327 is a generator fingerprint, not a feature.")
    a("")
    if combo:
        a("L3-combo share of chain edges (computed after the hops, not used to build them):")
        a("")
        a(md_table(
            ["edge set", "n", "headless", "foreign", "L3-combo", "P2A", "WALLET_LOAD"],
            [
                ["victim payments", combo["vpay"].get("n"), combo["vpay"].get("n_headless"),
                 combo["vpay"].get("n_foreign"), combo["vpay"].get("n_l3combo"),
                 combo["vpay"].get("n_p2a"), combo["vpay"].get("n_wallet")],
                ["hop 2", combo["h2"].get("n"), combo["h2"].get("n_headless"),
                 combo["h2"].get("n_foreign"), combo["h2"].get("n_l3combo"),
                 combo["h2"].get("n_p2a"), combo["h2"].get("n_wallet")],
                ["hop 3", combo["h3"].get("n"), combo["h3"].get("n_headless"),
                 combo["h3"].get("n_foreign"), combo["h3"].get("n_l3combo"),
                 combo["h3"].get("n_p2a"), combo["h3"].get("n_wallet")],
            ],
        ))
        a("")
    a("## Exact SQL")
    a("")
    a("CSV loaded via `audits\\_common.py`: `read_csv(..., all_varchar=true)` → `%TEMP%\\abhedya_t.parquet`")
    a("→ in-memory table `t`. Connection: `duckdb.connect()` (not `case.duckdb`).")
    a("")
    for name, text in stats["sql"].items():
        a(f"### `{name}`")
        a("")
        a("```sql")
        a(text.strip())
        a("```")
        a("")
    a("Hop-2/3/4 metrics use the corresponding `h*_agg` / `h*_edge` tables with")
    a("`min/median/max(lag_sec)`, `out_sum/in_amt`, and `n_recv` grouped by the triggering inflow.")
    a("")
    a("## How to rerun")
    a("")
    a("```bat")
    a(".venv\\Scripts\\python.exe audits\\victim_chains.py")
    a("```")
    a("")
    a("Writes `audits\\out_victim_chains.json` and `reports\\victim_chain_report.md`.")
    a("")

    path = REPORTS_DIR / "victim_chain_report.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def print_summary(stats: dict) -> None:
    s1 = stats["step1"]
    s2 = stats["step2"]
    s3 = stats["step3"]
    s4a = stats["step4_h3"]
    s4b = stats["step4_h4"]
    ep = stats["step5"]["endpoints"]
    s6 = stats["step6"]
    rows = [
        ("1", "send-only victims", s1["n_victims"]),
        ("1", "victim payments", s1["n_vpay"]),
        ("1", "n_out != 1", s1["n_not_exactly_one_out"]),
        ("1", "payments >= Rs 4 lakh", s1["amount"].get("n_ge_4L")),
        ("2", "distinct first mules", s2["n_distinct_first_mules"]),
        ("2", "first mules with >1 victim", s2["n_multi_victim_mules"]),
        ("2", "first mules extra inflows", s2["lifetime"].get("n_extra_inflows")),
        ("3", "vpay with no 60min forward", s3["n_vpay_no_forward"]),
        ("3", "hop2 edges", s3["n_edges"]),
        ("3", "hop2 accounts", s3["n_accts"]),
        ("3", "hop2 exact 0.98", s3["ratio"].get("n_exact_098")),
        ("3", "hop2 out>in", s3["ratio"].get("n_exceeds")),
        ("4", "hop3 edges", s4a["n_edges"]),
        ("4", "hop3 accounts", s4a["n_accts"]),
        ("4", "hop4 edges", s4b["n_edges"]),
        ("4", "hop4 accounts", s4b["n_accts"]),
        ("5", "chains reach L3", ep.get("n_reach_l3")),
        ("5", "chains reach sink", ep.get("n_reach_sink")),
        ("5", "chains neither", ep.get("n_neither")),
        ("6", "union hops 1-4", s6["n_union_1_4"]),
        ("6", "union ∩ L3 senders", s6["overlap_l3"].get("n_overlap")),
        ("6", "L3 senders not on chains", s6["l3_senders_not_in_chains"]),
        ("combo", "hop2 L3-combo edges", (stats.get("edge_combo") or {}).get("h2", {}).get("n_l3combo")),
        ("combo", "hop3 L3-combo edges", (stats.get("edge_combo") or {}).get("h3", {}).get("n_l3combo")),
    ]
    print(f"{'STEP':<6} {'FINDING':<36} {'COUNT':>10}")
    print("-" * 56)
    for step, finding, count in rows:
        print(f"{step:<6} {finding:<36} {str(count):>10}")


def main() -> None:
    t0 = time.perf_counter()
    print("connecting (in-memory DuckDB, parquet cache)...")
    con = connect(typed=True)
    try:
        print("building hop tables...")
        sql = build(con)
        print("collecting stats...")
        stats = collect(con, sql)
        print("picking example chains...")
        examples = pick_examples(con)
        runtime_s = time.perf_counter() - t0
        stats["runtime_s"] = round(runtime_s, 3)
        stats["duckdb"] = duckdb.__version__
        stats["examples"] = examples
        AUDITS_DIR.mkdir(parents=True, exist_ok=True)
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out_json = AUDITS_DIR / "out_victim_chains.json"
        out_json.write_text(json.dumps(stats, indent=2, default=str), encoding="utf-8")
        path = write_report(stats, examples, runtime_s, duckdb.__version__)
        print(f"wrote {out_json}")
        print(f"wrote {path}")
        print(f"runtime {runtime_s:.1f}s duckdb {duckdb.__version__}")
        print()
        print_summary(stats)
    finally:
        con.close()


if __name__ == "__main__":
    main()
