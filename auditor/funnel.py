"""Flow discovery: follow money from send-only accounts to receive-only accounts
(PROJECT_CONTEXT 16, stages 3 and 7). Generic, label-free, read-only.

Stage A needs only tx and accounts, so it runs before the engine has run:
    all accounts -> send-only accounts -> their payees -> those payees'
    receivers -> receive-only accounts.
Stage B compares those groups with the roles the engine wrote to scores.

Rules of this module:
- Groups come from transfer direction alone. No label, flag, account number,
  row order or activity count takes part.
- Every number is an OBSERVED statistic. Nothing here is a threshold and
  nothing is handed to scoring.
- The role each group is expected to carry is a domain mapping passed in by
  the caller (see audits\\); this module names no role.
- Every stage stores its question, exact SQL, result and verdict.
"""
from __future__ import annotations

import json
from pathlib import Path

from auditor import tools

GROUPS = ("send_only", "payees", "next_hop", "receive_only")
HOPS = tuple(zip(GROUPS, GROUPS[1:]))
NEEDS = {"tx": ("src", "dst", "amount_paise", "ts"), "accounts": ("acct_id",)}

SEMANTICS = (
    "Observed statistics only. The funnel describes how money moves between groups that are defined by "
    "transfer direction; none of its numbers is a threshold, and none is passed to scoring."
)

# Group membership, shared by every stage. An account's direction comes from
# all of its transfers; each later group is whoever the previous group paid.
MEMBERS = """
    WITH deg AS (
        SELECT acct_id, sum(n_in) AS n_in, sum(n_out) AS n_out, sum(amt_in) AS amt_in, sum(amt_out) AS amt_out
        FROM (
            SELECT src AS acct_id, 0 AS n_in, count(*) AS n_out, 0 AS amt_in, sum(amount_paise) AS amt_out
            FROM tx GROUP BY 1
            UNION ALL
            SELECT dst, count(*), 0, sum(amount_paise), 0 FROM tx GROUP BY 1
        )
        GROUP BY 1
    ),
    send_only AS (SELECT acct_id FROM deg WHERE n_in = 0 AND n_out > 0),
    receive_only AS (SELECT acct_id FROM deg WHERE n_out = 0 AND n_in > 0),
    payees AS (
        SELECT DISTINCT t.dst AS acct_id FROM tx t WHERE t.src IN (SELECT acct_id FROM send_only)
    ),
    next_hop AS (
        SELECT DISTINCT t.dst AS acct_id FROM tx t
        WHERE t.src IN (SELECT acct_id FROM payees) AND t.dst NOT IN (SELECT acct_id FROM payees)
    )"""


def load_role_map(path: str | Path | None) -> dict[str, str]:
    """Domain file: funnel group -> the role label scoring is expected to give it."""
    if not path:
        return {}
    roles = json.loads(Path(path).read_text(encoding="utf-8")).get("roles") or {}
    unknown = sorted(set(roles) - set(GROUPS))
    if unknown:
        raise tools.ToolInputError(f"Role map names an unknown funnel group: {tools._label(unknown[0], 40)}.")
    return {g: str(roles[g]) for g in GROUPS if g in roles}


def _stage(sid, stage, layer, question, sql, result, verdict, explanation) -> dict:
    assert verdict in tools.VERDICTS
    return {"id": sid, "stage": stage, "layer": layer, "question": question, "sql": sql,
            "result": result, "verdict": verdict, "explanation": explanation}


def _row(con, sql: str) -> dict:
    res = con.execute(sql)
    return dict(zip([d[0] for d in res.description], (tools._js(v) for v in res.fetchone())))


def _missing(con, tables: dict) -> str | None:
    cat = tools._catalog(con)
    for table, columns in tables.items():
        if table not in cat:
            return f"Table {table} does not exist in this database."
        for c in columns:
            if c not in cat[table]:
                return f"{table}.{c} does not exist in this database."
    return None


# --- Stage A ------------------------------------------------------------------

