"""Generic, deterministic, read-only anomaly tools (PROJECT_CONTEXT 16, stage 1).

Six tools over the tx / accounts layout. Each returns a JSON-ready dict:
question, sql, result (numbers), verdict, explanation.

Rules of this module:
- Column names are resolved through a whitelist; nothing a caller passes is
  ever placed into SQL.
- Raw narration text is never returned: free text is reduced to a shape mask.
- Every tolerance comes from audit_rules.json, overridden by the optional
  `audit_rules` block of the active scoring profile.
- The database is only read. Python only loops over aggregated rows.
"""
from __future__ import annotations

import functools
import json
import math
import re
import textwrap
from dataclasses import dataclass
from pathlib import Path

import duckdb

RULES_PATH = Path(__file__).resolve().parent / "audit_rules.json"

CLEAN, TRAP, SIGNAL, NOISE, INCONCLUSIVE = "CLEAN", "TRAP", "SIGNAL", "NOISE", "INCONCLUSIVE"
VERDICTS = (CLEAN, TRAP, SIGNAL, NOISE, INCONCLUSIVE)


@dataclass(frozen=True)
class Col:
    table: str          # tx | accounts
    expr: str           # SQL over alias t
    kind: str           # id | cat | bool | num | ts | text
    needs: tuple        # physical columns the expression reads


# The whitelist. kind decides which tools accept the column; `text` and `id`
# columns are only ever reported as shapes and counts, never as values.
COLUMNS: dict[str, Col] = {
    "tx_key":         Col("tx", "t.tx_key", "id", ("tx_key",)),
    "tx_id":          Col("tx", "t.tx_id", "id", ("tx_id",)),
    "utr":            Col("tx", "t.utr", "id", ("utr",)),
    "src":            Col("tx", "t.src", "id", ("src",)),
    "dst":            Col("tx", "t.dst", "id", ("dst",)),
    "amount_paise":   Col("tx", "t.amount_paise", "num", ("amount_paise",)),
    "ts":             Col("tx", "t.ts", "ts", ("ts",)),
    "ts_hour":        Col("tx", "hour(t.ts)", "cat", ("ts",)),
    "mode":           Col("tx", "t.mode", "cat", ("mode",)),
    "narration":      Col("tx", "t.narration", "text", ("narration",)),
    "narr_rail":      Col("tx", "split_part(t.narration, '/', 1)", "cat", ("narration",)),
    "ip":             Col("tx", "t.ip", "text", ("ip",)),
    "device":         Col("tx", "t.device", "cat", ("device",)),
    "is_foreign_ip":  Col("tx", "t.is_foreign_ip", "bool", ("is_foreign_ip",)),
    "is_reserved_ip": Col("tx", "t.is_reserved_ip", "bool", ("is_reserved_ip",)),
    "is_headless":    Col("tx", "t.is_headless", "bool", ("is_headless",)),
    "is_dup_tx_id":   Col("tx", "t.is_dup_tx_id", "bool", ("is_dup_tx_id",)),
    "acct_id":        Col("accounts", "t.acct_id", "id", ("acct_id",)),
    "acct_no":        Col("accounts", "t.acct_no", "id", ("acct_no",)),
    "ifsc":           Col("accounts", "t.ifsc", "text", ("ifsc",)),
    "bank":           Col("accounts", "t.bank", "cat", ("bank",)),
    "ifsc_bank":      Col("accounts", "substr(t.ifsc, 1, 4)", "cat", ("ifsc",)),
    "first_seen":     Col("accounts", "t.first_seen", "ts", ("first_seen",)),
    "last_seen":      Col("accounts", "t.last_seen", "ts", ("last_seen",)),
}

# Columns that say what a record IS (surrogate keys and derived flags left out).
# check_uniqueness uses them to tell exact copies from colliding identifiers.
ROW_IDENTITY = {
    "tx": ("src", "dst", "amount_paise", "ts", "mode", "narration", "ip", "device"),
    "accounts": ("acct_no", "ifsc", "bank"),
}

# Account-level groups for find_outliers: name -> (expression, tables it reads).
ACCOUNT_GROUPS = {
    "flow_class": ("CASE WHEN f.is_send_only THEN 'send_only' WHEN f.is_receive_only "
                   "THEN 'receive_only' ELSE 'two_way' END", ("features",)),
    "bank":       ("a.bank", ("accounts",)),
    "is_flagged": ("s.is_flagged", ("scores",)),
    "band":       ("s.band", ("scores",)),
    "role":       ("s.role", ("scores",)),
}

