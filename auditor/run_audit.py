"""Run every auditor tool over the relevant columns and write audit.json.

    .venv\\Scripts\\python.exe auditor\\run_audit.py --db data\\case.duckdb

Two layers (--layer raw | engine | both, default both):
- raw:    reads only tx and accounts, so it works before the engine has run.
          Includes the funnel's Stage A.
- engine: checks on features and scores, gate consistency against the raw
          layer's do_not_use list, score sanity, and the funnel's Stage B.
Every finding and funnel stage records the layer it came from.

The database is opened read-only. Columns a database does not have are skipped.
--limits, --roles and --lineage name domain files (see audits\\), with defaults there.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from auditor import engine_checks, funnel, tools  # noqa: E402

DEFAULT_OUT = ROOT / "reports" / "json" / "audit.json"
DOMAIN_DIR = ROOT / "audits"
DEFAULT_LIMITS = DOMAIN_DIR / "payment_limits.json"
DEFAULT_ROLES = DOMAIN_DIR / "funnel_roles.json"
DEFAULT_LINEAGE = DOMAIN_DIR / "feature_lineage.json"

LAYERS = ("raw", "engine")
RAW_TABLES = ("tx", "accounts")

SHAPE_KINDS = ("id", "text", "cat")
SHAPE_SKIP = ("tx_key", "src", "dst", "acct_id")
UNIQUE_COLUMNS = ("tx_key", "tx_id", "utr", "acct_id", "acct_no")
CONSISTENCY_PAIRS = (
    ("narr_rail", "mode"),
    ("device", "is_headless"),
    ("mode", "device"),
    ("is_foreign_ip", "is_headless"),
    ("bank", "ifsc_bank"),
)
ADJACENCY_PAIRS = (("dst", "src"), ("src", "src"), ("dst", "dst"))
TX_OUTLIER_GROUPS = ("mode", "device", "is_headless", "is_foreign_ip")
ACCOUNT_OUTLIER_GROUP = "flow_class"

DO_NOT_USE_SEMANTICS = (
    "Off-only. Each entry names a field or pattern that must not be used as evidence, with the test "
    "that found it. The list can only switch a signal off: it never enables a signal and carries no "
    "weight, threshold or value for scoring."
)


def plan_raw(con) -> list[tuple[str, tuple]]:
    """(tool name, arguments) for every check on tx and accounts alone."""
    cols = tools.list_columns(con)
    groups = tools.list_groups(con)
    ordered = [c for c in cols if tools.COLUMNS[c].table in tools.POSITION]
    calls: list[tuple[str, tuple]] = []
    calls += [("profile_shapes", (c,)) for c, k in cols.items() if k in SHAPE_KINDS and c not in SHAPE_SKIP]
    calls += [("check_uniqueness", (c,)) for c in UNIQUE_COLUMNS if c in cols]
    calls += [("check_consistency", (a, b)) for a, b in CONSISTENCY_PAIRS if a in cols and b in cols]
    calls += [("check_ranges", (c,)) for c, k in cols.items() if k in ("num", "ts")]
    calls += [("check_distribution", (c,)) for c, k in cols.items() if k in ("cat", "bool", "num")]
    calls += [("check_time_pattern", (c,)) for c in ordered if cols[c] == "ts"]
    calls += [("check_row_position", (c,)) for c in ordered if cols[c] in ("cat", "bool")]
    calls += [("check_adjacency", (a, b)) for a, b in ADJACENCY_PAIRS if a in ordered and b in ordered]
    calls += [("find_outliers", (c, g)) for c, k in cols.items() if k == "num"
              for g in TX_OUTLIER_GROUPS if g in groups["tx"]]
    return calls


def plan_engine(con) -> list[tuple[str, tuple]]:
    """(tool name, arguments) for every check on the engine's features and scores."""
    if ACCOUNT_OUTLIER_GROUP not in tools.list_groups(con)["accounts"]:
        return []
    return [("find_outliers", (f, ACCOUNT_OUTLIER_GROUP)) for f in tools.list_features(con)]


PLANS = {"raw": plan_raw, "engine": plan_engine}


def _existing(path) -> str | None:
    return str(path) if path and Path(path).is_file() else None