def _population(con) -> dict:
    sql = tools._sql(f"""
        {MEMBERS}
        SELECT (SELECT count(*) FROM accounts)                                  AS n_accounts,
               (SELECT count(*) FROM tx)                                        AS n_transfers,
               (SELECT count(*) FROM send_only)                                 AS n_send_only,
               (SELECT count(*) FROM receive_only)                              AS n_receive_only,
               (SELECT count(*) FROM deg WHERE n_in > 0 AND n_out > 0)          AS n_two_way,
               (SELECT count(*) FROM accounts a
                 WHERE a.acct_id NOT IN (SELECT acct_id FROM deg))              AS n_no_transfers,
               (SELECT count(*) FROM payees)                                    AS n_payees,
               (SELECT count(*) FROM next_hop)                                  AS n_next_hop,
               (SELECT count(*) FROM payees
                 WHERE acct_id IN (SELECT acct_id FROM receive_only))           AS n_payees_receive_only,
               (SELECT count(*) FROM next_hop
                 WHERE acct_id IN (SELECT acct_id FROM receive_only))           AS n_next_hop_receive_only
    """)
    r = _row(con, sql)
    one_way = r["n_send_only"] + r["n_receive_only"]
    if r["n_send_only"] and r["n_receive_only"]:
        verdict = tools.SIGNAL
        why = (f"{r['n_accounts']:,} accounts: {r['n_send_only']:,} only send and {r['n_receive_only']:,} only "
               f"receive ({tools._pct(tools._share(one_way, r['n_accounts']))} one-way); money has a start and "
               f"an end to follow.")
    else:
        verdict = tools.INCONCLUSIVE
        why = (f"{r['n_accounts']:,} accounts: {r['n_send_only']:,} only send and {r['n_receive_only']:,} only "
               f"receive; without both ends there is no funnel to follow.")
    return _stage("A:population", "A", "raw",
                  "How many accounts only send, only receive, or do both?", sql, r, verdict, why)