NUMERIC_TYPES = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE", "DECIMAL")
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_LABEL = re.compile(r"[A-Za-z0-9_.:\- ]+\Z")


class ToolInputError(ValueError):
    """A request the tool cannot answer (unknown column, wrong kind, no table)."""


# --- connection, rules, catalog ----------------------------------------------

def connect(db_path: str) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(db_path), read_only=True)


def _catalog(con) -> dict[str, dict[str, str]]:
    rows = con.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = 'main'"
    ).fetchall()
    cat: dict[str, dict[str, str]] = {}
    for table, column, dtype in rows:
        cat.setdefault(table, {})[column] = dtype
    return cat


def active_profile(con) -> tuple[str | None, dict]:
    if "scoring_profiles" not in _catalog(con):
        return None, {}
    row = con.execute(
        "SELECT profile_id, definition FROM scoring_profiles WHERE is_active LIMIT 1"
    ).fetchone()
    if row is None:
        return None, {}
    return row[0], json.loads(row[1]) if row[1] else {}


def load_rules(con) -> dict:
    """audit_rules.json, overridden key by key by the active profile's `audit_rules`."""
    rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    rules.pop("_doc", None)
    profile_id, definition = active_profile(con)
    override = definition.get("audit_rules") or {}
    rules.update(override)
    rules["_source"] = {
        "file": RULES_PATH.name,
        "profile_id": profile_id,
        "profile_overrides": sorted(override),
    }
    return rules


def _resolve(con, column: str) -> Col:
    col = COLUMNS.get(column)
    if col is None:
        raise ToolInputError(f"'{_label(str(column), 40)}' is not a whitelisted column.")
    have = _catalog(con).get(col.table, {})
    missing = [c for c in col.needs if c not in have]
    if missing:
        raise ToolInputError(f"{col.table}.{missing[0]} does not exist in this database.")
    return col


def list_columns(con) -> dict[str, str]:
    """Whitelisted columns present in this database: name -> kind."""
    cat = _catalog(con)
    return {
        name: col.kind
        for name, col in COLUMNS.items()
        if all(c in cat.get(col.table, {}) for c in col.needs)
    }


def list_features(con) -> list[str]:
    """Numeric per-account features available to find_outliers."""
    feats = _catalog(con).get("features", {})
    return [
        c for c, dtype in feats.items()
        if c != "acct_id" and _IDENT.match(c) and dtype.split("(")[0] in NUMERIC_TYPES
    ]


def list_groups(con) -> dict[str, list[str]]:
    cat = _catalog(con)
    tx_groups = [n for n, k in list_columns(con).items() if k in ("cat", "bool") and COLUMNS[n].table == "tx"]
    acct_groups = [g for g, (_, tables) in ACCOUNT_GROUPS.items() if all(t in cat for t in tables)]
    return {"tx": tx_groups, "accounts": acct_groups}


# --- small helpers -----------------------------------------------------------

def _sql(text: str) -> str:
    return textwrap.dedent(text).strip()


def _js(v):
    if v is None or isinstance(v, (str, bool, int)):
        return v
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else round(v, 6)
    if hasattr(v, "isoformat"):
        return v.isoformat(sep=" ", timespec="seconds")
    try:
        return float(v) if float(v) != int(v) else int(v)
    except (TypeError, ValueError):
        return str(v)


def _label(v, max_len: int) -> str | None:
    """A category label safe to return; anything else is reduced to its shape."""
    if v is None:
        return None
    s = str(v)
    if len(s) <= max_len and _LABEL.match(s):
        return s
    mask = re.sub(r"[^\x20-\x7E]+", "U", re.sub(r"[0-9]+", "9", re.sub(r"[A-Za-z]+", "A", s)))
    return "<" + mask[:max_len] + ">"


def _share(n, total) -> float:
    return round(n / total, 6) if total else 0.0


def _pct(x: float) -> str:
    return f"{100 * x:.2f}%"


def _finding(tool, args, question, sql, result, verdict, explanation) -> dict:
    assert verdict in VERDICTS
    return {
        "tool": tool,
        "args": args,
        "question": question,
        "sql": sql,
        "result": result,
        "verdict": verdict,
        "explanation": explanation,
    }


def _tool(fn):
    """Turn a request the tool cannot answer into an INCONCLUSIVE finding."""
    @functools.wraps(fn)
    def wrapper(con, *args, **kwargs):
        try:
            return fn(con, *args, **kwargs)
        except ToolInputError as e:
            shown = {f"arg{i}": _label(str(a), 40) for i, a in enumerate(args)}
            return _finding(fn.__name__, shown, None, None, {}, INCONCLUSIVE, str(e))
    return wrapper


