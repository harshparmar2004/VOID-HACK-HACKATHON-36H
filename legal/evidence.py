"""
legal/evidence.py -- the evidence object every Step 8 document is filled from
(PROJECT_CONTEXT.md Section 15).

    build_evidence(victim_acct, case_id, fir_number=None, db=None) -> dict

One trace_victim() call, plus three look-ups the trace does not carry: each
account's IFSC (accounts), the bank's name and Nodal Officer block
(bank_directory) and the SHA-256 of the loaded dataset (ingest_meta). Nothing
is computed here except the per-bank sum of holdings; every account, amount,
tx_id and timestamp is the trace's own. Roles are the ones the trace read from
`scores`. The trace carries no narration text, so none can reach a document or
a prompt. Templates read this object and nothing
else, so a document can only show what the trace found.

Amounts are integer paise. The engine database is opened read-only.

Usage:  .venv\\Scripts\\python.exe legal\\evidence.py --victim SBIN10000294 --case TEST-1
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import duckdb
import yaml

LEGAL_DIR = Path(__file__).resolve().parent
ROOT = LEGAL_DIR.parent
ENGINE_DIR = ROOT / "engine"
CONFIG_PATH = LEGAL_DIR / "config.yaml"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import victim_trace  # noqa: E402

GENERATOR_TEMPLATE = "TEMPLATE"


class EvidenceError(Exception):
    """The evidence object cannot be built; no document may be produced."""


def load_legal_config(path: Path = CONFIG_PATH) -> dict:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    refs = cfg.get("legal_references") or {}
    missing = [k for k in ("production_of_records", "freezing", "case_diary", "fir") if not refs.get(k)]
    if missing or not cfg.get("draft_label"):
        raise EvidenceError(f"{path.name}: missing {missing or ['draft_label']}")
    return cfg


def _lookups(db: Path, acct_nos: list[str], banks: list[str]) -> tuple[dict, dict, dict]:
    con = duckdb.connect(str(db), read_only=True)
    try:
        ifsc = dict(con.execute(
            "SELECT acct_no, ifsc FROM accounts WHERE acct_no IN (SELECT unnest(?))", [acct_nos]).fetchall())
        directory = {r[0]: {"bank_prefix": r[0], "bank_name": r[1], "nodal_officer_title": r[2],
                            "address_block": r[3]}
                     for r in con.execute(
                         "SELECT bank_prefix, bank_name, nodal_officer_title, address_block "
                         "FROM bank_directory WHERE bank_prefix IN (SELECT unnest(?))", [banks]).fetchall()}
        load = con.execute(
            "SELECT file_name, file_sha256 FROM ingest_meta ORDER BY load_id DESC LIMIT 1").fetchone()
    finally:
        con.close()
    if load is None:
        raise EvidenceError("ingest_meta is empty: the dataset SHA-256 is unknown")
    return ifsc, directory, {"file_name": load[0], "sha256": load[1]}


def build_evidence(victim_acct: str, case_id: str, fir_number: str | None = None,
                   db: Path | str | None = None) -> dict:
    if not case_id or not str(case_id).strip():
        raise EvidenceError("case id is required")
    db = Path(db) if db else victim_trace.DEFAULT_DB
    trace = victim_trace.trace_victim(victim_acct, db)
    if not trace.get("found"):
        raise EvidenceError(f"{victim_acct}: {trace.get('message', 'no trace')}")
    if trace["fingerprint"] is None:
        raise EvidenceError(f"{victim_acct}: the trace followed no transfer")
    cfg = load_legal_config()

    candidates = trace["freeze_candidates"]
    banks = sorted({c["bank"] for c in candidates})
    acct_nos = [trace["victim"]["acct_no"], *(a["acct_no"] for a in trace["accounts"])]
    ifsc, directory, dataset = _lookups(db, acct_nos, banks)
    unrouted = [b for b in banks if b not in directory
                or not directory[b]["nodal_officer_title"] or not directory[b]["address_block"]]
    if unrouted:
        raise EvidenceError(f"bank_directory has no Nodal Officer block for {unrouted}; "
                            f"run engine\\seed_banks.py")
    no_ifsc = [a for a in acct_nos if not ifsc.get(a)]
    if no_ifsc:
        raise EvidenceError(f"no IFSC in accounts for {no_ifsc}")

    def candidate(c: dict) -> dict:
        return {
            "acct_no": c["acct_no"], "ifsc": ifsc[c["acct_no"]], "bank": c["bank"],
            "role": c["role"], "holding_paise": c["holding"], "tainted_in_paise": c["tainted_in"],
            "receipts": [{"tx_id": r["tx_id"], "tx_key": r["tx_key"], "ts": r["ts"],
                          "amount_paise": r["amount"], "tainted_paise": int(round(r["tainted"]))}
                         for r in c["receipts"]],
        }

    freeze = [candidate(c) for c in candidates]
    summary = trace["summary"]
    role = {a["acct_no"]: a["role"] for a in [trace["victim"], *trace["accounts"]]}
    rec = summary["reconciliation"]
    return {
        "case_id": str(case_id).strip(),
        "fir_number": fir_number,
        "generated_at": datetime.now().astimezone().isoformat(sep=" ", timespec="seconds"),
        "generator": GENERATOR_TEMPLATE,
        "profile_id": trace["profile_id"],
        "dataset": dataset,
        "fingerprint": trace["fingerprint"],
        "victim": {"acct_no": trace["victim"]["acct_no"], "bank": trace["victim"]["bank"],
                   "ifsc": ifsc[trace["victim"]["acct_no"]],
                   "paid_paise": summary["tainted_total"]},
        "trace": {"first_ts": summary["first_ts"], "last_ts": summary["last_ts"],
                  "low_confidence": summary["low_confidence"], "truncated": summary["truncated"],
                  "freeze_holding_total_paise": sum(c["holding_paise"] for c in freeze)},
        "totals": {"paid_paise": summary["tainted_total"],
                   "commissions_kept_paise": rec["commissions_kept"],
                   "holding_at_end_paise": rec["holding_at_end"],
                   "untraced_paise": rec["untraced"],
                   "holding_total_paise": summary["holding_total"],
                   "freeze_holding_total_paise": sum(c["holding_paise"] for c in freeze)},
        # Every account the trace reached (the victim is not among them).
        "accounts": [{"acct_no": a["acct_no"], "ifsc": ifsc[a["acct_no"]], "bank": a["bank"],
                      "role": a["role"], "freeze_recommended": bool(a["freeze_recommended"]),
                      "tainted_in_paise": a["tainted_in"], "tainted_out_paise": a["tainted_out"],
                      "untraced_out_paise": a["untraced_out"], "holding_paise": a["holding"]}
                     for a in trace["accounts"]],
        # Every transfer the trace followed, oldest first.
        "transfers": sorted(
            ({"tx_id": t["tx_id"], "tx_key": t["tx_key"], "ts": t["ts"],
              "from": t["from"], "to": t["to"], "from_role": role[t["from"]], "to_role": role[t["to"]],
              "amount_paise": t["amount"], "tainted_paise": int(round(t["tainted"])),
              "proven_link": t["via"] == "layer_link"} for t in trace["transfers"]),
            key=lambda t: (t["ts"], t["tx_id"])),
        "freeze_candidates": freeze,
        # One entry per bank in the freeze list, in bank_prefix order.
        "banks": [{**directory[b],
                   "accounts": [c for c in freeze if c["bank"] == b],
                   "holding_total_paise": sum(c["holding_paise"] for c in freeze if c["bank"] == b)}
                  for b in banks],
        "legal": {**cfg["legal_references"], "draft_label": cfg["draft_label"]},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the evidence object for one victim.")
    ap.add_argument("--victim", required=True, help="victim account number")
    ap.add_argument("--case", required=True, help="case id")
    ap.add_argument("--fir", default=None, help="FIR number, if registered")
    ap.add_argument("--db", type=Path, default=None, help="DuckDB file to read")
    ap.add_argument("--json", action="store_true", help="print the whole object")
    args = ap.parse_args()

    t0 = time.perf_counter()
    try:
        ev = build_evidence(args.victim, args.case, args.fir, args.db)
    except EvidenceError as e:
        raise SystemExit(f"evidence: {e}")
    if args.json:
        print(json.dumps(ev, indent=2, ensure_ascii=False))
        return
    print(f"runtime {time.perf_counter() - t0:.2f} s   case {ev['case_id']}   victim {ev['victim']['acct_no']}")
    print(f"freeze candidates {len(ev['freeze_candidates'])}   banks {len(ev['banks'])}   "
          f"holding {ev['trace']['freeze_holding_total_paise']} paise")
    print(f"fingerprint {ev['fingerprint']}")
    print(f"dataset     {ev['dataset']['sha256']}   profile {ev['profile_id']}")


if __name__ == "__main__":
    main()
