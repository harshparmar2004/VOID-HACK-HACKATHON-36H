-- engine/sql/features.sql
-- Per-account raw measurements (PROJECT_CONTEXT.md Section 9 table 5,
-- definitions fixed per Section 4.6).
--
-- One row per acct_id, built from tx, accounts and the episode temp tables
-- (ep_inflow, ep_window, ep_out) that engine/sql/features_episode.sql fills.
-- No ground-truth file, no
-- account-number ranges, no device-count fingerprints (Section 3b LEAKAGE).
-- Joins use tx_key, never tx_id (guardrail 10).
--
-- NULL means NOT APPLICABLE, never 0 (Section 4.6): send-only accounts have no
-- inflow features, receive-only accounts have no outflow features, and flow
-- features are NULL when no inflow was ever forwarded. Scoring gives a NULL
-- feature 0 points and does not count it toward the two-signal rule.
--
-- This file is a string.Template: $$name placeholders are filled by
-- engine/features.py from the ACTIVE scoring profile, so no window, category
-- list or cut-off is hard-coded here (Section 8 rule 5, Section 4.6).
--
-- Placeholders:
--   $$single_max_s        pass-through window for a SINGLE forward, seconds
--   $$split_min_s         lower bound of the SPLIT-forward window, seconds
--   $$split_max_s         upper bound of the SPLIT-forward window, seconds
--   $$cashout_list        quoted narration categories, e.g. 'P2A', 'WALLET_LOAD'
--   $$victim_max_out      max outflows for a sender to count as victim-like
--   $$recurring_min_days  distinct days before a sender counts as recurring
--   $$odd_hour_from       odd-hour window start hour, inclusive
--   $$odd_hour_to         odd-hour window end hour, exclusive
--   $$round_unit_paise    "round amount" unit for structuring_share

CREATE OR REPLACE TABLE features AS

WITH edges AS (
    -- One row per transaction, plus the derived per-edge facts.
    SELECT
        tx_key, src, dst, amount_paise, ts, ts_sec, device, ip,
        is_foreign_ip, is_reserved_ip,
        -- Layering-edge combo, counted as ONE signal, never as three proofs:
        -- headless device AND foreign IP AND a cash-out narration category.
        -- Category = 2nd narration segment, with any trailing #n removed so
        -- the 2-part form RAIL/CAT#n behaves like RAIL/CAT/DETAIL#n.
        (is_headless
         AND is_foreign_ip
         AND split_part(split_part(narration, '/', 2), '#', 1)
             IN ($cashout_list)) AS is_layering_edge
    FROM tx
),

-- Account-centric long form: one row per (account, transaction, direction).
acct_edge AS (
    SELECT dst AS acct, 'in'  AS dir, tx_key, ts, ts_sec, amount_paise,
           is_layering_edge, device, ip, src AS cp
    FROM edges
    UNION ALL
    SELECT src AS acct, 'out' AS dir, tx_key, ts, ts_sec, amount_paise,
           is_layering_edge, device, ip, dst AS cp
    FROM edges
),

-- ---------------------------------------------------------------- (a) counts
base AS (
    SELECT
        acct,
        count(*)                                   AS tx_count,
        count(*) FILTER (WHERE dir = 'in')         AS n_in,
        count(*) FILTER (WHERE dir = 'out')        AS n_out,
        count(DISTINCT CAST(ts AS DATE))           AS days_active,
        sum(amount_paise) FILTER (WHERE dir = 'in')  AS in_amt_total,
        sum(amount_paise) FILTER (WHERE dir = 'out') AS out_amt_total,
        median(amount_paise)                       AS median_amount_paise,
        count(DISTINCT amount_paise)::DOUBLE / count(*) AS amount_diversity,
        avg(CASE WHEN hour(ts) >= $odd_hour_from
                  AND hour(ts) <  $odd_hour_to THEN 1.0 ELSE 0.0 END)
                                                   AS odd_hour_share,
        count(*) FILTER (WHERE dir = 'out' AND is_layering_edge) AS n_out_flagged,
        count(*) FILTER (WHERE dir = 'in'  AND is_layering_edge) AS n_in_flagged
    FROM acct_edge
    GROUP BY acct
),