def _hop(con, sender: str, receiver: str) -> dict:
    sql = tools._sql(f"""
        {MEMBERS},
        hop AS (
            SELECT t.src, t.dst, t.ts FROM tx t
            WHERE t.src IN (SELECT acct_id FROM {sender}) AND t.dst IN (SELECT acct_id FROM {receiver})
        ),
        waits AS (
            SELECT date_diff('second', i.ts, h.ts) AS wait_s
            FROM hop h ASOF LEFT JOIN (SELECT dst, ts FROM tx) i ON i.dst = h.src AND i.ts <= h.ts
        ),
        fan AS (SELECT src, count(DISTINCT dst) AS n_receivers FROM hop GROUP BY 1),
        flow AS (
            SELECT CAST(d.amt_out AS DOUBLE) / nullif(d.amt_in, 0) AS out_in
            FROM deg d WHERE d.acct_id IN (SELECT src FROM fan)
        )
        SELECT (SELECT count(*) FROM {sender})                       AS n_sender_group,
               (SELECT count(*) FROM fan)                            AS n_senders_in_hop,
               (SELECT count(*) FROM {receiver})                     AS n_receiver_group,
               (SELECT count(DISTINCT dst) FROM hop)                 AS n_receivers_in_hop,
               (SELECT count(*) FROM hop)                            AS n_transfers,
               (SELECT count(*) FROM tx t
                 WHERE t.src IN (SELECT acct_id FROM {sender})
                   AND t.dst NOT IN (SELECT acct_id FROM {receiver})) AS n_transfers_elsewhere,
               w.*, f.*, o.*
        FROM (SELECT count(wait_s) AS n_with_arrival, count(*) - count(wait_s) AS n_without_arrival,
                     median(wait_s) AS wait_median_s, min(wait_s) AS wait_min_s, max(wait_s) AS wait_max_s
              FROM waits) w,
             (SELECT median(n_receivers) AS receivers_median, min(n_receivers) AS receivers_min,
                     max(n_receivers) AS receivers_max
              FROM fan) f,
             (SELECT count(out_in) AS n_with_ratio, median(out_in) AS out_in_median,
                     quantile_cont(out_in, 0.25) AS out_in_q1, quantile_cont(out_in, 0.75) AS out_in_q3,
                     min(out_in) AS out_in_min, max(out_in) AS out_in_max
              FROM flow) o
    """)
    r = _row(con, sql)
    result = {
        "from": sender, "to": receiver,
        "accounts": {"sender_group": r["n_sender_group"], "senders_in_hop": r["n_senders_in_hop"],
                     "receiver_group": r["n_receiver_group"], "receivers_in_hop": r["n_receivers_in_hop"]},
        "transfers": {"in_hop": r["n_transfers"], "from_sender_group_elsewhere": r["n_transfers_elsewhere"]},
        "arrival_to_forward_s": {"median": r["wait_median_s"], "min": r["wait_min_s"], "max": r["wait_max_s"],
                                 "n_with_arrival": r["n_with_arrival"],
                                 "n_without_arrival": r["n_without_arrival"]},
        "receivers_per_sender": {"median": r["receivers_median"], "min": r["receivers_min"],
                                 "max": r["receivers_max"]},
        "out_in_ratio": {"median": r["out_in_median"], "q1": r["out_in_q1"], "q3": r["out_in_q3"],
                         "min": r["out_in_min"], "max": r["out_in_max"], "n_senders": r["n_with_ratio"]},
        "observed_only": True,
    }
    name = f"{sender} -> {receiver}"
    if not r["n_transfers"]:
        verdict, why = tools.INCONCLUSIVE, f"{name}: no transfer links these two groups."
    else:
        verdict = tools.SIGNAL
        wait = ("no earlier arrival (the money starts here)" if not r["n_with_arrival"] else
                f"forwarded a median {r['wait_median_s']:,.0f} s after arrival "
                f"({r['wait_min_s']:,.0f} to {r['wait_max_s']:,.0f} s)")
        ratio = ("no inflow, so no out/in ratio" if not r["n_with_ratio"] else
                 f"out/in ratio median {r['out_in_median']:.3f} "
                 f"(middle half {r['out_in_q1']:.3f} to {r['out_in_q3']:.3f})")
        why = (f"{name}: {r['n_senders_in_hop']:,} of {r['n_sender_group']:,} senders reach "
               f"{r['n_receivers_in_hop']:,} of {r['n_receiver_group']:,} receivers in {r['n_transfers']:,} "
               f"transfers ({r['n_transfers_elsewhere']:,} go elsewhere); {wait}; "
               f"{r['receivers_median']:g} receivers per sender (median, {r['receivers_min']} to "
               f"{r['receivers_max']}); {ratio}. Observed, not thresholds.")
    return _stage(f"A:{sender}->{receiver}", "A", "raw",
                  f"How does money move from the {sender} group to the {receiver} group?",
                  sql, result, verdict, why)


def stage_a(con) -> list[dict]:
    problem = _missing(con, NEEDS)
    if problem:
        return [_stage("A:population", "A", "raw", "Can the funnel be followed in this database?",
                       None, {}, tools.INCONCLUSIVE, problem)]
    return [_population(con)] + [_hop(con, s, r) for s, r in HOPS]


# --- Stage B ------------------------------------------------------------------

