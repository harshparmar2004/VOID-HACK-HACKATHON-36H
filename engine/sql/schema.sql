-- engine/sql/schema.sql
-- Fixed-schema tables for Operation "Abhedya-Chakra" (PROJECT_CONTEXT.md Section 9).
--
-- These tables are created empty and filled by later pipeline steps. The API
-- and UI depend on their columns, so they never change shape: every one uses
-- CREATE TABLE IF NOT EXISTS, so rerunning this file never destroys scoring
-- profiles, scores, cases or the bank directory.
--
-- scores, layer_links and rings are keyed by profile_id. scoring.py refills
-- them per profile with DELETE ... WHERE profile_id = ? then INSERT -- it must
-- never CREATE OR REPLACE them, which would drop the other profiles' rows.
--
-- The derived tables (rejects, accounts, tx, features) are NOT declared here:
-- they are built with CREATE OR REPLACE TABLE ... AS SELECT by the step that
-- owns them, so each step is safe to rerun.

-- 1. ingest_meta -- one row per load of the source CSV (append-only audit trail).
CREATE TABLE IF NOT EXISTS ingest_meta (
    load_id       INTEGER   PRIMARY KEY,
    file_name     VARCHAR   NOT NULL,
    file_sha256   VARCHAR   NOT NULL,
    rows_total    BIGINT    NOT NULL,
    rows_loaded   BIGINT    NOT NULL,
    rows_rejected BIGINT    NOT NULL,
    load_seconds  DOUBLE    NOT NULL,
    loaded_at     TIMESTAMP NOT NULL
);

-- 6. scoring_profiles -- one row per version of the weights/thresholds.
--    definition holds the full parameter list as JSON (seeded from engine/config.yaml).
--    Nothing in the scoring code may hard-code a weight or threshold.
CREATE TABLE IF NOT EXISTS scoring_profiles (
    profile_id VARCHAR   PRIMARY KEY,
    created_at TIMESTAMP NOT NULL,
    is_active  BOOLEAN   NOT NULL DEFAULT FALSE,
    is_locked  BOOLEAN   NOT NULL DEFAULT FALSE,
    definition JSON      NOT NULL
);

-- 7. scores -- one row per account per profile.
--    Four separate scores (Section 4.3b):
--      mule_index  -- does it behave like a mule?      (all accounts)
--      trust_index -- does it behave like a normal?    (all accounts)
--      final_index -- flag or not?                     (all accounts)
--      l1/l2/l3_score -- WHICH layer?                  (flagged accounts only)
--    final_index decides WHETHER; the role scores decide WHICH LAYER and never
--    change the flag. role stays NULL for accounts that are not flagged, so the
--    role CHECK must admit NULL. A role is only written once a confirming
--    layer_link exists; roles are never inferred from hop number (guardrail 11).
CREATE TABLE IF NOT EXISTS scores (
    acct_id    INTEGER NOT NULL,
    profile_id VARCHAR NOT NULL,

    -- Mule Index parameters M1..M10 (Section 4.1), each a 0..weight contribution.
    m1  DOUBLE,
    m2  DOUBLE,
    m3  DOUBLE,
    m4  DOUBLE,
    m5  DOUBLE,
    m6  DOUBLE,
    m7  DOUBLE,
    m8  DOUBLE,
    m9  DOUBLE,
    m10 DOUBLE,

    -- Trust Index parameters T1..T7 (Section 4.2).
    t1 DOUBLE,
    t2 DOUBLE,
    t3 DOUBLE,
    t4 DOUBLE,
    t5 DOUBLE,
    t6 DOUBLE,
    t7 DOUBLE,

    mule_index  DOUBLE,
    trust_index DOUBLE,
    final_index DOUBLE,
    band        VARCHAR,
    is_flagged  BOOLEAN,

    -- Layer role scores, 0-100 each; populated for flagged accounts only.
    l1_score DOUBLE,
    l2_score DOUBLE,
    l3_score DOUBLE,

    role            VARCHAR,
    role_confirmed  BOOLEAN,
    candidate_roles VARCHAR[],

    -- Pass-2 relational evidence: {"L1": 0.72, "L2": 0.28, ...} role shares of
    -- the account's confirmed upstream / downstream counterparties.
    upstream_role_share   JSON,
    downstream_role_share JSON,

    reasons VARCHAR[],
    ring_id INTEGER,

    PRIMARY KEY (acct_id, profile_id),

    -- NULL = not flagged, so it must pass. UNCLASSIFIED_MULE = flagged but the
    -- layer could not be confirmed (Section 4.3b steps 4-5).
    CONSTRAINT scores_role_valid
        CHECK (role IS NULL
               OR role IN ('L1', 'L2', 'L3', 'UNCLASSIFIED_MULE'))
);

