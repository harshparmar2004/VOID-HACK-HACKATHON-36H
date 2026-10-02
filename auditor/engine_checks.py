"""Engine-layer checks on the active scoring profile and on scores.

1. Gate consistency: for every do_not_use entry of the raw layer, is the engine
   still scoring what the entry says to ignore? A parameter counts as switched
   off when its weight is 0, it is disabled, or its gate is closed.
2. Score sanity: how the final index is spread across the funnel's groups, how
   far the groups overlap, and which accounts sit close to the flag threshold.

Rules of this module:
- Read-only. Nothing here changes a weight, a gate or a score.
- What a feature reads comes from a lineage file the caller passes in (see
  audits\\); this module names no feature and no parameter.
- Score statistics are OBSERVED numbers, never thresholds.
"""
from __future__ import annotations

import json
from pathlib import Path

from auditor import funnel, tools

PROFILE_SQL = "SELECT profile_id, definition FROM scoring_profiles WHERE is_active LIMIT 1"
SCORE_NEEDS = {**funnel.NEEDS, "scores": ("acct_id", "profile_id", "final_index", "is_flagged"),
               "scoring_profiles": ("profile_id", "is_active")}


def load_lineage(path: str | Path | None) -> dict[str, dict]:
    """Domain file: feature -> what it reads (reads, time_cycles, row_order, adjacency, from_scores)."""
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8")).get("features") or {}


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def profile_parameters(definition: dict) -> list[dict]:
    """Every parameter of the profile (anything with an id and a feature list), with its on/off state."""
    gates = [g for g in _walk(definition) if "status" in g and isinstance(g.get("gates"), list)]
    status = {g.get("id"): g["status"] for g in gates}
    closed_for = {p for g in gates if g["status"] == "closed" for p in g["gates"]}
    out = []
    for p in _walk(definition):
        if "id" not in p or not isinstance(p.get("features"), list):
            continue
        weight, gate = p.get("weight"), p.get("gate")
        gate_closed = status.get(gate) == "closed" or p["id"] in closed_for
        off = [why for why, hit in (("weight 0", not weight), ("disabled", p.get("enabled") is False),
                                    ("gate closed", gate_closed)) if hit]
        out.append({"id": p["id"], "features": list(p["features"]), "weight": weight,
                    "enabled": p.get("enabled"), "gate": gate, "gate_status": status.get(gate),
                    "switched_off": bool(off), "off_because": off,
                    "gate_closed_but_weighted": gate_closed and bool(weight) and p.get("enabled") is not False})
    return out


def _uses(entry: dict, source: dict, lineage: dict) -> list[set[str]]:
    """The features that use what a do_not_use entry names. One set per thing the
    entry names; two sets mean the entry is about counting the same thing twice."""
    args = source["args"]

    def reading(column):
        return {f for f, lin in lineage.items() if column in (lin.get("reads") or [])}

    def flagged(key):
        return {f for f, lin in lineage.items() if lin.get(key)}

    tool = source["tool"]
    if tool == "check_consistency":
        return [reading(args["col_a"]), reading(args["col_b"])]
    if tool == "check_time_pattern":
        cycle = entry["evidence"].get("cycle")
        return [{f for f, lin in lineage.items() if cycle in (lin.get("time_cycles") or [])}]
    if tool == "check_row_position":
        return [flagged("row_order")]
    if tool == "check_adjacency":
        return [flagged("adjacency")]
    return [reading(args["column"])]