def stage_b(con, role_map: dict[str, str], rules: dict) -> list[dict]:
    sid, question = "B:agreement", "Do the funnel's groups match the roles that scoring assigned?"
    problem = _missing(con, {**NEEDS, "scores": ("acct_id", "profile_id", "role"),
                             "scoring_profiles": ("profile_id", "is_active")})
    if problem:
        return [_stage(sid, "B", "engine", question, None, {}, tools.INCONCLUSIVE, problem)]
    lab = int(rules["label_max_len"])
    if any(tools._label(role, lab) != role for role in role_map.values()):
        return [_stage(sid, "B", "engine", question, None, {}, tools.INCONCLUSIVE,
                       "The role map holds a role that is not a plain label.")]
    ranked = " UNION ALL ".join(f"SELECT acct_id, '{g}' AS grp, {i} AS rnk FROM {g}" for i, g in enumerate(GROUPS))
    expected = ", ".join(f"('{g}', '{role_map[g]}')" for g in GROUPS if g in role_map) or "(CAST(NULL AS VARCHAR), CAST(NULL AS VARCHAR))"
    base = f"""
        {MEMBERS},
        member AS (
            SELECT acct_id, arg_min(grp, rnk) AS grp, count(*) AS n_groups
            FROM ({ranked})
            GROUP BY 1
        ),
        expected(grp, role) AS (VALUES {expected}),
        scored AS (
            SELECT s.acct_id, s.role FROM scores s
            WHERE s.profile_id = (SELECT profile_id FROM scoring_profiles WHERE is_active LIMIT 1)
        ),
        paired AS (
            SELECT coalesce(m.acct_id, s.acct_id) AS acct_id, m.grp, m.n_groups, e.role AS expected_role, s.role
            FROM member m
            FULL JOIN scored s ON s.acct_id = m.acct_id
            LEFT JOIN expected e ON e.grp = m.grp
        )"""
    table_sql = tools._sql(f"""
        {base}
        SELECT grp, expected_role, role, count(*) AS n, count(*) FILTER (n_groups > 1) AS n_in_two_groups
        FROM paired
        GROUP BY grp, expected_role, role
        ORDER BY grp NULLS LAST, role NULLS LAST
    """)
    diff_sql = tools._sql(f"""
        {base}
        SELECT acct_id, grp, expected_role, role
        FROM paired
        WHERE expected_role IS DISTINCT FROM role
        ORDER BY acct_id
    """)
    cells = con.execute(table_sql).fetchall()
    table = [{"funnel_group": g, "expected_role": tools._label(e, lab), "role": tools._label(r, lab), "accounts": n}
             for g, e, r, n, _ in cells]
    result = {
        "role_map": role_map,
        "n_accounts_compared": sum(c[3] for c in cells),
        "n_in_two_groups": sum(c[4] for c in cells),
        "table": table,
    }
    if not role_map:
        return [_stage(sid, "B", "engine", question, table_sql, result, tools.INCONCLUSIVE,
                       "No role map was passed, so the groups are shown against the roles but not judged.")]
    diffs = con.execute(diff_sql).fetchall()
    groups = []
    for g in GROUPS:
        size = sum(c[3] for c in cells if c[0] == g)
        match = sum(c[3] for c in cells if c[0] == g and c[1] is not None and c[1] == c[2])
        groups.append({"funnel_group": g, "expected_role": role_map.get(g), "accounts": size, "matches": match})
    result.update({
        "groups": groups,
        "n_agree": result["n_accounts_compared"] - len(diffs),
        "n_disagree": len(diffs),
        "disagreements": [{"acct_id": a, "funnel_group": g, "expected_role": tools._label(e, lab),
                           "role": tools._label(r, lab)} for a, g, e, r in diffs],
    })
    pairs = "; ".join(f"{g['funnel_group']} {g['matches']:,}/{g['accounts']:,} = {g['expected_role']}"
                      for g in groups if g["expected_role"])
    if diffs:
        verdict = tools.INCONCLUSIVE
        why = (f"The funnel and scoring disagree on {len(diffs):,} of {result['n_accounts_compared']:,} "
               f"accounts ({pairs}); every one is listed.")
    else:
        verdict = tools.CLEAN
        why = (f"The funnel and scoring agree on all {result['n_accounts_compared']:,} accounts ({pairs}): "
               f"two independent methods find the same accounts in the same roles.")
    return [_stage(sid, "B", "engine", question, table_sql + ";\n\n" + diff_sql, result, verdict, why)]


def run(con, layers: tuple[str, ...], role_map: dict[str, str], rules: dict) -> dict:
    """The funnel block of audit.json. Stage A is raw; Stage B needs the engine."""
    stages = stage_a(con) if "raw" in layers else []
    if "engine" in layers:
        stages += stage_b(con, role_map, rules)
    return {
        "semantics": SEMANTICS,
        "groups": list(GROUPS),
        "summary": {v: sum(1 for s in stages if s["verdict"] == v) for v in tools.VERDICTS},
        "stages": stages,
    }