def run(db_path: str, out_path: Path, limits_path: str | None = None, roles_path: str | None = None,
        layers: tuple[str, ...] = LAYERS, lineage_path: str | None = None) -> int:
    t0 = time.perf_counter()
    findings, failures, rules = [], [], {}
    con = tools.connect(db_path)
    try:
        cat = tools._catalog(con)
        counts = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in RAW_TABLES if t in cat}
        sha = None
        if "ingest_meta" in cat:
            row = con.execute("SELECT file_sha256 FROM ingest_meta ORDER BY load_id DESC LIMIT 1").fetchone()
            sha = row[0] if row else None
        for layer in layers:
            # the raw layer never reads the scoring profile, so it gives the same
            # answer before and after the engine has run
            rules[layer] = tools.load_rules(con, limits_path, use_profile=layer == "engine")
            for name, args in PLANS[layer](con):
                fid = f"{name}:{','.join(args)}"
                try:
                    finding = tools.TOOLS[name](con, *args, rules=rules[layer])
                except duckdb.Error as e:
                    failures.append({"id": fid, "layer": layer, "error": f"{type(e).__name__}: {str(e)[:200]}"})
                    continue
                findings.append({"id": fid, "layer": layer, **finding})
        if "engine" in layers:
            raw = [f for f in findings if f["layer"] == "raw"] if "raw" in layers else None
            try:
                findings += engine_checks.gate_consistency(
                    con, raw, engine_checks.load_lineage(lineage_path), rules["engine"])
                findings += engine_checks.score_sanity(con, rules["engine"])
            except duckdb.Error as e:
                failures.append({"id": "engine_checks", "layer": "engine",
                                 "error": f"{type(e).__name__}: {str(e)[:200]}"})
        try:
            flow = funnel.run(con, layers, funnel.load_role_map(roles_path), rules[layers[-1]])
        except duckdb.Error as e:
            flow = {"semantics": funnel.SEMANTICS, "groups": list(funnel.GROUPS), "summary": {}, "stages": []}
            failures.append({"id": "funnel", "layer": layers[-1], "error": f"{type(e).__name__}: {str(e)[:200]}"})
    finally:
        con.close()

    runtime = round(time.perf_counter() - t0, 3)
    summary = {v: sum(1 for f in findings if f["verdict"] == v) for v in tools.VERDICTS}
    by_layer = {
        layer: {
            "findings": {v: sum(1 for f in findings if f["layer"] == layer and f["verdict"] == v)
                         for v in tools.VERDICTS},
            "funnel": {v: sum(1 for s in flow["stages"] if s["layer"] == layer and s["verdict"] == v)
                       for v in tools.VERDICTS},
        }
        for layer in layers
    }
    do_not_use = [{"finding": f["id"], **entry} for f in findings for entry in f["do_not_use"]]
    payload = {
        "run": {
            "db": Path(db_path).name,
            "file_sha256": sha,
            "rows": counts,
            "duckdb_version": duckdb.__version__,
            "runtime_s": runtime,
            "layers": list(layers),
            "n_findings": len(findings),
            "n_funnel_stages": len(flow["stages"]),
            "n_failures": len(failures),
        },
        "rules": rules,
        "summary": summary,
        "summary_by_layer": by_layer,
        "do_not_use": {"semantics": DO_NOT_USE_SEMANTICS, "entries": do_not_use},
        "findings": findings,
        "funnel": flow,
        "failures": failures,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"runtime {runtime}s  layers {'+'.join(layers)}  findings {len(findings)}  "
          f"funnel stages {len(flow['stages'])}  failures {len(failures)}  -> {out_path}")
    for layer, block in by_layer.items():
        for part, tally in block.items():
            print(f"{layer:<7} {part:<9} " + "  ".join(f"{v} {n}" for v, n in tally.items()))
    print(f"{'LAYER':<7} {'VERDICT':<13} {'CHECK':<52} EXPLANATION")
    for f in findings + flow["stages"]:
        why = f["explanation"]
        print(f"{f['layer']:<7} {f['verdict']:<13} {f['id']:<52} {why if len(why) <= 150 else why[:147] + '...'}")
    for f in failures:
        print(f"{f['layer']:<7} FAILED        {f['id']:<52} {f['error']}")
    print(f"do_not_use ({len(do_not_use)}):")
    for e in do_not_use:
        print(f"  [{e['test']}] {e['name']}")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True, help="path to case.duckdb (opened read-only)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output JSON path")
    ap.add_argument("--layer", choices=(*LAYERS, "both"), default="both",
                    help="raw: tx and accounts only; engine: features and scores; both (default)")
    ap.add_argument("--limits", default=_existing(DEFAULT_LIMITS), help="JSON file of domain amount limits")
    ap.add_argument("--roles", default=_existing(DEFAULT_ROLES),
                    help="JSON file mapping funnel groups to the roles scoring should give them")
    ap.add_argument("--lineage", default=_existing(DEFAULT_LINEAGE),
                    help="JSON file saying which fields each engine feature reads")
    a = ap.parse_args()
    layers = LAYERS if a.layer == "both" else (a.layer,)
    return run(a.db, Path(a.out), a.limits, a.roles, layers, a.lineage)


if __name__ == "__main__":
    sys.exit(main())