# --- 1. profile_shapes --------------------------------------------------------

@_tool
def profile_shapes(con, column: str, rules: dict | None = None) -> dict:
    rules = rules or load_rules(con)
    col = _resolve(con, column)
    top = int(rules["max_shapes"])
    sql = _sql(f"""
        WITH s AS (
            SELECT regexp_replace(regexp_replace(regexp_replace(
                       CAST({col.expr} AS VARCHAR),
                       '[A-Za-z]+', 'A', 'g'), '[0-9]+', '9', 'g'), '[^ -~]+', 'U', 'g') AS shape,
                   length(CAST({col.expr} AS VARCHAR)) AS len
            FROM {col.table} t
        )
        SELECT shape, count(*) AS n, min(len) AS min_len, max(len) AS max_len,
               count(*) OVER () AS n_shapes, sum(count(*)) OVER () AS n_rows
        FROM s
        GROUP BY shape
        ORDER BY n DESC, shape
        LIMIT {top + 1}
    """)
    rows = con.execute(sql).fetchall()
    n_rows = int(rows[0][5]) if rows else 0
    n_null = sum(r[1] for r in rows if r[0] is None)
    shapes = [r for r in rows if r[0] is not None]
    n_shapes = (int(rows[0][4]) if rows else 0) - (1 if n_null else 0)
    n_valid = n_rows - n_null
    rare_max = rules["rare_share_max"]
    listed = [
        {"shape": r[0], "rows": r[1], "share": _share(r[1], n_valid), "min_len": r[2], "max_len": r[3]}
        for r in shapes[:top]
    ]
    rare = [s for s in listed if s["share"] < rare_max]
    result = {
        "n_rows": n_rows,
        "n_null": n_null,
        "n_shapes": n_shapes,
        "n_rare_shapes": len(rare),
        "rows_in_rare_shapes": sum(s["rows"] for s in rare),
        "shapes": listed,
    }
    if n_valid == 0:
        verdict, why = INCONCLUSIVE, f"{column} is empty (all {n_rows:,} rows NULL)."
    elif n_shapes > top:
        verdict, why = NOISE, f"{column} has {n_shapes:,} shapes (more than {top}): free-form, no fixed format."
    elif n_shapes == 1:
        verdict, why = CLEAN, f"{column} has one shape, {listed[0]['shape']}, on every row."
    elif rare:
        verdict = SIGNAL
        why = (f"{column} has {n_shapes} shapes; {len(rare)} are rare "
               f"({result['rows_in_rare_shapes']:,} rows, each under {_pct(rare_max)}).")
    else:
        verdict, why = INCONCLUSIVE, f"{column} mixes {n_shapes} common shapes; none is rare."
    return _finding("profile_shapes", {"column": column},
                    f"Which formats does {column} take, and are any of them rare?",
                    sql, result, verdict, why)


# --- 2. check_uniqueness ------------------------------------------------------

@_tool
def check_uniqueness(con, column: str, rules: dict | None = None) -> dict:
    rules = rules or load_rules(con)
    col = _resolve(con, column)
    have = _catalog(con)[col.table]
    others = [c for c in ROW_IDENTITY[col.table] if c in have and c not in col.needs]
    row_hash = "hash(" + ", ".join(f"t.{c}" for c in others) + ")" if others else "0"
    sql = _sql(f"""
        WITH g AS (
            SELECT {col.expr} AS v, count(*) AS n, count(DISTINCT {row_hash}) AS n_records
            FROM {col.table} t
            GROUP BY 1
        )
        SELECT coalesce(sum(n), 0)                                        AS n_rows,
               coalesce(sum(n) FILTER (v IS NULL), 0)                     AS n_null,
               count(*) FILTER (v IS NOT NULL)                            AS n_distinct,
               count(*) FILTER (v IS NOT NULL AND n > 1)                  AS n_dup_values,
               coalesce(sum(n) FILTER (v IS NOT NULL AND n > 1), 0)       AS n_rows_in_dups,
               coalesce(max(n) FILTER (v IS NOT NULL), 0)                 AS max_repeats,
               count(*) FILTER (v IS NOT NULL AND n > 1 AND n_records > 1) AS n_colliding_values
        FROM g
    """)
    n_rows, n_null, n_distinct, n_dup, n_dup_rows, max_rep, n_coll = (int(x) for x in con.execute(sql).fetchone())
    n_valid = n_rows - n_null
    ratio = _share(n_distinct, n_valid)
    result = {
        "n_rows": n_rows,
        "n_null": n_null,
        "n_distinct": n_distinct,
        "distinct_ratio": ratio,
        "n_dup_values": n_dup,
        "n_rows_in_dups": n_dup_rows,
        "max_repeats": max_rep,
        "n_colliding_values": n_coll,
        "n_exact_copy_values": n_dup - n_coll,
    }
    if n_valid == 0:
        verdict, why = INCONCLUSIVE, f"{column} is empty (all {n_rows:,} rows NULL)."
    elif n_dup == 0:
        verdict, why = CLEAN, f"{column} is unique: {n_distinct:,} values on {n_valid:,} rows."
    elif ratio >= rules["near_unique_min_ratio"]:
        verdict = TRAP
        why = (f"{column} looks like an identifier but {n_dup:,} values repeat across {n_dup_rows:,} rows; "
               f"{n_coll:,} of them label different records, so it cannot be used as a key.")
    else:
        verdict = NOISE
        why = (f"{column} is not an identifier: {n_distinct:,} values on {n_valid:,} rows "
               f"({_pct(ratio)} distinct).")
    return _finding("check_uniqueness", {"column": column},
                    f"Is {column} unique, and do repeated values label the same record?",
                    sql, result, verdict, why)


