-- engine/sql/features_episode.sql
-- Episode grouping for the features step (PROJECT_CONTEXT.md Section 4.6).
-- Replaces the earlier one-to-one inflow/outflow allocation.
--
-- WHY NOT PAIRING: mules forward out of order. Verified on this file, an L2
-- receives Rs 65,008 then Rs 38,052 and forwards 0.96 x 38,052 FIRST, then
-- 0.96 x 65,008. Any rule that charges one outflow against one inflow has to
-- pick a pairing, and every pairing drops one of those two forwards.
--
-- THE EPISODE RULE (4.6): nothing is paired.
--   * each inflow owns a forwarding window [in_ts, in_ts + $single_max_s];
--   * inflows whose windows OVERLAP form one EPISODE;
--   * every outflow inside the episode window belongs to the episode AS A
--     WHOLE -- an outflow may be covered by several inflows and is never
--     charged against any single one;
--   * pass_through_share and commission_ratio_median come from EPISODE TOTALS
--     (out / in per episode, capped at 1.0 -- guardrail 16);
--   * split_count = distinct receivers per episode / inflows in it, rounded.
--
-- What this buys:
--   * no outflow is dropped for want of an inflow "with room";
--   * no greedy order and no re-offer rounds, so no tie-break can change a
--     number -- nothing here depends on tx_key order or row adjacency, which
--     Section 4.6 forbids outright;
--   * three set-based passes, so no Python loop over transactions at all
--     (Section 8 rule 2) -- the previous rule needed a loop over rounds.
--
-- WINDOW ARITHMETIC. Episodes merge when the gap between consecutive inflows is
-- at most one window, so a merged episode spans [first_in_ts, last_in_ts + W].
-- The next episode only begins with an inflow later than last_in_ts + W, so
-- consecutive episodes are DISJOINT -- which is why an outflow can land in at
-- most one episode (no double counting). And for any outflow inside an episode
-- window the nearest preceding inflow is at most W earlier, so lag_s is always
-- within [0, W]: the forwarding-window test is met BY CONSTRUCTION rather than
-- by a filter that could drop a legitimate forward. @@AUDIT proves both.
--
-- ORDERING. Every window function below orders by TIME alone; no tx_key appears
-- in any ORDER BY. Rows sharing a timestamp are interchangeable: inside a tied
-- block only the first row can carry an episode break and the rest carry 0, so
-- the cumulative episode number is the same whichever tied row is taken first.
-- ASOF likewise returns the same in_ts and ep for either of two tied inflows.
-- No measurement here can change with row position.
--
-- This file is a string.Template split on its "-- @@SECTION" markers by
-- engine/features.py. Placeholder: $$single_max_s (forwarding window, seconds).

-- @@BUILD
-- 1. Inflows, numbered into episodes. A new episode starts when an inflow
--    arrives more than one forwarding window after the previous one.
CREATE OR REPLACE TEMP TABLE ep_inflow AS
WITH inflow AS (
    SELECT dst AS acct, tx_key AS in_key, ts_sec AS in_ts, amount_paise AS in_amt
    FROM tx
),
marked AS (
    SELECT acct, in_key, in_ts, in_amt,
           CASE WHEN lag(in_ts) OVER w IS NULL
                     OR in_ts - lag(in_ts) OVER w > $single_max_s
                THEN 1 ELSE 0 END AS is_break
    FROM inflow
    WINDOW w AS (PARTITION BY acct ORDER BY in_ts)
)
SELECT acct, in_key, in_ts, in_amt,
       sum(is_break) OVER (PARTITION BY acct ORDER BY in_ts
                           ROWS BETWEEN UNBOUNDED PRECEDING
                                    AND CURRENT ROW) AS ep
FROM marked;

-- 2. One row per episode: its window, its inflow count and its inflow total.
--    ep_end = last inflow + one window, per the arithmetic above.
CREATE OR REPLACE TEMP TABLE ep_window AS
SELECT acct, ep,
       min(in_ts)                 AS ep_start,
       max(in_ts)                 AS last_in_ts,
       max(in_ts) + $single_max_s AS ep_end,
       count(*)                   AS n_inflows,
       sum(in_amt)                AS in_total
FROM ep_inflow
GROUP BY acct, ep;

-- 3. Outflows attached to an episode. ASOF takes the nearest inflow at or
--    before the outflow; because episodes are disjoint that inflow always sits
--    in the episode the outflow falls in, so one ASOF yields both the episode
--    and the lag. A lag past the window means the outflow is beyond ep_end,
--    i.e. in no episode at all -- it is not forwarded money, and dropping it
--    costs nothing because no inflow was open when it left.
CREATE OR REPLACE TEMP TABLE ep_out AS
SELECT o.acct, i.ep, o.out_key, o.out_ts, o.out_amt, o.to_acct,
       CAST(o.out_ts - i.in_ts AS INTEGER) AS lag_s
FROM (
    SELECT src AS acct, tx_key AS out_key, ts_sec AS out_ts,
           amount_paise AS out_amt, dst AS to_acct
    FROM tx
) o
ASOF JOIN ep_inflow i
  ON i.acct = o.acct
 AND i.in_ts <= o.out_ts
WHERE o.out_ts - i.in_ts <= $single_max_s;

-- @@AUDIT
-- The first four columns must be 0 or the build aborts. The fifth is NOT an
-- error: an account may legitimately send more inside a window than arrived in
-- it (it had a prior balance), which is exactly why 4.6 caps the ratio at 1.0.
SELECT
    (SELECT count(*) FROM (
        SELECT out_key FROM ep_out GROUP BY out_key HAVING count(*) > 1))
        AS outflows_in_two_episodes,
    (SELECT count(*) FROM ep_out
      WHERE lag_s < 0 OR lag_s > $single_max_s)
        AS lags_outside_window,
    (SELECT count(*) FROM ep_inflow)
        - (SELECT coalesce(sum(n_inflows), 0) FROM ep_window)
        AS inflows_not_in_exactly_one_episode,
    (SELECT count(*) FROM (
        SELECT ep_end,
               lead(ep_start) OVER (PARTITION BY acct ORDER BY ep_start) AS next_start
        FROM ep_window)
      WHERE next_start IS NOT NULL AND next_start <= ep_end)
        AS overlapping_episodes,
    (SELECT count(*)
       FROM ep_window w
       JOIN (SELECT acct, ep, sum(out_amt) AS out_total
               FROM ep_out GROUP BY acct, ep) f
         ON f.acct = w.acct AND f.ep = w.ep
      WHERE f.out_total > w.in_total)
        AS episodes_out_over_in;