-- ------------------------------------------------------------------ (b) flow
-- Built from the EPISODE tables that engine/sql/features_episode.sql fills
-- (Section 4.6). An outflow belongs to an episode AS A WHOLE, never to one
-- inflow, so nothing has to be paired and nothing is dropped when a mule
-- forwards its inflows out of order.
--
-- There is deliberately NO window filter here. Every lag in ep_out is already
-- inside the forwarding window by construction (see features_episode.sql), and
-- the filter this replaces -- "a multi-outflow inflow only counts if its lag is
-- inside the 3-15 min SPLIT window" -- is exactly what used to drop the
-- out-of-order forwards that 4.6 was written to keep. Whether an episode reads
-- as a split or a single forward is a SCORING question: scoring.py applies the
-- profile's split/single windows to split_count_median and
-- forward_lag_median_s. The features table only measures.
ep_fwd AS (
    SELECT acct, ep,
           sum(out_amt)            AS out_total,
           count(DISTINCT to_acct) AS n_receivers,
           median(lag_s)           AS lag_med_s
    FROM ep_out
    GROUP BY acct, ep
),
ep_flow AS (
    SELECT
        w.acct,
        -- out / in per EPISODE, never above 1.0 (Section 4.6, guardrail 16).
        -- An episode may legitimately send out more than arrived in it (prior
        -- balance); the cap is what keeps a commission ratio interpretable.
        least(1.0, f.out_total::DOUBLE / nullif(w.in_total, 0)) AS ep_ratio,
        least(w.in_total, f.out_total)                          AS ep_fwd_amt,
        -- Distinct receivers per episode / inflows in it, rounded (4.6). With
        -- one inflow in the episode this is just that inflow's receiver count,
        -- which is the "or per inflow" case in the rule.
        round(f.n_receivers::DOUBLE / w.n_inflows)              AS ep_split_count,
        f.lag_med_s
    FROM ep_window w
    JOIN ep_fwd f ON f.acct = w.acct AND f.ep = w.ep
),
flow AS (
    SELECT
        acct,
        sum(ep_fwd_amt)        AS fwd_amt_total,
        median(ep_split_count) AS split_count_median,
        median(ep_ratio)       AS commission_ratio_median,
        median(lag_med_s)      AS forward_lag_median_s
    FROM ep_flow
    GROUP BY acct
),

