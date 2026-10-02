"""Prove the auditor's raw layer runs before the engine has run.

    .venv\\Scripts\\python.exe audits\\check_auditor_raw_layer.py --db data\\case.duckdb

Copies only tx and accounts into a scratch database in the temp folder, runs
run_audit.py --layer raw on it and on the full database, compares the two, and
deletes the scratch files. The source database is only ever attached read-only.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from auditor import run_audit  # noqa: E402

RAW_TABLES = ("tx", "accounts")


def build_scratch(src_db: str, scratch_db: Path) -> list[str]:
    con = duckdb.connect(str(scratch_db))
    try:
        con.execute(f"ATTACH '{Path(src_db).as_posix()}' AS src (READ_ONLY)")
        for t in RAW_TABLES:
            con.execute(f"CREATE TABLE {t} AS SELECT * FROM src.{t}")
        con.execute("DETACH src")
        return [r[0] for r in con.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY 1").fetchall()]
    finally:
        con.close()


def raw_audit(db: str, out: Path) -> tuple[int, dict]:
    with contextlib.redirect_stdout(io.StringIO()):
        code = run_audit.run(db, out, run_audit._existing(run_audit.DEFAULT_LIMITS),
                             run_audit._existing(run_audit.DEFAULT_ROLES), ("raw",))
    return code, json.loads(out.read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True, help="path to case.duckdb (attached read-only)")
    a = ap.parse_args()
    t0 = time.perf_counter()
    tmp = Path(tempfile.mkdtemp(prefix="auditor_raw_"))
    try:
        tables = build_scratch(a.db, tmp / "scratch.duckdb")
        code, scratch = raw_audit(str(tmp / "scratch.duckdb"), tmp / "scratch.json")
        full_code, full = raw_audit(a.db, tmp / "full.json")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    stages = scratch["funnel"]["stages"]
    checks = [
        ("scratch database holds only tx and accounts", tables == sorted(RAW_TABLES), str(tables)),
        ("raw layer exits 0 with no failures", code == 0 and not scratch["failures"],
         f"exit {code}, {len(scratch['failures'])} failures"),
        ("raw layer produced findings", len(scratch["findings"]) > 0, f"{len(scratch['findings'])} findings"),
        ("every finding is layer raw", all(f["layer"] == "raw" for f in scratch["findings"]), ""),
        ("funnel ran Stage A only", bool(stages) and all(s["stage"] == "A" and s["layer"] == "raw" for s in stages),
         f"{len(stages)} stages"),
        ("no funnel stage is INCONCLUSIVE", all(s["verdict"] != "INCONCLUSIVE" for s in stages), ""),
        ("raw rules read no scoring profile", scratch["rules"]["raw"]["_source"]["profile_id"] is None, ""),
        ("same findings as the raw layer on the full database",
         full_code == 0 and scratch["findings"] == full["findings"], ""),
        ("same funnel as the raw layer on the full database", scratch["funnel"] == full["funnel"], ""),
        ("scratch files deleted", not tmp.exists(), str(tmp)),
    ]
    print(f"runtime {time.perf_counter() - t0:.2f}s  scratch tables {tables}  findings {len(scratch['findings'])}  "
          f"funnel stages {len(stages)}")
    print("raw findings  " + "  ".join(f"{v} {n}" for v, n in scratch["summary"].items()))
    failed = 0
    for name, ok, note in checks:
        print(f"{'PASS' if ok else 'FAIL':<5} {name}" + (f"  ({note})" if note and not ok else ""))
        failed += not ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
