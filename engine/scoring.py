"""
engine/scoring.py -- Step 4 of the Abhedya-Chakra pipeline: scoring.

    --pass 1   features + active profile             -> scores (behaviour only)
    --pass 2   pass 1 + layer_links (the default)    -> scores (final) + roles

Build order (PROJECT_CONTEXT.md Section 9):
    scoring.py --pass 1  ->  links.py  ->  scoring.py  ->  rings.py

PASS 1 writes, for every account of the ACTIVE profile:
  * mp1..mp6, mp8 and t1..t4, t6, t7 (Sections 4.1 / 4.2, honouring the
    reliability gates of Section 4.6); mp7 and t5 stay NULL -- both read
    `neighbour_risk`, which needs scores to exist first
  * mule_index, trust_index, final_index, override_applied, is_flagged (final
    threshold AND the two-signal rule), band, param_points, reasons.
links.py then proves the layer links between the accounts pass 1 flagged.

PASS 2 recomputes pass 1 in a temp table (it never reads scores it wrote
itself, so it can be rerun), then:
  * neighbour_risk = amount-weighted mean PASS-1 Final Index of the account's
    counterparties; upstream_l1_share / upstream_l2_share = share of incoming
    money arriving through proven layer links from L1 / L2 candidates. All
    three are also written back into `features` (its pass-2 placeholders)
  * MP7 and T5, then Mule, Trust, Final, the overrides, flag and band again
  * the link-confirmed sink override (profile: final.sink_override)
  * l1/l2/l3_score for flagged accounts, victim_score for unflagged ones
  * role, role_confirmed, candidate_roles, upstream/downstream_role_share
    (Section 4.3b: best role score at/above the threshold, clear of the tie
    margin, AND a proven layer link -- otherwise UNCLASSIFIED_MULE).
  * holding_paise (all money received - all money sent) and
    freeze_recommended (profile: final.freeze -- flagged AND role confirmed
    AND holding > 0). The band is a confidence label and is not read.
ring_id is left NULL: rings.py fills it, and must be rerun after this script.

Rules this script obeys (PROJECT_CONTEXT.md Sections 4.6 and 8):
  * All data work is DuckDB SQL; Python only turns the profile into SQL
    expressions. No loop over accounts or transactions.
  * Every weight, threshold, window and band comes from the active profile.
    Each value interpolated into SQL is first proven to be a number, and each
    feature name is checked against the real columns.
  * A NULL feature scores 0 and never counts toward the two-signal rule.
  * No ground-truth labels, account-number ranges, tx_key order, hop numbers
    or device-count fingerprints.
  * The connection is closed in a finally block.

Known limitation (Section 4.6): trust_index.measure_before_burst is not applied
-- trust features are lifetime totals.

Usage:
    .venv\\Scripts\\python.exe engine\\scoring.py --pass 1
    .venv\\Scripts\\python.exe engine\\links.py
    .venv\\Scripts\\python.exe engine\\scoring.py
    .venv\\Scripts\\python.exe engine\\scoring.py --db %TEMP%\\case_review.duckdb
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from string import Template

import duckdb

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"
SQL_PATH = ENGINE_DIR / "sql" / "scoring.sql"
PASS2_SQL_PATH = ENGINE_DIR / "sql" / "pass2.sql"

MEMORY_LIMIT = "3GB"

# Features that only exist after pass 2. In pass 1 a parameter reading one of
# them is written as NULL rather than scored on a placeholder.
PASS2_FEATURES = {"neighbour_risk", "upstream_l1_share", "upstream_l2_share"}

# scores has a fixed column per parameter for these IDs (schema.sql). Anything
# else in a profile lives in param_points only.
SCORE_COLUMNS = [f"mp{i}" for i in range(1, 9)] + [f"t{i}" for i in range(1, 8)]

# Tolerance for "at half points or more": the linear ramp lands on exactly half
# the weight in real arithmetic, and float rounding must not lose that signal.
EPS = 1e-9

# layer_links.link_type values (schema.sql CHECK); the sink override may only
# name these.
LINK_TYPES = ("VICTIM_L1", "L1_L2", "L2_L2", "L2_L3")

# The only `transform` a threshold rule may carry: "<number> - <feature>".
TRANSFORM_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*-\s*(\w+)\s*$")


def active_profile(con: duckdb.DuckDBPyConnection) -> tuple[str, dict]:
    """Return (profile_id, definition) of the single active profile."""
    rows = con.execute(
        "SELECT profile_id, definition FROM scoring_profiles "
        "WHERE is_active ORDER BY profile_id"
    ).fetchall()
    if not rows:
        raise SystemExit(
            "no active scoring profile -- run engine\\seed_profile.py first")
    if len(rows) > 1:
        raise SystemExit(
            f"{len(rows)} active profiles ({[r[0] for r in rows]}); expected exactly one")
    return rows[0][0], json.loads(rows[0][1])


def num(v, what: str) -> str:
    """A profile value as a SQL numeric literal -- refuses anything else."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise SystemExit(f"profile {what} must be a number, got {v!r}")
    return repr(float(v))


def lit(text: str) -> str:
    """A Python string as a SQL string literal."""
    return "'" + str(text).replace("'", "''") + "'"


def pct(x: str) -> str:
    """SQL expression rendering a 0-1 share as a whole percentage."""
    return f"printf('%.0f%%', 100.0 * {x})"


