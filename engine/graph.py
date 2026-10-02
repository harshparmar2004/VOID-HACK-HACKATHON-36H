"""
engine/graph.py -- Step 5a of the Abhedya-Chakra pipeline: CSR graph arrays.

    tx + accounts  ->  <db folder>\\graph\\*.npy  +  manifest.json

The transaction graph in compressed-sparse-row form, indexed by acct_id, so the
trace can read "every transfer out of / into account A" as one array slice
without touching the database (PROJECT_CONTEXT.md Sections 9 and 11).

    out_ptr[a] : out_ptr[a+1]   slice of the OUTGOING transfers of account a
        out_dst   receiver acct_id        out_tx    tx_key
        out_ts    ts_sec                  out_amt   amount_paise
    in_ptr[a] : in_ptr[a+1]     slice of the INCOMING transfers of account a
        in_src    sender acct_id          in_tx     tx_key
        in_ts     ts_sec                  in_amt    amount_paise

Inside each account's slice the transfers are in TIME order (ts_sec), so a time
window is a binary search. tx_key is carried as the transaction's unique key
(guardrail 10) and is only the LAST tie-break of that sort, after the amount --
it never decides which transfers a window contains (Section 4.6).

The arrays are rebuilt only when the manifest's load_id differs from the latest
ingest_meta row (or a file is missing, or --force is given).

Rules: one DuckDB query per direction and vectorised NumPy -- no Python loop
over transactions (Section 8 rule 2). The connection is opened read-only and
closed in a finally block.

Usage:
    .venv\\Scripts\\python.exe engine\\graph.py
    .venv\\Scripts\\python.exe engine\\graph.py --db %TEMP%\\case_review.duckdb
    .venv\\Scripts\\python.exe engine\\graph.py --force
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import duckdb
import numpy as np

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"

MEMORY_LIMIT = "3GB"
MANIFEST = "manifest.json"

# (file stem, tx column, dtype) per direction; `ptr` and the neighbour array
# are handled separately.
ALIGNED = (("tx", "tx_key", np.int64), ("ts", "ts_sec", np.int64),
           ("amt", "amount_paise", np.int64))
ARRAYS = ("out_ptr", "out_dst", "out_tx", "out_ts", "out_amt",
          "in_ptr", "in_src", "in_tx", "in_ts", "in_amt")


def graph_dir(db: Path) -> Path:
    """The arrays live beside the database they were built from."""
    return Path(db).resolve().parent / "graph"


def latest_load(con: duckdb.DuckDBPyConnection) -> tuple[int, str]:
    """(load_id, file_sha256) of the most recent ingest."""
    row = con.execute(
        "SELECT load_id, file_sha256 FROM ingest_meta ORDER BY load_id DESC LIMIT 1").fetchone()
    if row is None:
        raise SystemExit("ingest_meta is empty -- run engine\\ingest.py first")
    return int(row[0]), row[1]


def read_manifest(gdir: Path) -> dict | None:
    path = gdir / MANIFEST
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None             # unreadable manifest = no usable build


def is_current(gdir: Path, load_id: int) -> bool:
    m = read_manifest(gdir)
    return (m is not None and m.get("load_id") == load_id
            and all((gdir / f"{a}.npy").is_file() for a in ARRAYS))


def _direction(con: duckdb.DuckDBPyConnection, key: str, other: str,
               n_accounts: int) -> dict[str, np.ndarray]:
    """One adjacency direction: rows grouped by `key`, time-ordered inside."""
    cols = con.execute(
        f"SELECT {key}, {other}, tx_key, ts_sec, amount_paise FROM tx "
        f"ORDER BY {key}, ts_sec, amount_paise, tx_key").fetchnumpy()
    owner = np.asarray(cols[key], dtype=np.int64)
    if len(owner) and (owner.min() < 0 or owner.max() >= n_accounts):
        raise SystemExit(f"tx.{key} holds an acct_id outside accounts (0..{n_accounts - 1})")
    ptr = np.zeros(n_accounts + 1, dtype=np.int64)
    np.cumsum(np.bincount(owner, minlength=n_accounts), out=ptr[1:])
    out = {"ptr": ptr, other: np.asarray(cols[other], dtype=np.int32)}
    for stem, col, dtype in ALIGNED:
        out[stem] = np.asarray(cols[col], dtype=dtype)
    return out


def build(db: Path, force: bool = False, quiet: bool = False) -> dict:
    """Build the arrays if they are missing or stale. Returns the manifest."""
    db = Path(db)
    if not db.is_file():
        raise SystemExit(f"database not found: {db} -- run engine\\ingest.py first")
    gdir = graph_dir(db)

    t0 = time.perf_counter()
    con = duckdb.connect(str(db), read_only=True)
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        load_id, sha = latest_load(con)
        if not force and is_current(gdir, load_id):
            manifest = read_manifest(gdir)
            if not quiet:
                print(f"graph        : up to date (load_id {load_id},"
                      f" {manifest['rows']:,} rows, built {manifest['built_at']})")
            return manifest

        # acct_id must be dense 0..n-1: it is the CSR row index.
        n_accounts, lo, hi = con.execute(
            "SELECT count(*), min(acct_id), max(acct_id) FROM accounts").fetchone()
        if n_accounts == 0 or lo != 0 or hi != n_accounts - 1:
            raise SystemExit(
                f"accounts.acct_id is not dense 0..n-1 (count {n_accounts}, min {lo}, max {hi})")

        out = _direction(con, "src", "dst", n_accounts)
        inn = _direction(con, "dst", "src", n_accounts)
        rows = int(con.execute("SELECT count(*) FROM tx").fetchone()[0])
    finally:
        con.close()

    if len(out["tx"]) != rows or len(inn["tx"]) != rows:
        raise SystemExit("CSR build lost rows: "
                         f"tx {rows}, out {len(out['tx'])}, in {len(inn['tx'])}")

    gdir.mkdir(parents=True, exist_ok=True)
    # Drop the manifest first: a build interrupted half-way must not look current.
    (gdir / MANIFEST).unlink(missing_ok=True)
    files = {"out_ptr": out["ptr"], "out_dst": out["dst"], "out_tx": out["tx"],
             "out_ts": out["ts"], "out_amt": out["amt"],
             "in_ptr": inn["ptr"], "in_src": inn["src"], "in_tx": inn["tx"],
             "in_ts": inn["ts"], "in_amt": inn["amt"]}
    for name, arr in files.items():
        np.save(gdir / f"{name}.npy", arr)

    manifest = {
        "load_id": load_id,
        "file_sha256": sha,
        "rows": rows,
        "accounts": int(n_accounts),
        "build_seconds": round(time.perf_counter() - t0, 3),
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "arrays": {name: {"dtype": str(arr.dtype), "length": int(len(arr))}
                   for name, arr in files.items()},
    }
    (gdir / MANIFEST).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if not quiet:
        size_mb = sum((gdir / f"{a}.npy").stat().st_size for a in ARRAYS) / 1e6
        print(f"graph        : built {rows:,} transfers x 2 directions,"
              f" {n_accounts:,} accounts, {size_mb:.0f} MB in {gdir}")
        print(f"load_id      : {load_id}")
        print(f"build seconds: {manifest['build_seconds']:.2f}")
    return manifest


def load(db: Path) -> dict[str, np.ndarray]:
    """Load the arrays into memory (building them first if they are stale)."""
    build(db, quiet=True)
    gdir = graph_dir(db)
    return {name: np.load(gdir / f"{name}.npy") for name in ARRAYS}



def main() -> None:
    ap = argparse.ArgumentParser(description="Build the CSR graph arrays from tx.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to read (default: {DEFAULT_DB}); "
                         "arrays go to the graph\\ folder beside it")
    ap.add_argument("--force", action="store_true",
                    help="rebuild even if the manifest matches the latest ingest")
    args = ap.parse_args()
    build(args.db, force=args.force)


if __name__ == "__main__":
    main()