-- ------------------------------------------------------ (c) flags & amounts
-- Hold time: per INFLOW (the money that arrived), the wait until the first
-- outflow at or after it INSIDE ITS EPISODE. Taken from the episode rather than
-- from a pairing, so an out-of-order forward still stops the clock. An inflow
-- with no outflow after it in its episode contributes NOTHING -- no end-of-data
-- timestamp is imputed (Section 4.6) -- so an account that never forwards gets
-- NULL and a receive-only sink can never earn balance-retention trust.
inflow_hold AS (
    SELECT i.acct, i.in_key,
           (min(o.out_ts) - i.in_ts) / 3600.0 AS hold_hours
    FROM ep_inflow i
    JOIN ep_out o
      ON o.acct = i.acct AND o.ep = i.ep AND o.out_ts >= i.in_ts
    GROUP BY i.acct, i.in_key, i.in_ts
),
hold AS (
    SELECT acct, median(hold_hours) AS median_hold_hours
    FROM inflow_hold
    GROUP BY acct
),
-- Reciprocity: share of counterparties that both sent to and received from
-- this account. Kept as a measurement even though its gate is closed on this
-- dataset (normal-population median 0) -- the gate lives in the profile.
cp_dir AS (
    SELECT acct, cp,
           max(CASE WHEN dir = 'out' THEN 1 ELSE 0 END) AS is_out,
           max(CASE WHEN dir = 'in'  THEN 1 ELSE 0 END) AS is_in
    FROM acct_edge
    GROUP BY acct, cp
),
recip AS (
    SELECT acct,
           sum(is_out * is_in)::DOUBLE / count(*) AS reciprocity
    FROM cp_dir
    GROUP BY acct
),
-- Recurring sender: seen on at least $recurring_min_days DISTINCT DAYS
-- (Section 4.6 -- days, not transaction count).
in_by_cp AS (
    SELECT acct, cp,
           count(*)                         AS n_from_cp,
           count(DISTINCT CAST(ts AS DATE)) AS n_days_from_cp
    FROM acct_edge WHERE dir = 'in'
    GROUP BY acct, cp
),
recurring AS (
    SELECT acct,
           sum(CASE WHEN n_days_from_cp >= $recurring_min_days
                    THEN n_from_cp ELSE 0 END)::DOUBLE
           / sum(n_from_cp) AS recurring_sender_share
    FROM in_by_cp
    GROUP BY acct
),
-- device_consistency is the spec BOOLEAN (Section 4.6): 1 only if the account
-- sends from a single device family AND only from domestic IPs. A modal-share
-- ratio is deliberately NOT used -- per-account device ratios just re-express
-- the generator's even device thirds, which is a forbidden fingerprint.
dev_flags AS (
    SELECT src AS acct,
           count(DISTINCT device)            AS n_devices,
           max(CAST(is_foreign_ip AS INT))   AS any_foreign_ip,
           max(CAST(is_reserved_ip AS INT))  AS any_reserved_ip
    FROM edges
    GROUP BY src
),
devc AS (
    SELECT acct,
           CAST(CASE WHEN n_devices = 1
                      AND any_foreign_ip = 0
                      AND any_reserved_ip = 0 THEN 1 ELSE 0 END AS DOUBLE)
               AS device_consistency
    FROM dev_flags
),

-- --------------------------------------------------- (d) victim-like inflow
-- Victim-like is a STRUCTURAL judgement, never a label: a sender that only
-- ever sends (no inflow at all) and does so very few times. The cut-off comes
-- from the profile's feature_rules.
victim_like AS (
    SELECT acct FROM base
    WHERE n_in = 0 AND n_out > 0 AND n_out <= $victim_max_out
),
vic AS (
    SELECT
        e.acct,
        sum(CASE WHEN v.acct IS NOT NULL THEN e.amount_paise ELSE 0 END)::DOUBLE
        / nullif(sum(e.amount_paise), 0) AS victim_inflow_share
    FROM acct_edge e
    LEFT JOIN victim_like v ON v.acct = e.cp
    WHERE e.dir = 'in'
    GROUP BY e.acct
),

-- ------------------------------------------------- (e) zero-weight features
-- IP describes the sender, so these are measured over outgoing edges.
ip_senders AS (
    SELECT ip, count(DISTINCT src) AS n_senders FROM edges GROUP BY ip
),
ip_cluster AS (
    SELECT e.src AS acct, max(s.n_senders) AS shared_ip_cluster_size
    FROM edges e JOIN ip_senders s ON s.ip = e.ip
    GROUP BY e.src
),
churn AS (
    SELECT src AS acct,
           count(DISTINCT ip)::DOUBLE / count(*) AS ip_churn
    FROM edges GROUP BY src
),
-- Most distinct senders arriving inside one window-sized bucket.
fanin_bucket AS (
    SELECT dst AS acct,
           CAST(floor(ts_sec / $single_max_s) AS BIGINT) AS bucket,
           count(DISTINCT src) AS n_senders
    FROM edges
    GROUP BY 1, 2
),
burst AS (
    SELECT acct, max(n_senders) AS burst_fan_in FROM fanin_bucket GROUP BY acct
),
struct_share AS (
    SELECT acct,
           avg(CASE WHEN amount_paise % $round_unit_paise = 0 THEN 1.0 ELSE 0.0 END)
               AS structuring_share
    FROM acct_edge WHERE dir = 'out'
    GROUP BY acct
),
out_gaps AS (
    SELECT acct,
           ts_sec - lag(ts_sec) OVER (PARTITION BY acct ORDER BY ts_sec, tx_key) AS gap
    FROM acct_edge WHERE dir = 'out'
),
timing AS (
    -- 1 = perfectly regular spacing, 0 = highly irregular. Needs >= 2 gaps.
    SELECT acct,
           CASE WHEN count(gap) >= 2 AND avg(gap) > 0
                THEN greatest(0.0, least(1.0, 1.0 - stddev_samp(gap) / avg(gap)))
           END AS timing_regularity
    FROM out_gaps WHERE gap IS NOT NULL
    GROUP BY acct
)