class Builder:
    """Turns profile parameters into SQL expressions over `features`."""

    def __init__(self, profile: dict, feature_cols: set[str]):
        self.profile = profile
        self.cols = feature_cols
        self.gates = {g["id"]: g for g in profile.get("reliability_gates", [])}
        self.pop: dict[str, str] = {}      # population-median columns needed
        self.notes: list[str] = []         # run-time notes printed by main()

    # -- small helpers ------------------------------------------------------
    def col(self, name: str) -> str:
        if name not in self.cols:
            raise SystemExit(
                f"profile refers to feature {name!r}, which is not a column of "
                "`features` -- rerun engine\\features.py")
        return f'"{name}"'

    def window_s(self, key: str) -> tuple[str, str]:
        """A named window from the profile's `windows` block, in seconds."""
        w = self.profile["windows"][key]
        lo, hi = (w["min"], w["max"]) if isinstance(w, dict) else (0, w)
        return num(lo * 60, f"windows.{key}"), num(hi * 60, f"windows.{key}")

    def gate_status(self, p: dict) -> str | None:
        g = p.get("gate")
        if g is None:
            return None
        if g not in self.gates:
            raise SystemExit(f"{p['id']} names gate {g!r}, which the profile does not define")
        return self.gates[g]["status"]

    # -- rule types ---------------------------------------------------------
    def ramp_up(self, x: str, full, half, w: str, what: str) -> str:
        """0 below half, half points at half, full at full, linear between."""
        if full is None:
            return "0.0"
        f = num(full, f"{what}.full_at")
        if half is None:          # one threshold only: a step (config, trust)
            return f"CASE WHEN {x} >= {f} THEN {w} ELSE 0.0 END"
        h = num(half, f"{what}.half_at")
        return (f"CASE WHEN {x} >= {f} THEN {w} "
                f"WHEN {x} >= {h} THEN {w} * (0.5 + 0.5 * ({x} - {h}) / ({f} - {h})) "
                "ELSE 0.0 END")

    def ramp_down(self, x: str, full, half, w: str, what: str) -> str:
        """Mirror image: full at or below `full`, half at `half`, 0 above."""
        f = num(full, f"{what}.full_at_max")
        if half is None:
            return f"CASE WHEN {x} <= {f} THEN {w} ELSE 0.0 END"
        h = num(half, f"{what}.half_at_max")
        return (f"CASE WHEN {x} <= {f} THEN {w} "
                f"WHEN {x} <= {h} THEN {w} * (0.5 + 0.5 * ({h} - {x}) / ({h} - {f})) "
                "ELSE 0.0 END")

    def pattern_sql(self, rule: dict) -> str:
        """MP2's "real pattern": receiver count AND lag inside the named window."""
        split, lag = self.col(rule["split_feature"]), self.col(rule["lag_feature"])
        alts = []
        for alt in rule["pattern"]["any_of"]:
            lo, hi = self.window_s(alt["lag_window"])
            r = alt["receivers"]
            alts.append(
                f"({split} BETWEEN {num(r['min'], 'receivers.min')} AND {num(r['max'], 'receivers.max')}"
                f" AND {lag} BETWEEN {lo} AND {hi})")
        return "(" + " OR ".join(alts) + ")"

    def points(self, p: dict) -> str:
        """SQL expression for one parameter's points (0..weight, never NULL)."""
        pid, rule, w = p["id"], p["rule"], num(p["weight"], f"{p['id']}.weight")
        kind = rule["type"]

        if kind in ("threshold_desc", "threshold_asc"):
            x = self.col(rule["feature"])
            if rule.get("transform"):                # T5: "100 - neighbour_risk"
                m = TRANSFORM_RE.match(rule["transform"])
                if not m or m.group(2) != rule["feature"]:
                    raise SystemExit(
                        f"{pid}: unsupported transform {rule['transform']!r} "
                        "(expected '<number> - <feature>')")
                x = f"{num(float(m.group(1)), pid + '.transform')} - {x}"
            if "receive_only_feature" in rule:       # MP3: true L3s never send
                x = (f"CASE WHEN {self.col('is_receive_only')} "
                     f"THEN {self.col(rule['receive_only_feature'])} ELSE {x} END")
            if rule.get("full_at") is None:
                self.notes.append(f"{pid}: enabled but full_at is null in the profile -> 0 points")
            return self.ramp_up(f"({x})", rule.get("full_at"), rule.get("half_at"), w, pid)

        if kind == "ratio_to_population_median_asc":
            feat = rule["feature"]
            self.pop[feat] = f'median({self.col(feat)}) AS "pop_median_{feat}"'
            x = f'({self.col(feat)}::DOUBLE / nullif("pop_median_{feat}", 0))'
            return self.ramp_down(x, rule["full_at_max"], rule.get("half_at_max"), w, pid)

        if kind == "boolean":
            terms = [f"coalesce({self.col(t['feature'])}, FALSE)"
                     for t in rule["full"]["any_of"]]
            return f"CASE WHEN {' OR '.join(terms)} THEN {w} ELSE 0.0 END"

        if kind == "commission_pattern":             # MP2, Sections 4.1 / 4.6
            ratio, iqr = self.col(rule["ratio_feature"]), self.col(rule["iqr_feature"])
            pattern = self.pattern_sql(rule)
            null_ok = f" OR {iqr} IS NULL" if rule.get("null_iqr_passes") else ""

            def level(spec: dict, what: str) -> str:
                return (f"{ratio} BETWEEN {num(spec['ratio']['min'], what)} AND {num(spec['ratio']['max'], what)}"
                        f" AND ({iqr} <= {num(spec['iqr_max'], what)}{null_ok})")
            return (f"CASE WHEN {pattern} AND {level(rule['full'], pid + '.full')} THEN {w} "
                    f"WHEN {pattern} AND {level(rule['half'], pid + '.half')} THEN {w} * 0.5 "
                    "ELSE 0.0 END")

        if kind == "compound":                       # T4: every condition holds
            conds = []
            for c in rule["full"]["all_of"]:
                x = self.col(c["feature"])
                if "min" in c:
                    conds.append(f"{x} >= {num(c['min'], pid)}")
                if "max" in c:
                    conds.append(f"{x} <= {num(c['max'], pid)}")
            return f"CASE WHEN {' AND '.join(conds)} THEN {w} ELSE 0.0 END"

        raise SystemExit(f"{pid}: unknown rule type {kind!r}")

    # -- plain-English reasons ---------------------------------------------
    def phrase(self, p: dict) -> str:
        """SQL string expression describing WHY the parameter scored.

        Wording only -- no threshold lives here. An ID this table does not know
        falls back to the profile's own name and rule_text.
        """
        pid, rule = p["id"], p["rule"]

        if pid == "MP1":
            return (f"'Forwards ' || {pct(self.col(rule['feature']))} || "
                    "' of the money it receives within the pass-through window'")
        if pid == "MP2":
            ratio, iqr = self.col(rule["ratio_feature"]), self.col(rule["iqr_feature"])
            split, lag = self.col(rule["split_feature"]), self.col(rule["lag_feature"])
            eps = (f"printf(' across %d forwarding episodes (spread %.3f)', \"forwarding_episodes\", {iqr})"
                   if "forwarding_episodes" in self.cols else f"printf(' (spread %.3f)', {iqr})")
            return (f"'Passes on a steady ' || {pct(ratio)} || ' of each inflow'"
                    f" || CASE WHEN {iqr} IS NULL THEN ' (one forwarding episode)' ELSE {eps} END"
                    f" || CASE WHEN {split} = 1 THEN ', as a single forward'"
                    f" ELSE printf(', split across %.0f receivers', {split}) END"
                    f" || printf(', typically %.1f min after the money arrives', {lag} / 60.0)")
        if pid == "MP3":
            out, inn = self.col(rule["feature"]), self.col(rule["receive_only_feature"])
            ro = self.col("is_receive_only")
            return (f"CASE WHEN {ro} THEN {pct(inn)} || ' of incoming' ELSE {pct(out)} || ' of outgoing' END"
                    " || ' transfers carry the layering combination (headless device + foreign IP"
                    " + cash-out narration), counted as one signal'")
        if pid == "MP4":
            feat = rule["feature"]
            return (f"printf('Only %d lifetime transactions, %.2fx the population median of %.0f',"
                    f" {self.col(feat)}, {self.col(feat)}::DOUBLE / nullif(\"pop_median_{feat}\", 0),"
                    f" \"pop_median_{feat}\")")
        if pid == "MP5":
            return (f"{pct(self.col(rule['feature']))} || "
                    "' of incoming money comes from victim-like senders (send-only, very few payments)'")
        if pid == "MP6":
            return (f"CASE WHEN coalesce({self.col('is_receive_only')}, FALSE)"
                    " THEN 'One-way account: it only receives, never sends'"
                    " ELSE 'One-way account: it only sends, never receives' END")
        if pid == "MP7":
            return ("printf('Trades with risky accounts: neighbour risk %.0f of 100 "
                    f"(amount-weighted)', {self.col(rule['feature'])})")
        if pid == "MP8":
            return (f"printf('Typical transaction is %.1fx the population median amount', "
                    f"{self.col(rule['feature'])})")
        if pid == "T1":
            return f"printf('Active on %d different days', {self.col(rule['feature'])})"
        if pid == "T5":
            return ("printf('Clean neighbourhood: neighbour risk only %.0f of 100', "
                    f"{self.col(rule['feature'])})")
        if pid == "T4":
            return ("printf('Organic amounts: %.0f%% of amounts are distinct, typical amount %.1fx the population median',"
                    f" 100.0 * {self.col('amount_diversity')}, {self.col('amount_vs_population')})")
        return lit(f"{p['name']}: {p.get('rule_text', '')}".strip())


