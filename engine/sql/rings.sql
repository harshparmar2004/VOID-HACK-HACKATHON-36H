-- engine/sql/rings.sql
-- Rings = connected components of layer_links (PROJECT_CONTEXT.md Sections
-- 4.4b and 9). A ring is every account joined, directly or through other
-- accounts, by PROVEN layer links -- direction is ignored for membership.
--
--   layer_links + tx + scores  ->  ring_link, ring_edge, ring_comp
--                              ->  ring_member, ring_build  ->  rings
--                              ->  cell_reach, cell_link, cell_member,
--                                  cell_build  ->  cells, cell_members
--
-- The ring is the whole NETWORK (network_id = ring_id). A CELL is the working
-- unit inside it: one confirmed L1, every account downstream of it through
-- layer links (direction of the links, never a hop number), and the victims
-- that paid it. An account reached from several L1s is in each such cell.
--
-- Components are found by min-label propagation: every account starts as its
-- own label and repeatedly takes the smallest label among itself and its
-- neighbours. engine/rings.py runs @@STEP until nothing changes -- a loop over
-- ROUNDS (a handful), never over accounts or transactions (Section 8 rule 2).
--
-- tx_key: used as the unique key of a link and, sorted, as the INPUT of the
-- fingerprint hash (same evidence -> same hash). It is never used as an order
-- or adjacency signal, and ring membership does not depend on it at all.
-- The component label (smallest acct_id) is only a temporary name; ring_id is
-- ranked by money and time, with the label as a last tie-break that cannot
-- change which accounts are in which ring.
--
-- This file is a string.Template split on its "-- @@SECTION" markers.
-- Placeholders:
--   $$profile            the active profile_id, as a quoted SQL literal
--   $$scatter_min        rings.patterns.scatter_gather_min_branches
--   $$funnel_min         rings.patterns.funnel_min_mule_senders
--   $$cycle_accts        acct_ids that sit on a directed cycle (from rings.py)

-- @@LINKS
CREATE OR REPLACE TEMP TABLE ring_link AS
SELECT l.tx_key, l.from_acct, l.to_acct, l.from_role, l.to_role, l.link_type,
       l.amount_paise, x.ts
FROM layer_links l
JOIN tx x ON x.tx_key = l.tx_key
WHERE l.profile_id = $profile;

-- @@EDGES
-- Undirected, de-duplicated account pairs (both orientations).
CREATE OR REPLACE TEMP TABLE ring_edge AS
SELECT from_acct AS a, to_acct AS b FROM ring_link
UNION
SELECT to_acct AS a, from_acct AS b FROM ring_link;

-- @@INIT
CREATE OR REPLACE TEMP TABLE ring_comp AS
SELECT DISTINCT a AS acct, a AS label FROM ring_edge;

-- @@STEP
-- One round: each account takes the smallest label in its neighbourhood.
CREATE OR REPLACE TEMP TABLE ring_comp_next AS
SELECT c.acct, least(c.label, coalesce(min(n.label), c.label)) AS label
FROM ring_comp c
LEFT JOIN ring_edge e ON e.a = c.acct
LEFT JOIN ring_comp n ON n.acct = e.b
GROUP BY c.acct, c.label;

-- @@CHANGED
SELECT count(*)
FROM ring_comp_next n
JOIN ring_comp c ON c.acct = n.acct
WHERE n.label <> c.label;

