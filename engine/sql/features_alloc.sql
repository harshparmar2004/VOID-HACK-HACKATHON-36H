-- engine/sql/features_alloc.sql
-- One-to-one inflow/outflow allocation for the features step (Section 4.6).
--
-- RULE: each outflow goes to the EARLIEST inflow in its window that still has
-- remaining amount for it. If the earliest inflow is full, the outflow is
-- re-offered to the next inflow in the window -- it is NEVER dropped just
-- because the earliest one filled up. An outflow ends up unallocated only when
-- no inflow in its window has room for it at all.
--
-- Invariants held by construction:
--   * one outflow is allocated to at most ONE inflow (no double counting),
--   * the outflows allocated to an inflow never total more than that inflow,
--     so forwarded/inflow per inflow cannot exceed 1.0 (guardrail 16).
--
-- The rule is sequential, but it is applied SET-BASED in rounds, so nothing
-- ever loops over a transaction in Python (Section 8 rule 2):
--   round k  : every still-unallocated outflow picks the earliest inflow whose
--              remaining amount (as of the end of round k-1) can take it whole;
--              within each inflow the picks are taken in time order while the
--              running total fits, and the rest fall through to round k+1,
--              where the now-full inflow is skipped and the next one is tried.
-- Rounds repeat until a round allocates nothing. Convergence is guaranteed:
-- every round either allocates at least one outflow or ends the loop, and the
-- first pick of any inflow always fits (it was filtered on remaining >= amount).
--
-- This file is a string.Template split on the "-- @@SECTION" markers by
-- engine/features.py. Placeholder: $$single_max_s (widest window, seconds).

-- @@INIT
-- Candidate pairs. Bucket width equals the widest window, so an outflow can
-- only pair with inflows in its own bucket or the previous one; that keeps the
-- range join bounded instead of materialising n_in x n_out per account.
CREATE OR REPLACE TEMP TABLE cand AS
WITH inflow AS (
    SELECT dst AS acct, tx_key AS in_key, ts_sec AS in_ts, amount_paise AS in_amt,
           CAST(floor(ts_sec / $single_max_s) AS BIGINT) AS bucket
    FROM tx
),
outflow AS (
    SELECT src AS acct, tx_key AS out_key, ts_sec AS out_ts, amount_paise AS out_amt,
           dst AS to_acct,
           CAST(floor(ts_sec / $single_max_s) AS BIGINT) AS bucket
    FROM tx
),
probe AS (
    SELECT o.acct, o.out_key, o.out_ts, o.out_amt, o.to_acct,
           o.bucket - d.d AS probe_bucket
    FROM outflow o
    CROSS JOIN (VALUES (0), (1)) AS d(d)
)
SELECT p.acct, p.out_key, p.out_ts, p.out_amt, p.to_acct,
       i.in_key, i.in_ts, i.in_amt,
       CAST(p.out_ts - i.in_ts AS INTEGER) AS lag_s
FROM probe p
JOIN inflow i
  ON i.acct = p.acct
 AND i.bucket = p.probe_bucket
WHERE i.in_ts <= p.out_ts
  AND p.out_ts - i.in_ts <= $single_max_s;

-- Remaining capacity, only for inflows that some outflow could use.
CREATE OR REPLACE TEMP TABLE rem AS
SELECT in_key, any_value(in_amt) AS in_amt, any_value(in_amt) AS remaining
FROM cand
GROUP BY in_key;

-- Accepted allocations, same shape as cand. Empty to start.
CREATE OR REPLACE TEMP TABLE alloc_pair AS SELECT * FROM cand WHERE false;

CREATE OR REPLACE TEMP TABLE allocated_out AS
SELECT out_key FROM cand WHERE false;

-- @@ROUND
INSERT INTO alloc_pair
WITH open_pair AS (
    -- Still-unallocated outflows, paired only with inflows that can take them
    -- whole right now. An inflow that filled up in an earlier round simply
    -- disappears from this set, which is what "re-offer to the next inflow" is.
    SELECT c.*
    FROM cand c
    JOIN rem r ON r.in_key = c.in_key
    WHERE r.remaining >= c.out_amt
      AND NOT EXISTS (SELECT 1 FROM allocated_out ao WHERE ao.out_key = c.out_key)
),
pick AS (
    -- Earliest such inflow per outflow.
    SELECT acct, out_key, out_ts, out_amt, to_acct, in_key, in_ts, in_amt, lag_s
    FROM (
        SELECT *,
               row_number() OVER (PARTITION BY out_key
                                  ORDER BY in_ts, in_key) AS rn
        FROM open_pair
    )
    WHERE rn = 1
),
fit AS (
    -- Several outflows may pick the same inflow. Take them in time order while
    -- the running total still fits; the rest fall through to the next round.
    SELECT p.*,
           sum(p.out_amt) OVER (PARTITION BY p.in_key
                                ORDER BY p.out_ts, p.out_key
                                ROWS BETWEEN UNBOUNDED PRECEDING
                                         AND CURRENT ROW) AS cum
    FROM pick p
)
SELECT f.acct, f.out_key, f.out_ts, f.out_amt, f.to_acct,
       f.in_key, f.in_ts, f.in_amt, f.lag_s
FROM fit f
JOIN rem r ON r.in_key = f.in_key
WHERE f.cum <= r.remaining;

-- @@SETTLE
UPDATE rem
SET remaining = in_amt - COALESCE(
    (SELECT sum(a.out_amt) FROM alloc_pair a WHERE a.in_key = rem.in_key), 0);

CREATE OR REPLACE TEMP TABLE allocated_out AS
SELECT DISTINCT out_key FROM alloc_pair;

-- @@AUDIT
-- Must be all zeros once the loop has converged.
SELECT
    (SELECT count(*) FROM (
        SELECT out_key FROM alloc_pair GROUP BY out_key HAVING count(*) > 1))
        AS outflows_allocated_twice,
    (SELECT count(*) FROM rem WHERE remaining < 0)
        AS inflows_overdrawn,
    (SELECT count(*) FROM cand c
      JOIN rem r ON r.in_key = c.in_key
      WHERE r.remaining >= c.out_amt
        AND NOT EXISTS (SELECT 1 FROM allocated_out ao WHERE ao.out_key = c.out_key))
        AS outflows_still_placeable;