def build_sql(profile: dict, feature_cols: set[str], pass_no: int = 1,
              source: str = "features", out_table: str = "score_pass1",
              ) -> tuple[str, Builder, list[dict]]:
    """Fill engine/sql/scoring.sql from the profile. Returns (sql, builder, plan).

    pass_no 1 leaves the neighbour-risk parameters NULL; pass_no 2 scores every
    parameter from `source` and adds the link-confirmed sink override.
    """
    b = Builder(profile, feature_cols)
    mule = profile["mule_index"]["parameters"]
    zero = profile["mule_index"].get("zero_weight_parameters", [])
    trust = profile["trust_index"]["parameters"]
    min_tx = num(profile["trust_index"]["min_tx_for_trust"], "min_tx_for_trust")

    plan: list[dict] = []        # one entry per parameter, also printed by main()
    for p in mule + zero + trust:
        pid = p["id"]
        gate = b.gate_status(p)
        scored = bool(p.get("enabled")) and p["weight"] > 0
        deferred = pass_no == 1 and scored and (
            p.get("pass") == 2 or bool(PASS2_FEATURES & set(p.get("features", []))))
        if gate == "open" and not scored:
            b.notes.append(f"{pid}: gate {p['gate']} is OPEN but the parameter is disabled "
                           "in the profile -- rebalance the weights and reseed")
        if deferred:
            expr, state = "CAST(NULL AS DOUBLE)", "pass 2 (NULL)"
        elif not scored:
            expr = "0.0"
            state = f"off, 0 points (gate {gate})" if gate else "off, 0 points (weight 0)"
        else:
            expr = b.points(p)
            if p.get("index") == "trust":
                # Section 4.2: fewer than min_tx transactions -> Trust = 0.
                expr = f'CASE WHEN "tx_count" < {min_tx} THEN 0.0 ELSE {expr} END'
            state = f"scored (gate {gate}: reduced rule)" if gate else "scored"
        plan.append({"p": p, "name": pid.lower(), "expr": expr, "state": state,
                     "live": scored and not deferred, "deferred": deferred})

    names = [e["name"] for e in plan]
    absent = [c for c in SCORE_COLUMNS if c not in names]
    if absent or len(set(names)) != len(names) or not all(n.isalnum() for n in names):
        raise SystemExit(
            f"profile parameter IDs do not map onto the scores columns (missing: {absent})")

    point_columns = ",\n".join(f"        {e['expr']} AS {e['name']}" for e in plan)

    def index_sum(index: str, total) -> str:
        live = [e["name"] for e in plan if e["live"] and e["p"].get("index") == index]
        if not live:
            return "0.0"
        return f"({' + '.join(live)}) * 100.0 / {num(total, index + ' total_weight')}"

    flag = profile["final"]["flag"]
    two = flag["two_signal_rule"]
    half_terms = [
        f"CAST({e['name']} >= {num(e['p']['weight'], 'weight')} * 0.5 - {EPS} AS INTEGER)"
        for e in plan if e["live"] and e["p"]["id"] in two["over"]]
    half_count = "(" + " + ".join(half_terms or ["0"]) + ")"

    # Override (Section 4.3). The 3-15 min window belongs to the SPLIT branch;
    # a single forward is already inside the single-forward window by
    # construction of the episode rule, and is tested on its commission.
    ov = profile["final"]["override"]
    oc = ov["conditions"]
    mp1 = next(p for p in mule if p["id"] == "MP1")
    mp2 = next(p for p in mule if p["id"] == "MP2")
    share = b.col(mp1["rule"]["feature"])
    split, lag = b.col(mp2["rule"]["split_feature"]), b.col(mp2["rule"]["lag_feature"])
    ratio = b.col(mp2["rule"]["ratio_feature"])
    wmin, wmax = oc["window_minutes"]["min"] * 60, oc["window_minutes"]["max"] * 60
    branches = []
    for alt in oc["any_of"]:
        if "split_count" in alt:
            sc = alt["split_count"]
            branches.append(
                f"({split} BETWEEN {num(sc['min'], 'override')} AND {num(sc['max'], 'override')}"
                f" AND {lag} BETWEEN {num(wmin, 'override')} AND {num(wmax, 'override')})")
        elif alt.get("single_forward"):
            cr = alt["commission_ratio"]
            branches.append(
                f"({split} = 1 AND {ratio} BETWEEN {num(cr['min'], 'override')} AND {num(cr['max'], 'override')})")
    if not branches:
        raise SystemExit("profile final.override.conditions.any_of has no usable branch")
    override_cond = (f"({share} >= {num(oc['forwarded_share_min'], 'override')}"
                     f" AND ({' OR '.join(branches)}))")

    # Sink override (final.sink_override), pass 2 only: it reads layer_links.
    so = profile["final"].get("sink_override") or {}
    sink_cond = "FALSE"
    if pass_no == 2 and so.get("enabled"):
        if num(so["floor"], "sink_override.floor") != num(ov["floor"], "override.floor"):
            raise SystemExit("final.sink_override.floor must equal final.override.floor "
                             "(one floor, one override_applied column)")
        sink_cond = (f"({b.col('is_receive_only')} AND {b.col('linked_sink_share')} >= "
                     f"{num(so['min_linked_inflow_share'], 'sink_override')})")

    band_whens = []
    for band in profile["final"]["bands"]:
        conds = []
        if "min_inclusive" in band:
            conds.append(f"final_index >= {num(band['min_inclusive'], 'band')}")
        if "max_exclusive" in band:
            conds.append(f"final_index < {num(band['max_exclusive'], 'band')}")
        band_whens.append(f"WHEN {' AND '.join(conds)} THEN {lit(band['name'])}")
    band_case = "CASE " + " ".join(band_whens) + " END"

    rv = profile["final"]["review_rule"]
    review_cond = (f"mule_index >= {num(rv['mule_index_min'], 'review')}"
                   f" AND trust_index >= {num(rv['trust_index_min'], 'review')}")

    param_points = "json_object(" + ", ".join(
        f"{lit(e['p']['id'])}, {e['name']}" for e in plan) + ")"

    # Reasons: the verdict first, then one line per parameter that scored.
    floor, thr = num(ov["floor"], "override.floor"), num(flag["threshold"], "flag.threshold")
    min_half = num(two["min_parameters_at_half"], "min_parameters_at_half")
    reasons = [
        "printf('Final %.1f = Mule %.1f reduced by Trust %.1f', final_index, mule_index, trust_index)",
        "CASE WHEN override_applied AND sink_hit THEN printf('Sink override: it only receives, and "
        "nearly all of that money is proven to come from flagged layering accounts, so Final was "
        "raised from %.1f to %.1f', final_raw, final_index)"
        " WHEN override_applied THEN printf('Pass-through override: nearly all incoming money is "
        "forwarded in the mule pattern, so Final was raised from %.1f to %.1f', final_raw, final_index) END",
        f"CASE WHEN is_flagged THEN printf('Flagged: Final is at or above %.0f and %d mule signals "
        f"reach at least half points', {thr}, n_half)"
        f" WHEN final_index >= {thr} THEN printf('Not flagged: Final is at or above %.0f but only %d "
        f"mule signal(s) reach half points (at least %.0f needed)', {thr}, n_half, {min_half}) END",
        f"CASE WHEN NOT is_flagged AND {review_cond} THEN 'Review list: high Mule index but also high Trust' END",
    ]
    for e in plan:
        if e["live"]:
            reasons.append(
                f"CASE WHEN {e['name']} > 0 THEN {b.phrase(e['p'])}"
                f" || printf(' [{e['p']['id']}: %.1f of {e['p']['weight']:g}]', {e['name']}) END")
    reasons.append(
        f"CASE WHEN \"tx_count\" < {min_tx} THEN printf('Fewer than %.0f transactions: "
        f"no history to earn trust, so Trust is 0', {min_tx}) END")
    pending = [e["p"]["id"] for e in plan if e["deferred"]]
    if pending:
        reasons.append(lit(f"{' and '.join(pending)} (neighbour risk) not scored yet: pass 2"))
    reason_list = ",\n".join("        " + r for r in reasons)

    # pop must select something even when no ratio rule is enabled.
    pop_columns = ", ".join(b.pop.values()) or "count(*) AS pop_n"

    sql = Template(SQL_PATH.read_text(encoding="utf-8")).substitute(
        out_table=out_table,
        source=source,
        sink_cond=sink_cond,
        pop_columns=pop_columns,
        point_columns=point_columns,
        mule_sum=index_sum("mule", profile["mule_index"]["total_weight"]),
        trust_sum=index_sum("trust", profile["trust_index"]["total_weight"]),
        half_count=half_count,
        override_cond=override_cond,
        discount=num(profile["final"]["trust_discount_factor"], "trust_discount_factor"),
        floor=floor,
        flag_threshold=thr,
        min_half=min_half,
        review_cond=review_cond,
        band_case=band_case,
        param_points=param_points,
        reason_list=reason_list,
    )
    return sql, b, plan


