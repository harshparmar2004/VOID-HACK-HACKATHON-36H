"""Run every auditor tool over the relevant columns and write audit.json.

    .venv\\Scripts\\python.exe auditor\\run_audit.py --db data\\case.duckdb

The database is opened read-only. Columns a database does not have are skipped.
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

from auditor import tools  # noqa: E402

DEFAULT_OUT = ROOT / "reports" / "json" / "audit.json"

SHAPE_KINDS = ("id", "text", "cat")
SHAPE_SKIP = ("tx_key", "src", "dst", "acct_id", "ts_hour")
UNIQUE_COLUMNS = ("tx_key", "tx_id", "utr", "acct_id", "acct_no")
CONSISTENCY_PAIRS = (
    ("narr_rail", "mode"),
    ("device", "is_headless"),
    ("mode", "device"),
    ("is_foreign_ip", "is_headless"),
    ("bank", "ifsc_bank"),
)
TX_OUTLIER_GROUPS = ("mode", "device", "is_headless", "is_foreign_ip")
ACCOUNT_OUTLIER_GROUP = "flow_class"


def plan(con) -> list[tuple[str, tuple]]:
    """(tool name, arguments) for every check this database supports."""
    cols = tools.list_columns(con)
    groups = tools.list_groups(con)
    calls: list[tuple[str, tuple]] = []
    calls += [("profile_shapes", (c,)) for c, k in cols.items() if k in SHAPE_KINDS and c not in SHAPE_SKIP]
    calls += [("check_uniqueness", (c,)) for c in UNIQUE_COLUMNS if c in cols]
    calls += [("check_consistency", (a, b)) for a, b in CONSISTENCY_PAIRS if a in cols and b in cols]
    calls += [("check_ranges", (c,)) for c, k in cols.items() if k in ("num", "ts")]
    calls += [("check_distribution", (c,)) for c, k in cols.items() if k in ("cat", "bool", "num")]
    calls += [("find_outliers", (c, g)) for c, k in cols.items() if k == "num"
              for g in TX_OUTLIER_GROUPS if g in groups["tx"]]
    if ACCOUNT_OUTLIER_GROUP in groups["accounts"]:
        calls += [("find_outliers", (f, ACCOUNT_OUTLIER_GROUP)) for f in tools.list_features(con)]
    return calls


def run(db_path: str, out_path: Path) -> int:
    t0 = time.perf_counter()
    findings, failures = [], []
    con = tools.connect(db_path)
    try:
        rules = tools.load_rules(con)
        cat = tools._catalog(con)
        counts = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("tx", "accounts") if t in cat}
        sha = None
        if "ingest_meta" in cat:
            row = con.execute("SELECT file_sha256 FROM ingest_meta ORDER BY load_id DESC LIMIT 1").fetchone()
            sha = row[0] if row else None
        for name, args in plan(con):
            fid = f"{name}:{','.join(args)}"
            try:
                finding = tools.TOOLS[name](con, *args, rules=rules)
            except duckdb.Error as e:
                failures.append({"id": fid, "error": f"{type(e).__name__}: {str(e)[:200]}"})
                continue
            findings.append({"id": fid, **finding})
    finally:
        con.close()

    runtime = round(time.perf_counter() - t0, 3)
    summary = {v: sum(1 for f in findings if f["verdict"] == v) for v in tools.VERDICTS}
    payload = {
        "run": {
            "db": Path(db_path).name,
            "file_sha256": sha,
            "rows": counts,
            "duckdb_version": duckdb.__version__,
            "runtime_s": runtime,
            "n_findings": len(findings),
            "n_failures": len(failures),
        },
        "rules": rules,
        "summary": summary,
        "findings": findings,
        "failures": failures,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"runtime {runtime}s  findings {len(findings)}  failures {len(failures)}  -> {out_path}")
    print("  ".join(f"{v} {n}" for v, n in summary.items()))
    print(f"{'VERDICT':<13} {'CHECK':<52} EXPLANATION")
    for f in findings:
        why = f["explanation"]
        print(f"{f['verdict']:<13} {f['id']:<52} {why if len(why) <= 150 else why[:147] + '...'}")
    for f in failures:
        print(f"FAILED        {f['id']:<52} {f['error']}")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True, help="path to case.duckdb (opened read-only)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output JSON path")
    a = ap.parse_args()
    return run(a.db, Path(a.out))


if __name__ == "__main__":
    sys.exit(main())