# --- 3. check_consistency -----------------------------------------------------

@_tool
def check_consistency(con, col_a: str, col_b: str, rules: dict | None = None) -> dict:
    rules = rules or load_rules(con)
    a, b = _resolve(con, col_a), _resolve(con, col_b)
    if a.table != b.table:
        raise ToolInputError(f"{col_a} ({a.table}) and {col_b} ({b.table}) are not in the same table.")
    for name, c in ((col_a, a), (col_b, b)):
        if c.kind not in ("cat", "bool"):
            raise ToolInputError(f"{name} is not a categorical column; check_consistency compares categories.")
    max_pairs = int(rules["max_pairs"])
    sql = _sql(f"""
        SELECT a, b, count(*) AS n
        FROM (
            SELECT CAST({a.expr} AS VARCHAR) AS a, CAST({b.expr} AS VARCHAR) AS b
            FROM {a.table} t
        )
        WHERE a IS NOT NULL AND b IS NOT NULL
        GROUP BY a, b
        ORDER BY n DESC, a, b
        LIMIT {max_pairs + 1}
    """)
    cells = con.execute(sql).fetchall()
    args = {"col_a": col_a, "col_b": col_b}
    question = f"Do {col_a} and {col_b} agree, or does one tell us nothing about the other?"
    if len(cells) > max_pairs:
        return _finding("check_consistency", args, question, sql, {"n_pairs": f">{max_pairs}"}, INCONCLUSIVE,
                        f"More than {max_pairs} value pairs: too many categories to compare.")
    total = sum(n for _, _, n in cells)
    if total == 0:
        return _finding("check_consistency", args, question, sql, {"n_rows": 0}, INCONCLUSIVE,
                        "No row has both values.")
    row_tot: dict[str, int] = {}
    col_tot: dict[str, int] = {}
    for va, vb, n in cells:
        row_tot[va] = row_tot.get(va, 0) + n
        col_tot[vb] = col_tot.get(vb, 0) + n
    k = min(len(row_tot), len(col_tot))
    chi2 = total * (sum(n * n / (row_tot[va] * col_tot[vb]) for va, vb, n in cells) - 1)
    cramers_v = math.sqrt(max(chi2, 0.0) / (total * (k - 1))) if k > 1 else None
    a_fixes_b = len(cells) == len(row_tot)
    b_fixes_a = len(cells) == len(col_tot)
    shared = sorted(set(row_tot) & set(col_tot))
    n_mismatch = sum(n for va, vb, n in cells if va != vb) if shared else None
    lab = int(rules["label_max_len"])
    result = {
        "n_rows": total,
        "n_values_a": len(row_tot),
        "n_values_b": len(col_tot),
        "n_pairs": len(cells),
        "shared_values": [_label(v, lab) for v in shared],
        "n_mismatch": n_mismatch,
        "mismatch_share": _share(n_mismatch, total) if shared else None,
        "cramers_v": _js(cramers_v),
        "a_determines_b": a_fixes_b,
        "b_determines_a": b_fixes_a,
        "pairs": [
            {"a": _label(va, lab), "b": _label(vb, lab), "rows": n, "share": _share(n, total)}
            for va, vb, n in cells[: int(rules["max_shapes"])]
        ],
    }
    indep_v = rules["independence_max_cramers_v"]
    independent = cramers_v is not None and cramers_v < indep_v
    if shared:
        mm = result["mismatch_share"]
        if n_mismatch == 0:
            verdict, why = CLEAN, f"{col_a} and {col_b} agree on all {total:,} rows."
        elif mm < rules["rare_share_max"]:
            verdict = SIGNAL
            why = f"{col_a} and {col_b} disagree on only {n_mismatch:,} rows ({_pct(mm)}): rare exceptions."
        else:
            verdict = TRAP
            tail = (f" and are statistically independent (Cramer's V {cramers_v:.3f})" if independent
                    else f" (Cramer's V {cramers_v:.3f})" if cramers_v is not None else "")
            why = (f"{col_a} and {col_b} disagree on {n_mismatch:,} of {total:,} rows ({_pct(mm)}){tail}: "
                   f"neither can validate the other.")
    elif cramers_v is None:
        verdict, why = NOISE, "One of the two columns is constant: nothing to compare."
    elif a_fixes_b or b_fixes_a:
        first, second = (col_a, col_b) if a_fixes_b else (col_b, col_a)
        verdict, why = CLEAN, f"{first} fully determines {second}: the two are consistent."
    elif independent:
        verdict = NOISE
        why = f"{col_a} and {col_b} are statistically independent (Cramer's V {cramers_v:.3f})."
    else:
        verdict = INCONCLUSIVE
        why = f"{col_a} and {col_b} are related (Cramer's V {cramers_v:.3f}) but neither determines the other."
    return _finding("check_consistency", args, question, sql, result, verdict, why)