def sink_link_types(profile: dict) -> str:
    """Quoted link types the sink override counts (validated against the schema)."""
    so = profile["final"].get("sink_override") or {}
    types = so.get("link_types") or []
    bad = [t for t in types if t not in LINK_TYPES]
    if bad:
        raise SystemExit(f"final.sink_override.link_types has unknown types: {bad}")
    # An empty IN () list is not valid SQL; '' matches no link type.
    return ", ".join(lit(t) for t in types) or "''"


def build_roles_sql(profile: dict, b: Builder, plan: list[dict]) -> str:
    """Fill the @@ROLES section of pass2.sql from the profile's `roles` block.

    Each role-score component is a 0-1 fraction; the profile supplies its
    weight. A weight key this table does not know stops the run rather than
    being silently scored as 0.
    """
    roles = profile["roles"]
    mule = profile["mule_index"]["parameters"]
    mp2 = next(p for p in mule if p["id"] == "MP2")["rule"]
    alts = {a["name"]: a["receivers"] for a in mp2["pattern"]["any_of"]}
    split, lag = b.col(mp2["split_feature"]), b.col(mp2["lag_feature"])
    ratio = b.col(mp2["ratio_feature"])
    split_lo, split_hi = b.window_s("split_forward_minutes")
    _, single_hi = b.window_s("single_forward_max_minutes")

    def yes(cond: str) -> str:              # boolean test -> 0 / 1, NULL -> 0
        return f"CAST(coalesce({cond}, FALSE) AS DOUBLE)"

    def share(feature: str) -> str:         # a 0-1 share, NULL (n/a) -> 0
        return f"coalesce({b.col(feature)}, 0.0)"

    def receivers(name: str) -> str:
        r = alts[name]
        return yes(f"{split} BETWEEN {num(r['min'], 'receivers')} AND {num(r['max'], 'receivers')}")

    def commission(role: str) -> str:
        cr = profile["commission_ranges"][role]
        return yes(f"{ratio} BETWEEN {num(cr['min'], role)} AND {num(cr['max'], role)}")

    # Low activity is MP4's own judgement, as a fraction of its weight -- the
    # same measurement, never a second definition of "low".
    mp4 = next((e for e in plan if e["p"]["id"] == "MP4"), None)
    low_activity = (f"(mp4 / {num(mp4['p']['weight'], 'MP4.weight')})"
                    if mp4 and mp4["live"] else "0.0")

    vic = roles["scores"]["VICTIM"]
    few_out = num(profile["feature_rules"]["victim_like_max_outflows"], "victim_like_max_outflows")
    component = {
        "L1": {
            "victim_sourced_inflow": share("victim_inflow_share"),
            "split_3_to_6_per_inflow": receivers("split"),
            "commission_in_range": commission("L1"),
            "lag_in_split_window": yes(f"{lag} BETWEEN {split_lo} AND {split_hi}"),
            "flagged_outgoing_edges": share("flagged_out_share"),
        },
        "L2": {
            "inflow_from_l1_candidates": share("upstream_l1_share"),
            "single_forward_per_inflow": receivers("single"),
            "commission_in_range": commission("L2"),
            "lag_within_single_window": yes(f"{lag} BETWEEN 0.0 AND {single_hi}"),
            "flagged_outgoing_edges": share("flagged_out_share"),
        },
        "L3": {
            "receive_only": yes(b.col("is_receive_only")),
            "inflow_from_l2_candidates": share("upstream_l2_share"),
            "flagged_incoming_edges": share("flagged_in_share"),
            "low_activity": low_activity,
        },
        "VICTIM": {
            "send_only": yes(b.col("is_send_only")),
            "outflow_vs_population_median": yes(
                f"{b.col('n_out')} <= {few_out} AND {b.col('amount_vs_population')} >= "
                f"{num(vic['outflow_multiple_min'], 'VICTIM.outflow_multiple_min')}"),
            "payee_has_high_l1_score": "coalesce(p.payee_l1_share, 0.0)",
            "low_activity": low_activity,
        },
    }

    def score(role: str) -> str:
        spec = roles["scores"][role]
        unknown = [k for k in spec["weights"] if k not in component[role]]
        if unknown:
            raise SystemExit(f"roles.scores.{role} has weights this script cannot measure: {unknown}")
        terms = [f"{num(w, f'{role}.{k}')} * {component[role][k]}"
                 for k, w in spec["weights"].items()]
        return f"(({' + '.join(terms)}) * 100.0 / {num(spec['total_weight'], role + '.total_weight')})"

    unclassified = roles["unclassified_role"]
    if unclassified not in roles["allowed_roles"]:
        raise SystemExit(f"roles.unclassified_role {unclassified!r} is not an allowed role")
    if not isinstance(roles["requires_confirming_link"], bool):
        raise SystemExit("roles.requires_confirming_link must be true or false")

    sections = split_sections(Template(PASS2_SQL_PATH.read_text(encoding="utf-8")).substitute(
        sink_link_types=sink_link_types(profile),
        l1_expr=score("L1"), l2_expr=score("L2"), l3_expr=score("L3"),
        victim_expr=score("VICTIM"),
        role_threshold=num(roles["role_threshold"], "roles.role_threshold"),
        tie_margin=num(roles["tie_margin"], "roles.tie_margin"),
        victim_threshold=num(roles["victim_threshold"], "roles.victim_threshold"),
        requires_link="TRUE" if roles["requires_confirming_link"] else "FALSE",
        unclassified=unclassified,
        **freeze_params(profile),
    ))
    return sections["ROLES"]