def gate_consistency(con, raw_findings: list[dict] | None, lineage: dict, rules: dict) -> list[dict]:
    def finding(fid, args, question, result, verdict, why):
        return {"id": fid, "layer": "engine",
                **tools._finding("check_gate", args, question, PROFILE_SQL, result, verdict, why)}

    general = "Does the engine still score anything the audit said not to use?"
    if raw_findings is None:
        return [finding("check_gate:all", {}, general, {}, tools.INCONCLUSIVE,
                        "The do_not_use list comes from the raw layer; run both layers to check it.")]
    profile_id, definition = tools.active_profile(con)
    if not definition or not lineage:
        missing = "an active scoring profile" if not definition else "a feature lineage file"
        return [finding("check_gate:all", {}, general, {}, tools.INCONCLUSIVE,
                        f"Cannot check: this run has no {missing}.")]
    params = profile_parameters(definition)
    live = [p for p in params if not p["switched_off"]]
    unknown = sorted({f for p in live for f in p["features"] if f not in lineage})
    indirect = sorted({p["id"] for p in live for f in p["features"] if lineage.get(f, {}).get("from_scores")})
    out = []
    for source in raw_findings:
        for entry in source["do_not_use"]:
            groups = _uses(entry, source, lineage)
            users = [[{"parameter": p["id"], "features": sorted(set(p["features"]) & g), "weight": p["weight"],
                       "enabled": p["enabled"], "gate": p["gate"], "gate_status": p["gate_status"],
                       "switched_off": p["switched_off"], "off_because": p["off_because"],
                       "gate_closed_but_weighted": p["gate_closed_but_weighted"],
                       "how": {f: lineage[f]["how"] for f in sorted(set(p["features"]) & g) if lineage[f].get("how")}}
                      for p in params if set(p["features"]) & g] for g in groups]
            scored = [sorted({u["parameter"] for u in grp if not u["switched_off"]}) for grp in users]
            if len(groups) > 1:
                still = sorted(set().union(*scored)) if all(scored) and len(set().union(*scored)) > 1 else []
            else:
                still = scored[0]
            result = {
                "profile_id": profile_id, "do_not_use": {k: entry[k] for k in ("kind", "name", "test")},
                "features_using_it": [sorted(g) for g in groups],
                "parameters": [u for grp in users for u in grp],
                "still_scored_by": still,
                "indirect_via_scores": indirect if still else [],
                "features_without_lineage": unknown,
            }
            n_users = len({u["parameter"] for grp in users for u in grp})
            if still:
                verdict = tools.TRAP
                tail = (f"; {', '.join(indirect)} inherit it through neighbours' scores" if indirect else "")
                twice = "count it more than once" if len(groups) > 1 else "still score it"
                why = (f"{entry['name']}: {', '.join(still)} {twice} "
                       f"(weight {', '.join(str(p['weight']) for p in live if p['id'] in still)}, gate open){tail}.")
            elif unknown:
                verdict = tools.INCONCLUSIVE
                why = (f"{entry['name']}: no scored parameter is known to use it, but {len(unknown)} scored "
                       f"feature(s) have no lineage, so it cannot be ruled out.")
            elif not n_users:
                verdict, why = tools.CLEAN, f"{entry['name']}: no parameter of the profile uses it."
            elif len(groups) > 1 and any(scored):
                verdict = tools.CLEAN
                why = (f"{entry['name']}: only {', '.join(sorted(set().union(*scored)))} scores them, as one "
                       f"signal counted once.")
            else:
                verdict = tools.CLEAN
                off = sorted({f"{u['parameter']} ({', '.join(u['off_because'])})" for grp in users for u in grp})
                why = f"{entry['name']}: switched off in the profile: {'; '.join(off)}."
            out.append(finding(f"check_gate:{source['id']}|{entry['test']}",
                               {"finding": source["id"], "test": entry["test"]},
                               f"Does the engine still score {entry['name']}?", result, verdict, why))
    return out


