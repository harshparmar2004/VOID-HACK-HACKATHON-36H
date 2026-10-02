-- engine/sql/pass2.sql
-- Pass-2 scoring: relational features, then role scores and the role decision
-- (PROJECT_CONTEXT.md Section 4.3b, rules from Section 4.6).
--
--   score_pass1 + tx + layer_links  ->  rel          (@@RELATIONS)
--   features + rel                  ->  features_p2  (@@SOURCE)
--   [engine/sql/scoring.sql runs again on features_p2 -> score_pass2]
--   score_pass2 + features_p2 + tx  ->  score_roles  (@@ROLES)
--
-- Everything relational is read from PASS-1 scores and from layer_links, never
-- from scores already written by an earlier pass-2 run, so rerunning pass 2
-- gives the same numbers.
--
-- No ORDER BY, window function or tie-break on tx_key; no ground-truth label,
-- account-number range, IP prefix or device-count fingerprint; no hop number
-- (guardrail 11) -- a role needs its own behaviour AND a proven layer link.
--
-- This file is a string.Template split on its "-- @@SECTION" markers by
-- engine/scoring.py. Placeholders (all from the ACTIVE profile):
--   $$sink_link_types   quoted link types that count for the sink override
--   $$l1_expr $$l2_expr $$l3_expr $$victim_expr   0-100 role score expressions
--   $$role_threshold    roles.role_threshold
--   $$tie_margin        roles.tie_margin
--   $$victim_threshold  roles.victim_threshold
--   $$requires_link     roles.requires_confirming_link (TRUE / FALSE)
--   $$unclassified      roles.unclassified_role
-- The two bound parameters (?) in @@RELATIONS are both the profile_id.

-- @@RELATIONS
CREATE OR REPLACE TEMP TABLE rel AS
WITH
-- Account-centric long form: one row per (account, transaction, direction).
e AS (
    SELECT src AS acct, dst AS cp, amount_paise, TRUE  AS is_out FROM tx
    UNION ALL
    SELECT dst AS acct, src AS cp, amount_paise, FALSE AS is_out FROM tx
),
-- neighbour_risk: amount-weighted mean PASS-1 Final Index of the accounts this
-- account trades with, both directions, 0-100. Pass-1 scores only -- an
-- account's own pass-2 score never feeds back into its neighbours.
nr AS (
    SELECT e.acct,
           sum(e.amount_paise * s.final_index) / sum(e.amount_paise) AS neighbour_risk,
           sum(e.amount_paise) FILTER (WHERE NOT e.is_out) AS in_total,
           sum(e.amount_paise) FILTER (WHERE e.is_out)     AS out_total
    FROM e
    JOIN score_pass1 s ON s.acct_id = e.cp
    GROUP BY e.acct
),
-- Money arriving / leaving through PROVEN layer links, by the candidate role
-- at the other end.
li AS (
    SELECT to_acct AS acct,
           sum(amount_paise) FILTER (WHERE from_role = 'VICTIM') AS in_victim_amt,
           sum(amount_paise) FILTER (WHERE from_role = 'L1')     AS in_l1_amt,
           sum(amount_paise) FILTER (WHERE from_role = 'L2')     AS in_l2_amt,
           sum(amount_paise) FILTER (WHERE link_type IN ($sink_link_types)) AS in_sink_amt,
           bool_or(link_type = 'VICTIM_L1') AS in_victim_l1,
           bool_or(link_type = 'L1_L2')     AS in_l1_l2,
           bool_or(link_type = 'L2_L2')     AS in_l2_l2,
           bool_or(link_type = 'L2_L3')     AS in_l2_l3
    FROM layer_links WHERE profile_id = ?
    GROUP BY to_acct
),
lo AS (
    SELECT from_acct AS acct,
           sum(amount_paise) FILTER (WHERE to_role = 'L1') AS out_l1_amt,
           sum(amount_paise) FILTER (WHERE to_role = 'L2') AS out_l2_amt,
           sum(amount_paise) FILTER (WHERE to_role = 'L3') AS out_l3_amt,
           bool_or(link_type = 'VICTIM_L1') AS out_victim_l1,
           bool_or(link_type = 'L1_L2')     AS out_l1_l2,
           bool_or(link_type = 'L2_L2')     AS out_l2_l2,
           bool_or(link_type = 'L2_L3')     AS out_l2_l3
    FROM layer_links WHERE profile_id = ?
    GROUP BY from_acct
)
SELECT
    nr.acct AS acct_id,
    nr.neighbour_risk,
    -- NULL = not applicable (Section 4.6): an account that never receives has
    -- no upstream at all. An account that receives but through no layer link
    -- has a measured 0.
    CASE WHEN nr.in_total > 0
         THEN coalesce(li.in_l1_amt, 0)::DOUBLE / nr.in_total END   AS upstream_l1_share,
    CASE WHEN nr.in_total > 0
         THEN coalesce(li.in_l2_amt, 0)::DOUBLE / nr.in_total END   AS upstream_l2_share,
    CASE WHEN nr.in_total > 0
         THEN coalesce(li.in_sink_amt, 0)::DOUBLE / nr.in_total END AS linked_sink_share,
    -- Role shares of the linked counterparties, as a share of ALL money in /
    -- out. NULL when the account has no layer link in that direction.
    CASE WHEN li.acct IS NOT NULL THEN json_object(
        'VICTIM', coalesce(li.in_victim_amt, 0)::DOUBLE / nr.in_total,
        'L1',     coalesce(li.in_l1_amt, 0)::DOUBLE / nr.in_total,
        'L2',     coalesce(li.in_l2_amt, 0)::DOUBLE / nr.in_total) END AS upstream_role_share,
    CASE WHEN lo.acct IS NOT NULL THEN json_object(
        'L1', coalesce(lo.out_l1_amt, 0)::DOUBLE / nr.out_total,
        'L2', coalesce(lo.out_l2_amt, 0)::DOUBLE / nr.out_total,
        'L3', coalesce(lo.out_l3_amt, 0)::DOUBLE / nr.out_total) END  AS downstream_role_share,
    coalesce(li.in_victim_l1, FALSE)  AS in_victim_l1,
    coalesce(li.in_l1_l2, FALSE)      AS in_l1_l2,
    coalesce(li.in_l2_l2, FALSE)      AS in_l2_l2,
    coalesce(li.in_l2_l3, FALSE)      AS in_l2_l3,
    coalesce(lo.out_victim_l1, FALSE) AS out_victim_l1,
    coalesce(lo.out_l1_l2, FALSE)     AS out_l1_l2,
    coalesce(lo.out_l2_l2, FALSE)     AS out_l2_l2,
    coalesce(lo.out_l2_l3, FALSE)     AS out_l2_l3