def freeze_params(profile: dict) -> dict[str, str]:
    """The freeze rule (final.freeze) as SQL text for pass2.sql."""
    try:
        fz = profile["final"]["freeze"]
    except KeyError:
        raise SystemExit("profile has no final.freeze block -- reseed from engine\\config.yaml")
    return {
        "freeze_flag": "is_flagged" if fz["requires_flag"] else "TRUE",
        "freeze_confirmed": ("coalesce(role_confirmed, FALSE)"
                             if fz["requires_role_confirmed"] else "TRUE"),
        "freeze_min_holding": num(fz["min_holding_paise_exclusive"],
                                  "final.freeze.min_holding_paise_exclusive"),
    }


def split_sections(text: str) -> dict[str, str]:
    """Split a SQL file on its '-- @@SECTION' markers."""
    parts = re.split(r"(?m)^--\s*@@(\w+)\s*$", text)
    return {parts[i].upper(): parts[i + 1] for i in range(1, len(parts), 2)}


def run_pass2(con: duckdb.DuckDBPyConnection, profile_id: str,
              profile: dict) -> tuple[Builder, list[dict]]:
    """Build score_roles (temp) from score_pass1 and layer_links."""
    n_links = con.execute(
        "SELECT count(*) FROM layer_links WHERE profile_id = ?", [profile_id]).fetchone()[0]
    if not n_links:
        raise SystemExit(
            f"no layer_links for profile {profile_id} -- run engine\\scoring.py --pass 1 "
            "and engine\\links.py first")
    # The links must have been proven between accounts THIS pass 1 flags;
    # otherwise the profile or the features changed since links.py ran.
    stale = con.execute(
        "SELECT count(*) FROM layer_links l JOIN score_pass1 s ON s.acct_id = l.from_acct "
        "WHERE l.profile_id = ? AND l.from_role IN ('L1', 'L2') AND NOT s.is_flagged",
        [profile_id]).fetchone()[0]
    if stale:
        raise SystemExit(
            f"{stale} layer_links start at an account pass 1 no longer flags -- the links are "
            "stale; rerun engine\\scoring.py --pass 1 and engine\\links.py")

    # sink_link_types is the only placeholder the first two sections use; the
    # role expressions are filled in later, once the pass-2 Builder exists.
    blank = dict.fromkeys(
        ("l1_expr", "l2_expr", "l3_expr", "victim_expr", "role_threshold", "tie_margin",
         "victim_threshold", "requires_link", "unclassified",
         "freeze_flag", "freeze_confirmed", "freeze_min_holding"), "NULL")
    sections = split_sections(Template(PASS2_SQL_PATH.read_text(encoding="utf-8")).substitute(
        sink_link_types=sink_link_types(profile), **blank))
    for name in ("RELATIONS", "SOURCE", "ROLES"):
        if name not in sections:
            raise SystemExit(f"{PASS2_SQL_PATH.name} is missing section @@{name}")

    con.execute(sections["RELATIONS"], [profile_id, profile_id])
    con.execute(sections["SOURCE"])
    cols2 = {r[0] for r in con.execute("DESCRIBE features_p2").fetchall()}
    sql2, builder, plan = build_sql(profile, cols2, 2, "features_p2", "score_pass2")
    con.execute(sql2)
    con.execute(build_roles_sql(profile, builder, plan))
    return builder, plan