def score_sanity(con, rules: dict) -> list[dict]:
    fid, args = "check_scores:final_index", {"score": "final_index", "group": "funnel group"}
    question = "How is the final index spread across the funnel's groups, and who sits near the flag threshold?"

    def finding(sql, result, verdict, why):
        return [{"id": fid, "layer": "engine",
                 **tools._finding("check_scores", args, question, sql, result, verdict, why)}]

    problem = funnel._missing(con, SCORE_NEEDS)
    if problem:
        return finding(None, {}, tools.INCONCLUSIVE, problem)
    _, definition = tools.active_profile(con)
    threshold = ((definition.get("final") or {}).get("flag") or {}).get("threshold")
    margin = float(rules["near_threshold_points"])
    near = (f"abs(x - {float(threshold)!r}) <= {margin!r}" if threshold is not None else "FALSE")
    base = f"""
        {funnel.MEMBERS},
        {funnel.MEMBER},
        g AS (
            SELECT coalesce(m.grp, 'no_group') AS grp, s.final_index AS x, s.is_flagged
            FROM scores s LEFT JOIN member m ON m.acct_id = s.acct_id
            WHERE s.profile_id = (SELECT profile_id FROM scoring_profiles WHERE is_active LIMIT 1)
        ),
        stats AS (
            SELECT grp, count(*) AS n, count(x) AS n_scored, min(x) AS lo, quantile_cont(x, 0.25) AS q1,
                   median(x) AS med, quantile_cont(x, 0.75) AS q3, max(x) AS hi,
                   count(*) FILTER (is_flagged) AS n_flagged,
                   count(*) FILTER ({near} AND NOT is_flagged) AS n_near_not_flagged,
                   count(*) FILTER ({near} AND is_flagged) AS n_near_flagged
            FROM g GROUP BY grp
        )"""
    stats_sql = tools._sql(f"{base}\n        SELECT * FROM stats ORDER BY grp")
    overlap_sql = tools._sql(f"""
        {base}
        SELECT a.grp, b.grp, greatest(a.lo, b.lo) AS lo, least(a.hi, b.hi) AS hi,
               (SELECT count(*) FROM g WHERE g.grp = a.grp AND g.x BETWEEN greatest(a.lo, b.lo) AND least(a.hi, b.hi)),
               (SELECT count(*) FROM g WHERE g.grp = b.grp AND g.x BETWEEN greatest(a.lo, b.lo) AND least(a.hi, b.hi))
        FROM stats a JOIN stats b ON a.grp < b.grp
        WHERE greatest(a.lo, b.lo) <= least(a.hi, b.hi)
        ORDER BY 1, 2
    """)
    rows = con.execute(stats_sql).fetchall()
    groups = [{"group": g, "accounts": n, "scored": ns, "min": tools._js(lo), "q1": tools._js(q1),
               "median": tools._js(med), "q3": tools._js(q3), "max": tools._js(hi), "flagged": nf,
               "near_threshold_not_flagged": nb, "near_threshold_flagged": na}
              for g, n, ns, lo, q1, med, q3, hi, nf, nb, na in rows]
    overlaps = [{"group_a": a, "group_b": b, "shared_range": [tools._js(lo), tools._js(hi)],
                 "accounts_a_in_range": na, "accounts_b_in_range": nb}
                for a, b, lo, hi, na, nb in con.execute(overlap_sql).fetchall()]
    n_near = sum(g["near_threshold_not_flagged"] + g["near_threshold_flagged"] for g in groups)
    result = {"flag_threshold": threshold, "near_margin_points": margin, "n_near_threshold": n_near,
              "groups": groups, "overlaps": overlaps, "observed_only": True}
    spread = "; ".join(f"{g['group']} median {g['median']:g} ({g['min']:g} to {g['max']:g})"
                       for g in groups if g["scored"])
    shared = (f"{len(overlaps)} pair(s) of groups share part of their range" if overlaps
              else "no two groups share any part of their range")
    if threshold is None:
        verdict = tools.INCONCLUSIVE
        why = f"Final index by group: {spread}; {shared}. The profile holds no flag threshold to measure against."
    else:
        verdict = tools.SIGNAL if n_near else tools.CLEAN
        why = (f"Final index by group: {spread}; {shared}; {n_near:,} account(s) within {margin:g} points of the "
               f"flag threshold {threshold:g}. Observed, not thresholds.")
    return finding(stats_sql + ";\n\n" + overlap_sql, result, verdict, why)