-- 8. layer_links -- one row per PROVEN inter-layer transfer, per profile.
--    A layer link is a specific transaction that proves money moved from one
--    layer to the next: right direction (upper -> lower), right timing (after
--    money arrived at the sender, inside the pass-through window) and an amount
--    that fits within what arrived. These rows confirm roles, build the rings
--    and are what the trace follows first.
--    link_type is NOT NULL because a bare IN-list CHECK would otherwise let a
--    NULL through (SQL three-valued logic) and admit an untyped link.
CREATE TABLE IF NOT EXISTS layer_links (
    profile_id      VARCHAR NOT NULL,
    tx_id           VARCHAR NOT NULL,   -- ORIGINAL Transaction_ID (guardrail 10)
    from_acct       INTEGER,
    to_acct         INTEGER,
    from_role       VARCHAR,
    to_role         VARCHAR,
    link_type       VARCHAR NOT NULL,
    lag_seconds     INTEGER,            -- arrival at from_acct -> this transfer
    amount_paise    BIGINT,
    share_of_inflow DOUBLE,             -- fraction of the inflow being forwarded
    ring_id         INTEGER,

    PRIMARY KEY (profile_id, tx_id),

    CONSTRAINT layer_links_type_valid
        CHECK (link_type IN ('VICTIM_L1', 'L1_L2', 'L2_L2', 'L2_L3'))
);

-- 9. rings -- one row per ring per profile; rings are built from layer_links.
--    fingerprint = SHA-256 of the ring's sorted tx_ids, so the same evidence
--    always yields the same hash (Section 4.4); it is printed on notices.
CREATE TABLE IF NOT EXISTS rings (
    profile_id          VARCHAR NOT NULL,
    ring_id             INTEGER NOT NULL,
    size                INTEGER,
    l1_count            INTEGER,
    l2_count            INTEGER,
    l3_count            INTEGER,
    unclassified_count  INTEGER,
    victim_count        INTEGER,
    total_in_paise      BIGINT,
    holding_paise       BIGINT,
    first_ts            TIMESTAMP,
    last_ts             TIMESTAMP,
    patterns            VARCHAR[],   -- SCATTER_GATHER, FUNNEL, CYCLE, ...
    fingerprint         VARCHAR,

    PRIMARY KEY (profile_id, ring_id)
);

-- 10. cases -- one row per investigation (a set of victims and/or rings).
CREATE TABLE IF NOT EXISTS cases (
    case_id        VARCHAR   PRIMARY KEY,
    created_at     TIMESTAMP NOT NULL,
    profile_id     VARCHAR,
    dataset_sha256 VARCHAR,
    victim_accts   VARCHAR[],
    ring_ids       INTEGER[],
    status         VARCHAR
);

-- 11. case_outputs -- one row per generated document (FIR / diary / notice).
--     validated records whether the number-level validator passed.
CREATE TABLE IF NOT EXISTS case_outputs (
    case_id    VARCHAR   NOT NULL,
    doc_type   VARCHAR   NOT NULL,
    bank       VARCHAR,
    file_path  VARCHAR   NOT NULL,
    validated  BOOLEAN,
    created_at TIMESTAMP NOT NULL
);

-- 12. bank_directory -- one row per bank; bank_prefix is the IFSC first 4 chars.
--     Routes a freeze requisition to the right Nodal Officer.
CREATE TABLE IF NOT EXISTS bank_directory (
    bank_prefix        VARCHAR PRIMARY KEY,
    bank_name          VARCHAR NOT NULL,
    nodal_officer_title VARCHAR,
    address_block      VARCHAR
);