def report_roles(con: duckdb.DuckDBPyConnection, profile_id: str) -> None:
    """Print the role summary. Aggregates only."""
    print("\nroles:")
    rows = con.execute(
        "SELECT coalesce(role, '(none)'), count(*), count(*) FILTER (WHERE role_confirmed),"
        "       count(*) FILTER (WHERE is_flagged) "
        "FROM scores WHERE profile_id = ? GROUP BY 1 ORDER BY 1", [profile_id]).fetchall()
    for role, n, conf, fl in rows:
        tail = "" if role == "(none)" else f"   confirmed {conf:,} ({conf / n:.1%})"
        print(f"    {role:<18} {n:>7,}   (flagged {fl:,}){tail}")
    mules = [(n, c) for role, n, c, _ in rows if role in ("L1", "L2", "L3", "UNCLASSIFIED_MULE")]
    n_mule, n_conf = sum(n for n, _ in mules), sum(c for _, c in mules)
    if n_mule:
        print(f"    role_confirmed share among flagged accounts : {n_conf:,} of {n_mule:,}"
              f" ({n_conf / n_mule:.1%})")
    n_role = sum(n for role, n, _, _ in rows if role != "(none)")
    n_role_conf = sum(c for role, _, c, _ in rows if role != "(none)")
    if n_role:
        print(f"    role_confirmed share among all roles (incl. VICTIM) : {n_role_conf:,} of"
              f" {n_role:,} ({n_role_conf / n_role:.1%})")

    print("\nfreeze_recommended by role (holding = received - sent; bands are not read):")
    for role, n, fz, held, fz_held in con.execute(
            "SELECT role, count(*), count(*) FILTER (WHERE freeze_recommended),"
            "       sum(holding_paise) / 100.0,"
            "       coalesce(sum(holding_paise) FILTER (WHERE freeze_recommended), 0) / 100.0 "
            "FROM scores WHERE profile_id = ? AND is_flagged GROUP BY ROLLUP (role) "
            "ORDER BY role NULLS LAST", [profile_id]).fetchall():
        print(f"    {role or 'TOTAL':<18} flagged {n:>6,}   freeze {fz:>6,}"
              f"   holding Rs {held:>14,.0f}   freeze holding Rs {fz_held:>14,.0f}")

    print("\nrole scores of flagged accounts (min / median / max by assigned role):")
    for role, a, b_, c in con.execute(
            "SELECT role, "
            " printf('%.0f / %.0f / %.0f', min(l1_score), median(l1_score), max(l1_score)),"
            " printf('%.0f / %.0f / %.0f', min(l2_score), median(l2_score), max(l2_score)),"
            " printf('%.0f / %.0f / %.0f', min(l3_score), median(l3_score), max(l3_score)) "
            "FROM scores WHERE profile_id = ? AND is_flagged GROUP BY role ORDER BY role",
            [profile_id]).fetchall():
        print(f"    {role:<18} L1 {a:<16} L2 {b_:<16} L3 {c}")

    print("\nneighbour_risk (min / median / max) by role:")
    for role, txt in con.execute(
            "SELECT coalesce(s.role, '(none)'), printf('%.1f / %.1f / %.1f',"
            " min(f.neighbour_risk), median(f.neighbour_risk), max(f.neighbour_risk)) "
            "FROM scores s JOIN features f USING (acct_id) WHERE s.profile_id = ? "
            "GROUP BY 1 ORDER BY 1", [profile_id]).fetchall():
        print(f"    {role:<18} {txt}")