-- @@MEMBERS
-- One row per linked account, shared by the rings and the cells.
CREATE OR REPLACE TEMP TABLE ring_member AS
WITH
-- A victim is a member that enters the ring only as the payer of a
-- Victim -> L1 link. It is counted apart from the ring's mule accounts.
victims AS (
    SELECT DISTINCT from_acct AS acct FROM ring_link WHERE from_role = 'VICTIM'
),
flow_in AS (
    SELECT to_acct AS acct, sum(amount_paise) AS in_amt FROM ring_link GROUP BY to_acct
),
flow_out AS (
    SELECT from_acct AS acct, sum(amount_paise) AS out_amt FROM ring_link GROUP BY from_acct
)
SELECT c.label, c.acct,
       (v.acct IS NOT NULL) AS is_victim,
       s.role,
       coalesce(s.role_confirmed, FALSE) AS role_confirmed,
       -- Holding = linked money that arrived and was not forwarded on. An
       -- L3 sink holds everything it received; an L1 / L2 holds its cut.
       greatest(coalesce(fi.in_amt, 0) - coalesce(fo.out_amt, 0), 0) AS holding
FROM ring_comp c
LEFT JOIN victims v   ON v.acct = c.acct
LEFT JOIN flow_in fi  ON fi.acct = c.acct
LEFT JOIN flow_out fo ON fo.acct = c.acct
LEFT JOIN scores s    ON s.acct_id = c.acct AND s.profile_id = $profile;