FROM nr
LEFT JOIN li ON li.acct = nr.acct
LEFT JOIN lo ON lo.acct = nr.acct;

-- @@SOURCE
-- `features` with its three pass-2 placeholders filled, plus the link columns.
-- REPLACE (not a join on the stored columns) so the result is the same whether
-- or not an earlier run already wrote these values into `features`.
CREATE OR REPLACE TEMP TABLE features_p2 AS
SELECT f.* REPLACE (r.neighbour_risk    AS neighbour_risk,
                    r.upstream_l1_share AS upstream_l1_share,
                    r.upstream_l2_share AS upstream_l2_share),
       r.linked_sink_share,
       r.upstream_role_share, r.downstream_role_share,
       coalesce(r.in_victim_l1, FALSE)  AS in_victim_l1,
       coalesce(r.in_l1_l2, FALSE)      AS in_l1_l2,
       coalesce(r.in_l2_l2, FALSE)      AS in_l2_l2,
       coalesce(r.in_l2_l3, FALSE)      AS in_l2_l3,
       coalesce(r.out_victim_l1, FALSE) AS out_victim_l1,
       coalesce(r.out_l1_l2, FALSE)     AS out_l1_l2,
       coalesce(r.out_l2_l2, FALSE)     AS out_l2_l2,
       coalesce(r.out_l2_l3, FALSE)     AS out_l2_l3
FROM features f
LEFT JOIN rel r ON r.acct_id = f.acct_id;

