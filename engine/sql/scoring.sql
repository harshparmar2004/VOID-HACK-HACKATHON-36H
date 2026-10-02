-- engine/sql/scoring.sql
-- Mule / Trust / Final scoring (PROJECT_CONTEXT.md Sections 4.1, 4.2, 4.3, 4.6).
-- Run twice by engine/scoring.py with different placeholders:
--
--   pass 1:  features     -> score_pass1   (MP7, T5 not computed: NULL)
--   pass 2:  features_p2  -> score_pass2   (features + neighbour_risk and the
--                                           layer-link shares; every parameter)
--
-- One row per account. Every weight, threshold, window and band below arrives
-- through a $$placeholder that engine/scoring.py builds from the ACTIVE scoring
-- profile -- nothing is hard-coded here (Section 8 rule 5).
--
-- NULL handling (Section 4.6): a NULL feature is NOT APPLICABLE. It scores 0
-- points and never counts toward the two-signal rule. Every points expression
-- is a CASE whose comparisons are simply not true for NULL, so NULL falls to
-- the ELSE 0.0 branch -- no coalesce-to-zero of a MEASUREMENT happens anywhere.
--
-- A NULL in a points COLUMN means something different: the parameter is not
-- computed in this pass (in pass 1, MP7 and T5 need neighbour_risk). It adds
-- nothing to an index and is left NULL so "not yet" differs from "scored zero".
--
-- No ground-truth label, account-number range, tx_key order or device-count
-- fingerprint is read (guardrail 9, Section 4.6 "Forbidden").
--
-- Placeholders:
--   $$out_table        temp table to create (score_pass1 / score_pass2)
--   $$source           table the measurements are read from
--   $$sink_cond        link-confirmed sink override condition (FALSE in pass 1)
--   $$pop_columns      population medians used by ratio rules
--   $$point_columns    one "<expr> AS mp1 / t1 / zp1 ..." per parameter
--   $$mule_sum         sum of the pass-1 mule points, scaled to 0-100
--   $$trust_sum        sum of the pass-1 trust points, scaled to 0-100
--   $$half_count       number of two-signal parameters at half points or more
--   $$override_cond    the Section 4.3 pass-through override condition
--   $$discount         final.trust_discount_factor
--   $$floor            final.override.floor
--   $$flag_threshold   final.flag.threshold
--   $$min_half         final.flag.two_signal_rule.min_parameters_at_half
--   $$review_cond      final.review_rule as a condition
--   $$band_case        CASE expression over final.bands
--   $$param_points     json_object(...) of every parameter's points
--   $$reason_list      list of plain-English reason expressions (NULL = skip)

CREATE OR REPLACE TEMP TABLE $out_table AS
WITH pop AS (
    SELECT $pop_columns
    FROM $source
),
-- Points per parameter.
p AS (
    SELECT
        f.*,
        pop.*,
$point_columns
    FROM $source f
    CROSS JOIN pop
),
-- The two indices, the two-signal count and the override test.
q AS (
    SELECT
        *,
        $mule_sum  AS mule_index,
        $trust_sum AS trust_index,
        $half_count AS n_half,
        -- Two floors, same effect: the pass-through override (Section 4.3) and,
        -- in pass 2 only, the link-confirmed sink override (final.sink_override).
        coalesce($sink_cond, FALSE) AS sink_hit,
        (coalesce($override_cond, FALSE)
         OR coalesce($sink_cond, FALSE)) AS override_hit
    FROM p
),
-- Final = Mule x (1 - discount x Trust / 100)   (Section 4.3)
r AS (
    SELECT *,
           mule_index * (1.0 - $discount * trust_index / 100.0) AS final_raw
    FROM q
),
-- The override is a FLOOR: it lifts final_index, it never lowers it, and
-- override_applied is TRUE only when the floor actually changed the number.
s AS (
    SELECT *,
           CASE WHEN override_hit THEN greatest(final_raw, $floor)
                ELSE final_raw END                 AS final_index,
           (override_hit AND final_raw < $floor)   AS override_applied
    FROM r
),
-- Flag = Final at/above the threshold AND the two-signal rule. The override
-- does NOT bypass the two-signal rule.
t AS (
    SELECT *,
           (final_index >= $flag_threshold AND n_half >= $min_half) AS is_flagged
    FROM s
),
u AS (
    SELECT *,
           -- 'review' is a watch list, never a flag: the profile's review rule,
           -- plus any account whose Final reached the threshold on ONE signal
           -- only -- calling that 'suspected' while is_flagged is FALSE would
           -- contradict the flag.
           CASE WHEN NOT is_flagged
                     AND (($review_cond) OR final_index >= $flag_threshold)
                THEN 'review'
                ELSE $band_case
           END AS band
    FROM t
)
SELECT
    acct_id,
    mp1, mp2, mp3, mp4, mp5, mp6, mp7, mp8,
    t1, t2, t3, t4, t5, t6, t7,
    mule_index, trust_index, final_index, final_raw,
    band, is_flagged, override_applied, override_hit, sink_hit, n_half,
    CAST($param_points AS JSON) AS param_points,
    list_filter([
$reason_list
    ], x -> x IS NOT NULL) AS reasons
FROM u;