-- @@RINGS
CREATE OR REPLACE TEMP TABLE ring_build AS
WITH
member AS (
    SELECT * FROM ring_member
),
acct_stats AS (
    SELECT label,
           count(*) FILTER (WHERE NOT is_victim)                    AS size,
           count(*) FILTER (WHERE NOT is_victim AND role = 'L1')    AS l1_count,
           count(*) FILTER (WHERE NOT is_victim AND role = 'L2')    AS l2_count,
           count(*) FILTER (WHERE NOT is_victim AND role = 'L3')    AS l3_count,
           count(*) FILTER (WHERE is_victim)                        AS victim_count,
           coalesce(sum(holding) FILTER (WHERE NOT is_victim), 0)   AS holding_paise
    FROM member
    GROUP BY label
),
link_stats AS (
    SELECT c.label,
           count(*)                                                 AS n_links,
           coalesce(sum(l.amount_paise)
                    FILTER (WHERE l.link_type = 'VICTIM_L1'), 0)    AS total_in_paise,
           min(l.ts)                                                AS first_ts,
           max(l.ts)                                                AS last_ts,
           -- Sorting here only fixes the hash input; it is not a signal.
           sha256(string_agg(CAST(l.tx_key AS VARCHAR), ',' ORDER BY l.tx_key))
                                                                    AS fingerprint
    FROM ring_link l
    JOIN ring_comp c ON c.acct = l.from_acct
    GROUP BY c.label
),
-- SCATTER_GATHER: one account's forwards reconverge on the same account
-- through >= $scatter_min different intermediaries (second leg not earlier
-- than the first -- each leg is already inside its sender's window).
scatter AS (
    SELECT DISTINCT c.label
    FROM (
        SELECT l1.from_acct AS origin, l2.to_acct AS target
        FROM ring_link l1
        JOIN ring_link l2 ON l2.from_acct = l1.to_acct AND l2.ts >= l1.ts
        WHERE l1.link_type <> 'VICTIM_L1'
        GROUP BY l1.from_acct, l2.to_acct
        HAVING count(DISTINCT l1.to_acct) >= $scatter_min
    ) p
    JOIN ring_comp c ON c.acct = p.origin
),
-- FUNNEL: an account fed by >= $funnel_min different MULE senders. Victim
-- payments are L1 fan-in, a different thing, and are left out.
funnel AS (
    SELECT DISTINCT c.label
    FROM (
        SELECT to_acct
        FROM ring_link
        WHERE link_type <> 'VICTIM_L1'
        GROUP BY to_acct
        HAVING count(DISTINCT from_acct) >= $funnel_min
    ) p
    JOIN ring_comp c ON c.acct = p.to_acct
),
-- CYCLE: the ring contains an account on a directed cycle of links.
cyc AS (
    SELECT DISTINCT label FROM ring_comp WHERE acct IN ($cycle_accts)
)
SELECT
    CAST(row_number() OVER (
        ORDER BY ls.total_in_paise DESC, ls.first_ts, a.label) AS INTEGER) AS ring_id,
    a.label,
    CAST(a.size AS INTEGER)         AS size,
    CAST(a.l1_count AS INTEGER)     AS l1_count,
    CAST(a.l2_count AS INTEGER)     AS l2_count,
    CAST(a.l3_count AS INTEGER)     AS l3_count,
    -- every mule member without a decided layer: UNCLASSIFIED_MULE, or an
    -- account the links reached that the scores did not give a layer
    CAST(a.size - a.l1_count - a.l2_count - a.l3_count AS INTEGER) AS unclassified_count,
    CAST(a.victim_count AS INTEGER) AS victim_count,
    CAST(ls.total_in_paise AS BIGINT) AS total_in_paise,
    CAST(a.holding_paise AS BIGINT)   AS holding_paise,
    ls.first_ts, ls.last_ts,
    list_filter([
        CASE WHEN sc.label IS NOT NULL THEN 'SCATTER_GATHER' END,
        CASE WHEN fu.label IS NOT NULL THEN 'FUNNEL' END,
        CASE WHEN cy.label IS NOT NULL THEN 'CYCLE' END
    ], x -> x IS NOT NULL) AS patterns,
    ls.fingerprint,
    ls.n_links
FROM acct_stats a
JOIN link_stats ls   ON ls.label = a.label
LEFT JOIN scatter sc ON sc.label = a.label
LEFT JOIN funnel fu  ON fu.label = a.label
LEFT JOIN cyc cy     ON cy.label = a.label;

-- @@CELLS
-- Every account each confirmed L1 reaches by following layer links forward.
-- UNION (not UNION ALL) drops repeats, so a cycle of links cannot loop.
CREATE OR REPLACE TEMP TABLE cell_reach AS
WITH RECURSIVE reach(l1, acct) AS (
    SELECT acct, acct
    FROM ring_member
    WHERE role = 'L1' AND role_confirmed AND NOT is_victim
    UNION
    SELECT r.l1, l.to_acct
    FROM reach r
    JOIN ring_link l ON l.from_acct = r.acct AND l.link_type <> 'VICTIM_L1'
)
SELECT l1, acct FROM reach;

-- The cell's evidence: the victim payments into its L1, and every link sent
-- on by one of its accounts. A shared L2 forwards money from several L1s, and
-- all its forwards are in each cell it belongs to -- the links do not record
-- which inflow paid for which forward.
CREATE OR REPLACE TEMP TABLE cell_link AS
SELECT r.l1, l.tx_key, l.from_acct, l.to_acct, l.link_type, l.amount_paise, l.ts
FROM cell_reach r
JOIN ring_link l ON l.from_acct = r.acct AND l.link_type <> 'VICTIM_L1'
UNION ALL
SELECT l.to_acct AS l1, l.tx_key, l.from_acct, l.to_acct, l.link_type, l.amount_paise, l.ts
FROM ring_link l
WHERE l.link_type = 'VICTIM_L1'
  AND l.to_acct IN (SELECT l1 FROM cell_reach);

-- Members: the reached mule accounts, plus the victims that paid the L1.
-- holding is the account's own holding (same definition as the ring's).
CREATE OR REPLACE TEMP TABLE cell_member AS
SELECT r.l1, r.acct, FALSE AS is_victim, m.role, m.holding
FROM cell_reach r
JOIN ring_member m ON m.acct = r.acct
UNION ALL
SELECT DISTINCT l.l1, l.from_acct AS acct, TRUE AS is_victim, m.role, 0 AS holding
FROM cell_link l
JOIN ring_member m ON m.acct = l.from_acct
WHERE l.link_type = 'VICTIM_L1';