SELECT
    a.acct_id,

    -- (a) counts -----------------------------------------------------------
    b.tx_count,
    b.n_in,
    b.n_out,
    (b.n_in = 0 AND b.n_out > 0) AS is_send_only,
    (b.n_out = 0 AND b.n_in > 0) AS is_receive_only,
    b.days_active,

    -- (b) flow -------------------------------------------------------------
    -- 0.0 (not NULL) when inflows exist but nothing was passed through: that
    -- is a measured zero. NULL when the account has no inflow at all, because
    -- there is no inflow to pass through (Section 4.6).
    -- The no-inflow case is handled by an explicit CASE, never by least():
    -- DuckDB's least() IGNORES NULL arguments, so least(1.0, NULL) is 1.0,
    -- which would hand every send-only account a perfect pass-through score.
    CASE WHEN coalesce(b.in_amt_total, 0) = 0 THEN NULL
         ELSE least(1.0, coalesce(f.fwd_amt_total, 0)::DOUBLE / b.in_amt_total)
    END                                            AS pass_through_share,
    -- NULL when the account has no window-valid forward: undefined, not zero.
    f.forward_lag_median_s,
    f.split_count_median,
    f.commission_ratio_median,

    -- (c) flags and amounts ------------------------------------------------
    CASE WHEN b.n_out > 0
         THEN b.n_out_flagged::DOUBLE / b.n_out END AS flagged_out_share,
    CASE WHEN b.n_in > 0
         THEN b.n_in_flagged::DOUBLE / b.n_in  END AS flagged_in_share,
    b.median_amount_paise::DOUBLE
        / (SELECT median(amount_paise) FROM tx)     AS amount_vs_population,
    b.amount_diversity,
    r.reciprocity,
    h.median_hold_hours,
    rc.recurring_sender_share,
    dc.device_consistency,

    -- (d) victim-sourced inflow --------------------------------------------
    v.victim_inflow_share,

    -- (e) zero-weight in v1-verified, computed anyway so the UI can enable --
    bf.burst_fan_in,
    ic.shared_ip_cluster_size,
    ch.ip_churn,
    ss.structuring_share,
    tg.timing_regularity,
    b.odd_hour_share,
    -- TODO(graph.py): directed-cycle membership needs igraph on a candidate
    -- subgraph; left NULL until then rather than defaulted to false.
    CAST(NULL AS BOOLEAN)  AS in_cycle,

    -- pass-2 placeholders: these depend on scores, which do not exist yet.
    CAST(NULL AS DOUBLE)   AS upstream_l1_share,
    CAST(NULL AS DOUBLE)   AS upstream_l2_share,
    CAST(NULL AS DOUBLE)   AS neighbour_risk

FROM accounts a
LEFT JOIN base         b  ON b.acct  = a.acct_id
LEFT JOIN flow         f  ON f.acct  = a.acct_id
LEFT JOIN recip        r  ON r.acct  = a.acct_id
LEFT JOIN hold         h  ON h.acct  = a.acct_id
LEFT JOIN recurring    rc ON rc.acct = a.acct_id
LEFT JOIN devc         dc ON dc.acct = a.acct_id
LEFT JOIN vic          v  ON v.acct  = a.acct_id
LEFT JOIN burst        bf ON bf.acct = a.acct_id
LEFT JOIN ip_cluster   ic ON ic.acct = a.acct_id
LEFT JOIN churn        ch ON ch.acct = a.acct_id
LEFT JOIN struct_share ss ON ss.acct = a.acct_id
LEFT JOIN timing       tg ON tg.acct = a.acct_id