# --- 4. check_ranges ----------------------------------------------------------

def _limit_values(limits: dict, max_len: int) -> str:
    out = []
    for grp, lim in sorted(limits.items()):
        if _label(grp, max_len) != grp:
            raise ToolInputError("A range rule names a group that is not a plain label.")
        lo, hi = lim.get("min"), lim.get("max")
        lo_sql = "NULL" if lo is None else repr(float(lo))
        hi_sql = "NULL" if hi is None else repr(float(hi))
        out.append(f"('{grp}', CAST({lo_sql} AS DOUBLE), CAST({hi_sql} AS DOUBLE))")
    return ", ".join(out)


@_tool
def check_ranges(con, column: str, rules: dict | None = None) -> dict:
    rules = rules or load_rules(con)
    col = _resolve(con, column)
    if col.kind not in ("num", "ts"):
        raise ToolInputError(f"{column} is not a number or a timestamp; check_ranges needs one of those.")
    numeric = col.kind == "num"
    extra = ("count(*) FILTER (x = 0) AS n_zero, count(*) FILTER (x < 0) AS n_negative, "
             "quantile_cont(x, 0.01) AS p01, quantile_cont(x, 0.5) AS p50, quantile_cont(x, 0.99) AS p99"
             if numeric else "date_diff('day', min(x), max(x)) AS span_days")
    sql = _sql(f"""
        SELECT count(*) AS n_rows, count(x) AS n_valid, min(x) AS min_value, max(x) AS max_value,
               {extra}
        FROM (SELECT {col.expr} AS x FROM {col.table} t)
    """)
    res = con.execute(sql)
    stats = dict(zip([d[0] for d in res.description], (_js(v) for v in res.fetchone())))
    n_rows, n_valid = stats["n_rows"], stats["n_valid"]
    stats["n_null"] = n_rows - n_valid
    rule = (rules.get("ranges") or {}).get(column) if numeric else None
    violations = []
    sqls = [sql]
    if rule and n_valid:
        lo, hi = rule.get("min"), rule.get("max")
        if lo is not None or hi is not None:
            lo_sql = "NULL" if lo is None else repr(float(lo))
            hi_sql = "NULL" if hi is None else repr(float(hi))
            g_sql = _sql(f"""
                SELECT count(*) FILTER (x < CAST({lo_sql} AS DOUBLE)) AS n_below,
                       count(*) FILTER (x > CAST({hi_sql} AS DOUBLE)) AS n_above
                FROM (SELECT {col.expr} AS x FROM {col.table} t)
            """)
            sqls.append(g_sql)
            below, above = con.execute(g_sql).fetchone()
            violations.append({"group": "(all)", "min": lo, "max": hi, "rows": n_valid,
                               "n_below": below, "n_above": above,
                               "share": _share(below + above, n_valid)})
        if rule.get("by") and rule.get("limits"):
            by = _resolve(con, rule["by"])
            if by.table != col.table or by.kind not in ("cat", "bool"):
                raise ToolInputError(f"Range rule for {column} groups by an unusable column.")
            values = _limit_values(rule["limits"], int(rules["label_max_len"]))
            b_sql = _sql(f"""
                SELECT lim.grp, lim.lo, lim.hi, count(*) AS n_rows,
                       count(*) FILTER (d.x < lim.lo) AS n_below,
                       count(*) FILTER (d.x > lim.hi) AS n_above
                FROM (SELECT {col.expr} AS x, CAST({by.expr} AS VARCHAR) AS g FROM {col.table} t) d
                JOIN (VALUES {values}) AS lim(grp, lo, hi) ON d.g = lim.grp
                WHERE d.x IS NOT NULL
                GROUP BY lim.grp, lim.lo, lim.hi
                ORDER BY lim.grp
            """)
            sqls.append(b_sql)
            for grp, g_lo, g_hi, n, below, above in con.execute(b_sql).fetchall():
                violations.append({"group": f"{rule['by']}={grp}", "min": _js(g_lo), "max": _js(g_hi),
                                   "rows": n, "n_below": below, "n_above": above,
                                   "share": _share(below + above, n)})
    broken = [v for v in violations if v["n_below"] + v["n_above"] > 0]
    result = {**stats, "rules_checked": len(violations), "limits": violations}
    full_sql = ";\n\n".join(sqls)
    if n_valid == 0:
        verdict, why = INCONCLUSIVE, f"{column} is empty (all {n_rows:,} rows NULL)."
    elif broken:
        worst = max(broken, key=lambda v: (v["share"], v["group"]))
        n_bad = worst["n_below"] + worst["n_above"]
        side = "below the minimum" if worst["n_below"] >= worst["n_above"] else "above the maximum"
        systemic = worst["share"] >= rules["systemic_violation_min_share"]
        verdict = TRAP if systemic else SIGNAL
        tail = ("the field ignores this real-world limit" if systemic else "rare rule-breaking rows")
        more = f" ({len(broken)} limits broken in all)" if len(broken) > 1 else ""
        why = (f"{column}: {n_bad:,} of {worst['rows']:,} rows in {worst['group']} are {side} "
               f"({_pct(worst['share'])}); {tail}{more}.")
    elif stats["n_null"] or (numeric and stats["n_negative"]):
        verdict = SIGNAL
        why = (f"{column}: {stats['n_null']:,} NULL and "
               f"{stats.get('n_negative', 0):,} negative values.")
    elif violations:
        verdict, why = CLEAN, f"{column} stays inside all {len(violations)} configured limits."
    else:
        verdict = CLEAN
        why = f"{column} has no NULLs{' or negatives' if numeric else ''}; no limit is configured for it."
    return _finding("check_ranges", {"column": column},
                    f"Is {column} inside its valid range and the limits that apply to it?",
                    full_sql, result, verdict, why)