CREATE OR REPLACE TEMP TABLE cell_build AS
WITH
acct_stats AS (
    SELECT l1,
           count(*) FILTER (WHERE NOT is_victim)                    AS size,
           count(*) FILTER (WHERE NOT is_victim AND role = 'L1')    AS l1_count,
           count(*) FILTER (WHERE NOT is_victim AND role = 'L2')    AS l2_count,
           count(*) FILTER (WHERE NOT is_victim AND role = 'L3')    AS l3_count,
           count(*) FILTER (WHERE is_victim)                        AS victim_count,
           coalesce(sum(holding) FILTER (WHERE NOT is_victim), 0)   AS holding_paise
    FROM cell_member
    GROUP BY l1
),
link_stats AS (
    SELECT l1,
           count(*)                                                 AS n_links,
           coalesce(sum(amount_paise)
                    FILTER (WHERE link_type = 'VICTIM_L1'), 0)      AS total_in_paise,
           min(ts)                                                  AS first_ts,
           max(ts)                                                  AS last_ts,
           -- Sorting here only fixes the hash input; it is not a signal.
           sha256(string_agg(CAST(tx_key AS VARCHAR), ',' ORDER BY tx_key))
                                                                    AS fingerprint
    FROM cell_link
    GROUP BY l1
),
-- Same three patterns as the ring, on the cell's own links.
scatter AS (
    SELECT DISTINCT l1
    FROM (
        SELECT a.l1, a.from_acct AS origin, b.to_acct AS target
        FROM cell_link a
        JOIN cell_link b ON b.l1 = a.l1 AND b.from_acct = a.to_acct AND b.ts >= a.ts
        WHERE a.link_type <> 'VICTIM_L1'
        GROUP BY a.l1, a.from_acct, b.to_acct
        HAVING count(DISTINCT a.to_acct) >= $scatter_min
    )
),
funnel AS (
    SELECT DISTINCT l1
    FROM (
        SELECT l1, to_acct
        FROM cell_link
        WHERE link_type <> 'VICTIM_L1'
        GROUP BY l1, to_acct
        HAVING count(DISTINCT from_acct) >= $funnel_min
    )
),
cyc AS (
    SELECT DISTINCT l1 FROM cell_reach WHERE acct IN ($cycle_accts)
)
SELECT
    -- cell_id is ranked by money and time; the L1's acct_id is only a last
    -- tie-break and cannot change which accounts are in which cell.
    CAST(row_number() OVER (
        ORDER BY ls.total_in_paise DESC, ls.first_ts, a.l1) AS INTEGER) AS cell_id,
    rb.ring_id                      AS network_id,
    a.l1                            AS l1_acct,
    CAST(a.size AS INTEGER)         AS size,
    CAST(a.l1_count AS INTEGER)     AS l1_count,
    CAST(a.l2_count AS INTEGER)     AS l2_count,
    CAST(a.l3_count AS INTEGER)     AS l3_count,
    CAST(a.size - a.l1_count - a.l2_count - a.l3_count AS INTEGER) AS unclassified_count,
    CAST(a.victim_count AS INTEGER) AS victim_count,
    CAST(ls.total_in_paise AS BIGINT) AS total_in_paise,
    CAST(a.holding_paise AS BIGINT)   AS holding_paise,
    ls.first_ts, ls.last_ts,
    list_filter([
        CASE WHEN sc.l1 IS NOT NULL THEN 'SCATTER_GATHER' END,
        CASE WHEN fu.l1 IS NOT NULL THEN 'FUNNEL' END,
        CASE WHEN cy.l1 IS NOT NULL THEN 'CYCLE' END
    ], x -> x IS NOT NULL) AS patterns,
    ls.fingerprint,
    ls.n_links
FROM acct_stats a
JOIN link_stats ls   ON ls.l1 = a.l1
JOIN ring_comp c     ON c.acct = a.l1
JOIN ring_build rb   ON rb.label = c.label
LEFT JOIN scatter sc ON sc.l1 = a.l1
LEFT JOIN funnel fu  ON fu.l1 = a.l1
LEFT JOIN cyc cy     ON cy.l1 = a.l1;
