-- engine/sql/links.sql
-- Layer links (PROJECT_CONTEXT.md Section 4.3b, rules from Section 4.6).
--
--   scores (pass 1) + features + episode tables + tx  ->  link_build (temp)
--
-- A layer link is ONE transaction that proves money moved from one layer to
-- the next. Three tests, all of them on time and amount:
--   direction  upper -> lower layer, read from the two candidate roles;
--   timing     the transfer leaves AFTER money arrived at the sender, inside
--              the sender's pass-through window;
--   amount     it fits within what arrived in that EPISODE.
--
-- EPISODES, NOT PAIRS (4.6). Mules forward out of order, so an outflow is never
-- charged against one chosen inflow. It belongs to its episode as a whole:
--   * timing holds if ANY inflow of the episode sits inside the window before
--     the transfer; lag_seconds is the SHORTEST such lag (the most recent
--     arrival that could have funded it);
--   * share_of_inflow = this transfer / the episode's inflow total.
--
-- ORDERING. No ORDER BY, no window function and no tie-break appears below.
-- tx_key is used only as the unique key of a transaction (join and primary
-- key) -- never its order or adjacency, which Section 4.6 forbids. Two inflows
-- sharing a timestamp give the same lag, so min() cannot depend on row order.
--
-- No ground-truth label, account-number range, IP prefix or device-count
-- fingerprint is read: candidate roles come from scores.is_flagged and the
-- behavioural columns of `features` alone.
--
-- This file is a string.Template split on its "-- @@SECTION" markers by
-- engine/links.py. Placeholders (all from the ACTIVE profile):
--   $$l1_receivers_min/max   receivers per inflow that read as a split forward
--   $$l2_receivers_min/max   receivers per inflow that read as a single forward
--   $$victim_max_out         max outflows for a sender to count as victim-like
--   $$split_min_s/max_s      pass-through window of a split forward, seconds
--   $$single_min_s/max_s     pass-through window of a single forward, seconds
-- The one bound parameter (?) in @@CANDIDATES is the profile_id.

-- @@CANDIDATES
-- Behaviour-only candidate role per account (Section 4.3b step 1). This is a
-- CANDIDATE, used to read the direction of a link -- the role itself is only
-- assigned in pass 2, from the links built here.
--   L3      never sends. A sink cannot earn the pass-through parameters, so it
--           is taken on structure whether or not pass 1 flagged it; it only
--           ever enters a link as the RECEIVER of a flagged account's forward.
--   L1/L2   flagged, and forwards as a split / as a single forward.
--   VICTIM  unflagged, send-only, very few payments (victim-like, 4.6).
CREATE OR REPLACE TEMP TABLE link_cand AS
SELECT
    f.acct_id,
    s.is_flagged,
    CASE
        WHEN f.is_receive_only THEN 'L3'
        WHEN s.is_flagged
             AND f.split_count_median BETWEEN $l1_receivers_min AND $l1_receivers_max
            THEN 'L1'
        WHEN s.is_flagged
             AND f.split_count_median BETWEEN $l2_receivers_min AND $l2_receivers_max
            THEN 'L2'
        WHEN s.is_flagged THEN 'UNCLASSIFIED_MULE'
        WHEN f.is_send_only AND f.n_out <= $victim_max_out THEN 'VICTIM'
    END AS cand
FROM features f
JOIN scores s ON s.acct_id = f.acct_id AND s.profile_id = ?;