# --- 5. find_outliers ---------------------------------------------------------

def _outlier_source(con, feature: str, group: str) -> tuple[str, str, str]:
    """(feature expression, group expression, FROM clause) for one level."""
    cat = _catalog(con)
    if feature in COLUMNS and COLUMNS[feature].kind == "num":
        f = _resolve(con, feature)
        if group not in COLUMNS:
            raise ToolInputError(f"{feature} is per transaction; '{_label(str(group), 40)}' is not a transaction group.")
        g = _resolve(con, group)
        if g.table != f.table or g.kind not in ("cat", "bool"):
            raise ToolInputError(f"{group} cannot group {feature}.")
        return f.expr, g.expr, f"{f.table} t"
    if feature not in list_features(con):
        raise ToolInputError(f"'{_label(str(feature), 40)}' is not a numeric feature of this database.")
    if group not in ACCOUNT_GROUPS:
        raise ToolInputError(f"{feature} is per account; '{_label(str(group), 40)}' is not an account group.")
    g_expr, tables = ACCOUNT_GROUPS[group]
    for t in tables:
        if t not in cat:
            raise ToolInputError(f"Table {t} does not exist in this database.")
    src = "features f"
    if "accounts" in tables:
        src += " JOIN accounts a ON a.acct_id = f.acct_id"
    if "scores" in tables:
        src += (" JOIN scores s ON s.acct_id = f.acct_id AND s.profile_id = "
                "(SELECT profile_id FROM scoring_profiles WHERE is_active LIMIT 1)")
    return f"f.{feature}", g_expr, src