def report(con: duckdb.DuckDBPyConnection, profile_id: str, plan: list[dict],
           work: str = "score_pass1") -> None:
    """Print the score summary. Aggregates only. `work` is the temp table."""
    def q(sql: str) -> list:
        return con.execute(sql, [profile_id]).fetchall()

    n, flagged, flagged_busy, busy, ov_applied = q(
        "SELECT count(*), count(*) FILTER (WHERE s.is_flagged),"
        "       count(*) FILTER (WHERE s.is_flagged AND f.tx_count >= 50),"
        "       count(*) FILTER (WHERE f.tx_count >= 50),"
        "       count(*) FILTER (WHERE s.override_applied) "
        "FROM scores s JOIN features f USING (acct_id) WHERE s.profile_id = ?")[0]
    ov_hit, sink_hit = con.execute(
        f"SELECT count(*) FILTER (WHERE override_hit), count(*) FILTER (WHERE sink_hit) "
        f"FROM {work}").fetchone()
    print(f"\nscores rows  : {n:,}")
    print(f"flagged      : {flagged:,}")
    print(f"flagged among accounts with tx_count >= 50 : {flagged_busy:,} of {busy:,}")
    print(f"override     : condition met by {ov_hit:,} ({sink_hit:,} of them the sink"
          f" override); lifted Final for {ov_applied:,}")

    print("\nband counts:")
    for band, c, fl in q(
            "SELECT band, count(*), count(*) FILTER (WHERE is_flagged) FROM scores "
            "WHERE profile_id = ? GROUP BY band ORDER BY max(final_index) DESC"):
        print(f"    {band:<16} {c:>7,}   (flagged {fl:,})")

    print("\nFinal index distribution (10-point bins):")
    rows = dict(q(
        "SELECT least(CAST(floor(final_index / 10) AS INTEGER), 9), count(*) "
        "FROM scores WHERE profile_id = ? GROUP BY 1"))
    for i in range(10):
        hi, close = ("100", "]") if i == 9 else (f"{(i + 1) * 10}", ")")
        print(f"    [{i * 10:>2}, {hi:>3}{close} {rows.get(i, 0):>7,}")

    print("\nmule signals at half points or more (two-signal rule):")
    for k, c in con.execute(
            f"SELECT n_half, count(*) FROM {work} GROUP BY 1 ORDER BY 1").fetchall():
        print(f"    {k} signals      {c:>7,}")

    print("\nper parameter (accounts at full / at half-or-more / above zero):")
    for e in plan:
        p = e["p"]
        if not e["live"]:
            print(f"    {p['id']:<4} {e['state']}")
            continue
        w = float(p["weight"])
        full, half, pos = con.execute(
            f"SELECT count(*) FILTER (WHERE {e['name']} >= {w} - {EPS}),"
            f"       count(*) FILTER (WHERE {e['name']} >= {w} * 0.5 - {EPS}),"
            f"       count(*) FILTER (WHERE {e['name']} > 0) FROM {work}").fetchone()
        print(f"    {p['id']:<4} w={w:>4g}  full {full:>6,}  half+ {half:>6,}  >0 {pos:>6,}   {e['state']}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fill `scores` for the active profile (pass 1, or pass 2 with roles).")
    ap.add_argument("--pass", dest="pass_no", type=int, choices=(1, 2), default=2,
                    help="1 = behaviour only (run before links.py); "
                         "2 = neighbour risk, final scores and roles (default)")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to score (default: {DEFAULT_DB})")
    args = ap.parse_args()

    t0 = time.perf_counter()

    for p in (SQL_PATH, PASS2_SQL_PATH):
        if not p.is_file():
            raise SystemExit(f"SQL not found: {p}")
    if not args.db.is_file():
        raise SystemExit(f"database not found: {args.db} -- run engine\\ingest.py first")

    con = duckdb.connect(str(args.db))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")

        for t, step in (("tx", "ingest.py"), ("features", "features.py"),
                        ("scores", "apply_schema.py"), ("layer_links", "apply_schema.py")):
            if not con.execute(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema='main' AND table_name=?", [t]).fetchone()[0]:
                raise SystemExit(f"table {t} is missing -- run engine\\{step} first")

        profile_id, profile = active_profile(con)
        feature_cols = {r[0] for r in con.execute("DESCRIBE features").fetchall()}
        sql, builder, plan = build_sql(profile, feature_cols)

        print(f"database     : {args.db}")
        print(f"profile      : {profile_id}")
        print(f"pass         : {args.pass_no}")
        print("gates        :")
        for g in profile.get("reliability_gates", []):
            print(f"    {g['id']:<24} {g['status']:<6} gates {g['gates']}")

        t_sql = time.perf_counter()
        con.execute(sql)

        # Pass 2 always starts from a fresh pass 1 (above), never from scores
        # an earlier pass-2 run wrote.
        work = "score_pass1"
        role_cols = ""
        if args.pass_no == 2:
            builder, plan = run_pass2(con, profile_id, profile)
            work = "score_roles"
            role_cols = (", l1_score, l2_score, l3_score, victim_score, role, role_confirmed, "
                         "candidate_roles, upstream_role_share, downstream_role_share, "
                         "holding_paise, freeze_recommended")
        for note in builder.notes:
            print(f"  NOTE       : {note}")

        # Refill this profile only; other profiles' rows are untouched (Section 9).
        con.execute("BEGIN")
        try:
            if args.pass_no == 2:
                # Fill the three pass-2 placeholders of `features`.
                con.execute(
                    "UPDATE features SET neighbour_risk = r.neighbour_risk, "
                    "upstream_l1_share = r.upstream_l1_share, "
                    "upstream_l2_share = r.upstream_l2_share "
                    "FROM rel r WHERE features.acct_id = r.acct_id")
            con.execute("DELETE FROM scores WHERE profile_id = ?", [profile_id])
            con.execute(
                "INSERT INTO scores (acct_id, profile_id, "
                + ", ".join(SCORE_COLUMNS) + ", "
                "mule_index, trust_index, final_index, band, is_flagged, "
                f"override_applied, param_points, reasons{role_cols}) "
                "SELECT acct_id, ?, " + ", ".join(SCORE_COLUMNS) + ", "
                "mule_index, trust_index, final_index, band, is_flagged, "
                f"override_applied, param_points, reasons{role_cols} FROM {work}",
                [profile_id])
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
        sql_seconds = time.perf_counter() - t_sql

        n_rows = con.execute(
            "SELECT count(*) FROM scores WHERE profile_id = ?", [profile_id]).fetchone()[0]
        n_feat = con.execute("SELECT count(*) FROM features").fetchone()[0]
        if n_rows != n_feat:
            raise SystemExit(f"scores has {n_rows} rows for {profile_id} but features has {n_feat}")

        # Every account must have a decision; only pass-2 parameters may be NULL.
        # A flagged account always has a role and role scores; an unflagged one
        # never has a mule role.
        if args.pass_no == 2:
            bad_role = con.execute(
                "SELECT count(*) FROM scores WHERE profile_id = ? AND ("
                " (is_flagged AND (role IS NULL OR role = 'VICTIM' OR l1_score IS NULL"
                "                  OR l2_score IS NULL OR l3_score IS NULL))"
                " OR (NOT is_flagged AND (coalesce(role, 'VICTIM') <> 'VICTIM'"
                "                         OR victim_score IS NULL))"
                " OR mp7 IS NULL OR t5 IS NULL"
                " OR holding_paise IS NULL OR freeze_recommended IS NULL)",
                [profile_id]).fetchone()[0]
            if bad_role:
                raise SystemExit(f"{bad_role} scores rows break the role / pass-2 invariants")
        bad = con.execute(
            "SELECT count(*) FROM scores WHERE profile_id = ? AND "
            "(mule_index IS NULL OR trust_index IS NULL OR final_index IS NULL "
            " OR band IS NULL OR is_flagged IS NULL OR override_applied IS NULL "
            " OR final_index < 0 OR final_index > 100)", [profile_id]).fetchone()[0]
        if bad:
            raise SystemExit(f"{bad} scores rows have a NULL or out-of-range decision column")

        report(con, profile_id, plan, work)
        if args.pass_no == 2:
            report_roles(con, profile_id)
            print("\nring_id is NULL for every account: run engine\\rings.py next.")
        else:
            print("\nnext: engine\\links.py, then engine\\scoring.py (pass 2).")
        for t in ("score_pass1", "score_pass2", "score_roles", "rel", "features_p2"):
            con.execute(f"DROP TABLE IF EXISTS {t}")

        print(f"\nsql seconds  : {sql_seconds:.2f}")
        print(f"total seconds: {time.perf_counter() - t0:.2f}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