-- @@LINKS
CREATE OR REPLACE TEMP TABLE link_build AS
WITH
-- Every forward of a flagged L1 / L2 candidate that falls inside one of its
-- episodes, with the pass-through window its candidate role is held to.
mule_out AS (
    SELECT o.acct, o.ep, o.out_key, o.out_ts, o.out_amt, o.to_acct,
           c.cand AS from_role,
           CASE c.cand WHEN 'L1' THEN $split_min_s ELSE $single_min_s END AS win_lo,
           CASE c.cand WHEN 'L1' THEN $split_max_s ELSE $single_max_s END AS win_hi
    FROM ep_out o
    JOIN link_cand c ON c.acct_id = o.acct
    WHERE c.is_flagged AND c.cand IN ('L1', 'L2')
),
-- TIMING: at least one inflow of the same episode arrived inside the window
-- before the transfer. An outflow with no such inflow gets no row -> no link.
timed AS (
    SELECT m.out_key,
           CAST(min(m.out_ts - i.in_ts) AS INTEGER) AS lag_s
    FROM mule_out m
    JOIN ep_inflow i
      ON i.acct = m.acct
     AND i.ep   = m.ep
     AND i.in_ts BETWEEN m.out_ts - m.win_hi AND m.out_ts - m.win_lo
    GROUP BY m.out_key
),
mule_links AS (
    SELECT m.out_key AS tx_key, m.acct AS from_acct, m.to_acct,
           m.from_role, r.cand AS to_role,
           -- DIRECTION: only upper -> lower pairs are link types. Anything else
           -- (L1 -> L3, L2 -> L1, ...) is not a layer link and is left out.
           CASE WHEN m.from_role = 'L1' AND r.cand = 'L2' THEN 'L1_L2'
                WHEN m.from_role = 'L2' AND r.cand = 'L2' THEN 'L2_L2'
                WHEN m.from_role = 'L2' AND r.cand = 'L3' THEN 'L2_L3'
           END AS link_type,
           t.lag_s AS lag_seconds,
           m.out_amt AS amount_paise,
           m.out_amt::DOUBLE / nullif(w.in_total, 0) AS share_of_inflow
    FROM mule_out m
    JOIN timed t      ON t.out_key = m.out_key
    JOIN ep_window w  ON w.acct = m.acct AND w.ep = m.ep
    JOIN link_cand r  ON r.acct_id = m.to_acct
    -- AMOUNT: the transfer fits within what arrived in the episode.
    WHERE m.out_amt <= w.in_total
      -- a flagged receiver, or a receive-only sink
      AND (r.is_flagged OR r.cand = 'L3')
),
-- Victim -> L1: a victim-like sender paying a flagged L1 candidate. A victim
-- has no inflow, so there is no arrival to measure a lag or a share against:
-- both stay NULL (not applicable), never 0.
victim_links AS (
    SELECT x.tx_key, x.src AS from_acct, x.dst AS to_acct,
           'VICTIM' AS from_role, 'L1' AS to_role, 'VICTIM_L1' AS link_type,
           CAST(NULL AS INTEGER) AS lag_seconds,
           x.amount_paise,
           CAST(NULL AS DOUBLE)  AS share_of_inflow
    FROM tx x
    JOIN link_cand v ON v.acct_id = x.src AND v.cand = 'VICTIM'
    JOIN link_cand r ON r.acct_id = x.dst AND r.cand = 'L1' AND r.is_flagged
)
SELECT l.tx_key, x.tx_id, l.from_acct, l.to_acct, l.from_role, l.to_role,
       l.link_type, l.lag_seconds, l.amount_paise, l.share_of_inflow
FROM (
    SELECT * FROM mule_links WHERE link_type IS NOT NULL
    UNION ALL
    SELECT * FROM victim_links
) l
JOIN tx x ON x.tx_key = l.tx_key;

-- @@PAIRS
-- Informational: every transaction between two candidates, by role pair, and
-- how many of them became links. Shows what the three tests left out.
SELECT coalesce(a.cand, '-') AS from_role, coalesce(b.cand, '-') AS to_role,
       count(*) AS n_tx, count(l.tx_key) AS n_links
FROM tx x
JOIN link_cand a ON a.acct_id = x.src AND a.cand IS NOT NULL
JOIN link_cand b ON b.acct_id = x.dst AND b.cand IS NOT NULL
LEFT JOIN link_build l ON l.tx_key = x.tx_key
GROUP BY 1, 2
ORDER BY 1, 2;

-- @@CHECK
-- Re-derives every mule link's timing straight from `tx`, without the episode
-- tables, and compares it with what was stored. All four columns must be 0.
WITH lk AS (
    SELECT l.tx_key, l.from_acct, l.lag_seconds, o.ts_sec AS out_ts,
           CASE l.from_role WHEN 'L1' THEN $split_min_s ELSE $single_min_s END AS win_lo,
           CASE l.from_role WHEN 'L1' THEN $split_max_s ELSE $single_max_s END AS win_hi
    FROM link_build l
    JOIN tx o ON o.tx_key = l.tx_key
    WHERE l.link_type <> 'VICTIM_L1'
),
re AS (
    SELECT lk.tx_key, min(lk.out_ts - i.ts_sec) AS lag_from_tx
    FROM lk
    JOIN tx i
      ON i.dst = lk.from_acct
     AND i.ts_sec BETWEEN lk.out_ts - lk.win_hi AND lk.out_ts - lk.win_lo
    GROUP BY lk.tx_key
)
SELECT
    count(*) FILTER (WHERE lk.lag_seconds IS NULL
                        OR lk.lag_seconds < lk.win_lo
                        OR lk.lag_seconds > lk.win_hi)          AS lag_outside_window,
    count(*) FILTER (WHERE re.lag_from_tx IS NULL)              AS no_arrival_in_window,
    count(*) FILTER (WHERE re.lag_from_tx <> lk.lag_seconds)    AS lag_differs_from_tx,
    (SELECT count(*) FROM link_build
      WHERE link_type <> 'VICTIM_L1'
        AND (share_of_inflow IS NULL OR share_of_inflow <= 0
             OR share_of_inflow > 1))                           AS share_out_of_range
FROM lk
LEFT JOIN re ON re.tx_key = lk.tx_key;