-- @@ROLES
CREATE OR REPLACE TEMP TABLE score_roles AS
WITH base AS (
    SELECT *
    FROM score_pass2 s
    JOIN features_p2 f USING (acct_id)
),
-- Layer role scores: FLAGGED accounts only (Section 4.3b). They decide WHICH
-- layer and never change the flag.
rs AS (
    SELECT *,
           CASE WHEN is_flagged THEN $l1_expr END AS l1_score,
           CASE WHEN is_flagged THEN $l2_expr END AS l2_score,
           CASE WHEN is_flagged THEN $l3_expr END AS l3_score
    FROM base
),
-- Share of each account's outgoing money paid to an account whose L1 role
-- score reaches the role threshold ("payee has high L1 score").
payee AS (
    SELECT x.src AS acct_id,
           coalesce(sum(x.amount_paise) FILTER (WHERE r.l1_score >= $role_threshold), 0)::DOUBLE
               / sum(x.amount_paise) AS payee_l1_share
    FROM tx x
    JOIN rs r ON r.acct_id = x.dst
    GROUP BY x.src
),
-- Victim score: UNFLAGGED accounts only. VICTIM is a role, not a mule band.
vs AS (
    SELECT rs.*,
           CASE WHEN NOT rs.is_flagged THEN $victim_expr END AS victim_score
    FROM rs
    LEFT JOIN payee p ON p.acct_id = rs.acct_id
),
d AS (
    SELECT *,
           greatest(l1_score, l2_score, l3_score) AS top_score,
           -- the middle of three = the runner-up
           l1_score + l2_score + l3_score
               - greatest(l1_score, l2_score, l3_score)
               - least(l1_score, l2_score, l3_score)  AS second_score,
           CASE WHEN l1_score >= l2_score AND l1_score >= l3_score THEN 'L1'
                WHEN l2_score >= l3_score THEN 'L2'
                ELSE 'L3' END AS top_role
    FROM vs
),
-- A confirming link = a proven transfer to the layer above or below.
c AS (
    SELECT *,
           CASE top_role
               WHEN 'L1' THEN (in_victim_l1 OR out_l1_l2)
               WHEN 'L2' THEN (in_l1_l2 OR in_l2_l2 OR out_l2_l2 OR out_l2_l3)
               WHEN 'L3' THEN in_l2_l3
           END AS has_link,
           (top_score - second_score <= $tie_margin) AS is_tie
    FROM d
),
-- Role decision (Section 4.3b steps 4-5).
r AS (
    SELECT *,
           CASE WHEN is_flagged THEN
                    CASE WHEN top_score >= $role_threshold
                              AND NOT is_tie
                              AND (has_link OR NOT $requires_link)
                         THEN top_role
                         ELSE '$unclassified' END
                WHEN victim_score >= $victim_threshold THEN 'VICTIM'
           END AS role
    FROM c
),
z AS (
    SELECT *,
           CASE WHEN role IN ('L1', 'L2', 'L3') THEN has_link
                WHEN role = 'VICTIM'            THEN out_victim_l1
                WHEN role IS NOT NULL           THEN FALSE
           END AS role_confirmed,
           -- Every role still in play, best first: at/above the threshold, or
           -- within the tie margin of the best. Kept for display when the
           -- layer could not be decided.
           CASE WHEN is_flagged THEN
               [x.r FOR x IN list_reverse_sort([
                    {'s': l1_score, 'r': 'L1'},
                    {'s': l2_score, 'r': 'L2'},
                    {'s': l3_score, 'r': 'L3'}])
                IF x.s >= $role_threshold OR x.s >= top_score - $tie_margin]
           END AS candidate_roles
    FROM r
)
SELECT
    acct_id,
    mp1, mp2, mp3, mp4, mp5, mp6, mp7, mp8,
    t1, t2, t3, t4, t5, t6, t7,
    mule_index, trust_index, final_index, band, is_flagged, override_applied,
    l1_score, l2_score, l3_score, victim_score,
    role, role_confirmed, candidate_roles,
    upstream_role_share, downstream_role_share,
    param_points,
    list_concat(reasons, list_filter([
        CASE
            WHEN role = '$unclassified' THEN
                printf('Flagged as a mule but the layer is not decided (L1 %.0f, L2 %.0f, L3 %.0f): %s',
                       l1_score, l2_score, l3_score,
                       CASE WHEN top_score < $role_threshold
                                THEN 'no role score reaches the threshold'
                            WHEN is_tie
                                THEN 'the two best role scores are too close to call'
                            ELSE 'no proven layer link confirms the best role' END)
            WHEN role = 'VICTIM' THEN
                printf('Likely victim, not a mule (victim score %.0f): a send-only payer of a large amount%s',
                       victim_score,
                       CASE WHEN role_confirmed
                            THEN ', with a proven payment into a first-layer mule account'
                            ELSE '' END)
            WHEN role IS NOT NULL THEN
                printf('Role %s (L1 %.0f, L2 %.0f, L3 %.0f), %s',
                       role, l1_score, l2_score, l3_score,
                       CASE WHEN role_confirmed
                            THEN 'confirmed by a proven transfer to the layer above or below'
                            ELSE 'not confirmed by a layer link' END)
        END
    ], x -> x IS NOT NULL)) AS reasons,
    n_half, override_hit, sink_hit, neighbour_risk
FROM z;