@_tool
def find_outliers(con, feature: str, group: str, rules: dict | None = None) -> dict:
    rules = rules or load_rules(con)
    f_expr, g_expr, src = _outlier_source(con, feature, group)
    k = float(rules["outlier_iqr_k"])
    sql = _sql(f"""
        WITH d AS (
            SELECT CAST({f_expr} AS DOUBLE) AS x, CAST({g_expr} AS VARCHAR) AS g
            FROM {src}
        ),
        q AS (
            SELECT quantile_cont(x, 0.25) AS q1, quantile_cont(x, 0.5) AS med, quantile_cont(x, 0.75) AS q3
            FROM d
        ),
        fence AS (
            SELECT q1, med, q3, q1 - {k!r} * (q3 - q1) AS lo, q3 + {k!r} * (q3 - q1) AS hi FROM q
        )
        SELECT d.g, count(*) AS n, count(d.x) AS n_valid, median(d.x) AS group_median,
               count(*) FILTER (d.x < fence.lo) AS n_low, count(*) FILTER (d.x > fence.hi) AS n_high,
               fence.q1, fence.med, fence.q3, fence.lo, fence.hi
        FROM d CROSS JOIN fence
        GROUP BY d.g, fence.q1, fence.med, fence.q3, fence.lo, fence.hi
        ORDER BY d.g NULLS LAST
    """)
    rows = con.execute(sql).fetchall()
    args = {"feature": feature, "group": group}
    question = f"Are extreme values of {feature} spread evenly, or do they sit in one {group} group?"
    n_valid = sum(r[2] for r in rows)
    if n_valid == 0:
        return _finding("find_outliers", args, question, sql,
                        {"n_rows": sum(r[1] for r in rows), "n_valid": 0}, INCONCLUSIVE,
                        f"{feature} is NULL everywhere (not applicable): nothing to compare.")
    q1, med, q3, lo, hi = rows[0][6:11]
    n_out = sum(r[4] + r[5] for r in rows)
    overall = n_out / n_valid
    lab = int(rules["label_max_len"])
    min_n = int(rules["outlier_min_group_size"])
    groups = []
    for g, n, nv, gmed, n_low, n_high, *_ in rows:
        share = (n_low + n_high) / nv if nv else None
        groups.append({
            "group": _label(g, lab) if g is not None else "(null)",
            "n": n, "n_valid": nv, "n_null": n - nv, "median": _js(gmed),
            "n_low": n_low, "n_high": n_high,
            "outlier_share": _js(share),
            "lift": _js(share / overall) if share is not None and overall else None,
        })
    result = {
        "n_rows": sum(r[1] for r in rows), "n_valid": n_valid, "n_null": sum(r[1] - r[2] for r in rows),
        "q1": _js(q1), "median": _js(med), "q3": _js(q3), "fence_low": _js(lo), "fence_high": _js(hi),
        "n_outliers": n_out, "outlier_share": _js(overall), "groups": groups,
    }
    eligible = [g for g in groups if g["n_valid"] >= min_n]
    if n_out == 0:
        verdict, why = CLEAN, f"{feature} has no value outside the {k:g}x IQR fences."
    elif len(eligible) < 2:
        verdict = INCONCLUSIVE
        why = (f"{feature} has {n_out:,} outliers but fewer than two {group} groups of at least "
               f"{min_n} to compare.")
    else:
        top = max(eligible, key=lambda g: (g["lift"], g["group"]))
        if (top["lift"] >= rules["outlier_signal_min_lift"]
                and top["outlier_share"] >= rules["outlier_signal_min_group_share"]):
            verdict = SIGNAL
            why = (f"{feature} outliers concentrate in {group}={top['group']}: {_pct(top['outlier_share'])} "
                   f"of that group against {_pct(overall)} overall ({top['lift']:.1f}x).")
        else:
            verdict = NOISE
            why = (f"{feature} has {n_out:,} outliers ({_pct(overall)}) spread across {group} groups "
                   f"(highest lift {top['lift']:.1f}x, {group}={top['group']}): they do not separate a group.")
    return _finding("find_outliers", args, question, sql, result, verdict, why)


# --- 6. check_distribution ----------------------------------------------------

def _equal_split(counts: list[int]) -> tuple[float | None, float | None]:
    """(chi-square per degree of freedom against equal shares, relative spread)."""
    if len(counts) < 2:
        return None, None
    mean = sum(counts) / len(counts)
    chi2 = sum((n - mean) ** 2 for n in counts) / mean
    return chi2 / (len(counts) - 1), (max(counts) - min(counts)) / mean


@_tool
def check_distribution(con, column: str, rules: dict | None = None) -> dict:
    rules = rules or load_rules(con)
    col = _resolve(con, column)
    if col.kind in ("cat", "bool"):
        v_expr, what, where = f"CAST({col.expr} AS VARCHAR)", "value", ""
    elif col.kind == "num":
        v_expr, what = f"left(CAST(abs({col.expr}) AS VARCHAR), 1)", "first digit"
        where = f"WHERE {col.expr} <> 0"
    else:
        raise ToolInputError(f"{column} is not categorical or numeric; use profile_shapes or check_ranges.")
    max_cat = int(rules["max_categories"])
    sql = _sql(f"""
        SELECT v, count(*) AS n, count(*) OVER () AS n_values, sum(count(*)) OVER () AS n_rows
        FROM (SELECT {v_expr} AS v FROM {col.table} t {where})
        WHERE v IS NOT NULL
        GROUP BY v
        ORDER BY n DESC, v
        LIMIT {max_cat + 1}
    """)
    rows = con.execute(sql).fetchall()
    args = {"column": column}
    question = f"Is the spread of {column} ({what}) natural, artificially even, or hiding rare values?"
    if not rows:
        return _finding("check_distribution", args, question, sql, {"n_rows": 0}, INCONCLUSIVE,
                        f"{column} has no usable value.")
    n_values, total = int(rows[0][2]), int(rows[0][3])
    if n_values > max_cat:
        return _finding("check_distribution", args, question, sql,
                        {"n_rows": total, "n_values": n_values}, INCONCLUSIVE,
                        f"{column} has {n_values:,} values (more than {max_cat}): not a category.")
    lab = int(rules["label_max_len"])
    rare_max = rules["rare_share_max"]
    values = [{"value": _label(v, lab), "rows": n, "share": _share(n, total)} for v, n, _, _ in rows]
    numeric = col.kind == "num"
    major = values if numeric else [v for v in values if v["share"] >= rare_max]
    rare = [] if numeric else [v for v in values if v["share"] < rare_max]
    chi2_dof, spread = _equal_split([v["rows"] for v in major])
    rare_chi2_dof, _ = _equal_split([v["rows"] for v in rare])
    max_chi2 = rules["uniform_max_chi2_per_dof"]
    even = chi2_dof is not None and chi2_dof <= max_chi2
    rare_even = rare_chi2_dof is not None and rare_chi2_dof <= max_chi2
    result = {
        "n_rows": total, "n_values": n_values,
        "n_major_values": len(major), "n_rare_values": len(rare),
        "rows_in_rare_values": sum(v["rows"] for v in rare),
        "major_chi2_per_dof_vs_equal": _js(chi2_dof),
        "major_relative_spread": _js(spread),
        "major_split_is_even": even,
        "rare_split_is_even": rare_even,
        "values": values,
    }
    benford_mad = None
    if numeric:
        seen = {v["value"]: v["share"] for v in values}
        benford_mad = sum(abs(seen.get(str(d), 0.0) - math.log10(1 + 1 / d)) for d in range(1, 10)) / 9
        result["benford_mad"] = _js(benford_mad)
    rare_note = ""
    if rare:
        rare_note = (f" Rare: {', '.join(v['value'] for v in rare[:5])} "
                     f"({result['rows_in_rare_values']:,} rows"
                     + (", near-identical counts)." if rare_even else ")."))
    if n_values == 1:
        verdict, why = NOISE, f"{column} is constant: it carries no information."
    elif even:
        verdict = TRAP
        why = (f"{column}: {len(major)} {what}s split evenly within random noise ({_pct(1 / len(major))} each, "
               f"spread {_pct(spread)}), as a random generator would; do not read meaning into it.{rare_note}")
    elif numeric:
        if benford_mad <= rules["benford_max_mad"]:
            verdict, why = CLEAN, f"{column} first digits follow the natural (Benford) curve (MAD {benford_mad:.4f})."
        else:
            verdict = INCONCLUSIVE
            why = (f"{column} first digits are neither even nor natural (Benford MAD {benford_mad:.4f}): "
                   f"amounts may be bounded or synthetic.")
    elif rare:
        verdict, why = SIGNAL, f"{column} is dominated by {len(major)} main value(s).{rare_note}"
    else:
        verdict, why = CLEAN, f"{column} is spread unevenly across {n_values} values with no rare one."
    return _finding("check_distribution", args, question, sql, result, verdict, why)


TOOLS = {
    "profile_shapes": profile_shapes,
    "check_uniqueness": check_uniqueness,
    "check_consistency": check_consistency,
    "check_ranges": check_ranges,
    "find_outliers": find_outliers,
    "check_distribution": check_distribution,
}
