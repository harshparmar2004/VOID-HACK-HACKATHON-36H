"""
audits/check_notices.py -- checks Step 8b: the freeze notices (legal\\notices.py)
against the trace (PROJECT_CONTEXT.md Section 15).

Read-only. For EVERY send-only account (found by structure: it sends and never
receives) the audit renders the notices in memory and reads the HTML back as
plain text, the way a bank officer would. The trace is run again here, apart
from the evidence object, and the IFSCs are read straight from `accounts`.

Per victim:
    one notice per bank in the trace's freeze list, no more, no fewer
Per notice (visible text only):
    accounts    every account number on the page is the victim or a freeze
                candidate of THIS bank; every candidate of the bank is listed
    IFSCs       every IFSC on the page is the `accounts` IFSC of one of them
    tx_ids      every transaction ID on the page proves receipt by a candidate
                of this bank in the trace; none is missing
    timestamps  every date-time is a receipt's, the trace's first / last
                transfer, or the generated-at stamp
    amounts     every rupee amount is, in paise, a holding, a receipt amount or
                its tainted part, this bank's total holding (summed here), or
                what the victim paid
    hashes      every 64-hex string is the trace fingerprint or the dataset
                SHA-256 of ingest_meta
    wording     the DRAFT label, the two legal references and the case id are
                there; the Nodal Officer block is the bank_directory row; the
                page loads nothing from the network and never says it was sent

Usage:  .venv\\Scripts\\python.exe audits\\check_notices.py [--db PATH]
"""

from __future__ import annotations

import argparse
import html
import re
import statistics
import sys
import time
from pathlib import Path

import duckdb
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "legal"))

import victim_trace  # noqa: E402
from evidence import EvidenceError, build_evidence  # noqa: E402
from notices import render_notices  # noqa: E402

LEGAL_CONFIG = ROOT / "legal" / "config.yaml"
CASE_ID = "AUDIT-CASE-8B"

ACCT_RE = re.compile(r"\b[A-Z]{4}\d{8}\b")
IFSC_RE = re.compile(r"\b[A-Z]{4}\d{7}\b")
AMOUNT_RE = re.compile(r"\u20b9\s*([\d,]+)\.(\d\d)")
TS_RE = re.compile(r"\b\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\b")
HEX_RE = re.compile(r"\b[0-9a-f]{64}\b")
SENT_RE = re.compile(r"\b(dispatched|sent|served|delivered|cryptographically)\b", re.I)


def visible_text(page: str) -> str:
    body = page[page.index("<body"):]
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body)))


def check_notice(page: str, bank: str, trace: dict, ifsc: dict, directory: dict, dataset_sha: str,
                 cfg: dict) -> list[str]:
    text = visible_text(page)
    victim = trace["victim"]["acct_no"]
    mine = [c for c in trace["freeze_candidates"] if c["bank"] == bank]
    accts = {c["acct_no"] for c in mine}
    receipts = [r for c in mine for r in c["receipts"]]
    bad: list[str] = []

    def only(what: str, found: set, allowed: set, required: set = frozenset()) -> None:
        if found - allowed:
            bad.append(f"{what} not in the trace: {sorted(found - allowed)[:3]}")
        if required - found:
            bad.append(f"{what} missing from the notice: {sorted(required - found)[:3]}")

    only("account", set(ACCT_RE.findall(text)), accts | {victim}, accts | {victim})
    allowed_ifsc = {ifsc[a] for a in accts | {victim}}
    only("IFSC", set(IFSC_RE.findall(text)), allowed_ifsc, allowed_ifsc)

    # Transaction IDs: whatever sits in the Transaction ID column, i.e. every
    # token of the visible text that some transfer of the whole trace carries.
    all_tx_ids = {t["tx_id"] for t in trace["transfers"]}
    tokens = set(re.findall(r"[A-Za-z0-9_-]+", text))
    on_page = tokens & all_tx_ids
    # ...and any token shaped like the trace's IDs that the trace does not know.
    shapes = {re.sub(r"\d", "9", t) for t in all_tx_ids}
    unknown = {t for t in tokens if re.sub(r"\d", "9", t) in shapes and any(ch.isdigit() for ch in t)} - all_tx_ids
    unknown -= set(ACCT_RE.findall(text)) | set(IFSC_RE.findall(text))
    if unknown:
        bad.append(f"tx_id not in the trace: {sorted(unknown)[:3]}")
    only("tx_id", on_page, {r["tx_id"] for r in receipts}, {r["tx_id"] for r in receipts})

    stamps = set(TS_RE.findall(text))
    generated = {s for s in stamps if f"Generated at: {s}" in text or f"Generated at {s}" in text}
    only("timestamp", stamps - generated,
         {r["ts"] for r in receipts} | {trace["summary"]["first_ts"], trace["summary"]["last_ts"]},
         {r["ts"] for r in receipts})

    paise = {int(w.replace(",", "")) * 100 + int(f) for w, f in AMOUNT_RE.findall(text)}
    holdings = {c["holding"] for c in mine}
    bank_total = sum(c["holding"] for c in mine)
    only("amount (paise)", paise,
         holdings | {r["amount"] for r in receipts} | {int(round(r["tainted"])) for r in receipts}
         | {bank_total, trace["summary"]["tainted_total"]},
         holdings | {r["amount"] for r in receipts} | {bank_total})
    if text.count("\u20b9") != len(AMOUNT_RE.findall(text)):
        bad.append("a rupee sign is not followed by a readable amount")

    only("hash", set(HEX_RE.findall(text)), {trace["fingerprint"], dataset_sha},
         {trace["fingerprint"], dataset_sha})

    refs = cfg["legal_references"]
    for name, needle in (("draft label", cfg["draft_label"]), ("records reference", refs["production_of_records"]),
                         ("freezing reference", refs["freezing"]), ("case id", CASE_ID),
                         ("profile id", trace["profile_id"]), ("generator", "TEMPLATE"),
                         ("officer title", directory[bank][1]), ("bank name", directory[bank][0]),
                         ("address block", directory[bank][2])):
        if re.sub(r"\s+", " ", needle) not in text:
            bad.append(f"{name} is not on the notice")
    if SENT_RE.search(text):
        bad.append(f"claims delivery: {SENT_RE.search(text).group(0)!r}")
    if re.search(r"https?://|<script|<link|<img|@import|url\(", page, re.I):
        bad.append("the page loads an outside resource")
    if "@page" not in page or "A4" not in page or "@media print" not in page:
        bad.append("no A4 print CSS")
    return bad


def main() -> None:
    ap = argparse.ArgumentParser(description="Check every freeze notice against the trace.")
    ap.add_argument("--db", type=Path, default=victim_trace.DEFAULT_DB, help="DuckDB file to read")
    args = ap.parse_args()

    t0 = time.perf_counter()
    cfg = yaml.safe_load(LEGAL_CONFIG.read_text(encoding="utf-8"))
    con = duckdb.connect(str(args.db), read_only=True)
    try:
        victims = [r[0] for r in con.execute(
            "SELECT a.acct_no FROM accounts a "
            "WHERE a.acct_id IN (SELECT src FROM tx) AND a.acct_id NOT IN (SELECT dst FROM tx) "
            "ORDER BY a.acct_no").fetchall()]
        ifsc = dict(con.execute("SELECT acct_no, ifsc FROM accounts").fetchall())
        directory = {r[0]: r[1:] for r in con.execute(
            "SELECT bank_prefix, bank_name, nodal_officer_title, address_block FROM bank_directory").fetchall()}
        dataset_sha = con.execute(
            "SELECT file_sha256 FROM ingest_meta ORDER BY load_id DESC LIMIT 1").fetchone()[0]
    finally:
        con.close()

    failures: list[str] = []
    notices = accounts = tx_ids = with_notices = no_trace = 0
    per_victim: list[int] = []
    for v in victims:
        trace = victim_trace.trace_victim(v, args.db)
        try:
            pages = render_notices(build_evidence(v, CASE_ID, db=args.db))
        except EvidenceError as e:
            if trace.get("found") and trace.get("fingerprint"):
                failures.append(f"{v}: evidence refused a traceable victim: {e}")
            else:
                no_trace += 1
            continue
        banks = sorted({c["bank"] for c in trace["freeze_candidates"]})
        got = [p["bank"] for p in pages]
        if got != banks:
            failures.append(f"{v}: notices for {got}, freeze list banks {banks}")
        per_victim.append(len(pages))
        with_notices += bool(pages)
        for p in pages:
            notices += 1
            mine = [c for c in trace["freeze_candidates"] if c["bank"] == p["bank"]]
            accounts += len(mine)
            tx_ids += sum(len(c["receipts"]) for c in mine)
            failures += [f"{v} / {p['bank']}: {b}" for b in check_notice(
                p["html"], p["bank"], trace, ifsc, directory, dataset_sha, cfg)]

    print(f"runtime {time.perf_counter() - t0:.2f} s   database {args.db.name}")
    print(f"{'send-only accounts':<34} {len(victims):>7}")
    print(f"{'  with no followable trace':<34} {no_trace:>7}")
    print(f"{'  with at least one notice':<34} {with_notices:>7}")
    print(f"{'notices rendered and checked':<34} {notices:>7}")
    print(f"{'  accounts listed':<34} {accounts:>7}")
    print(f"{'  proving transactions listed':<34} {tx_ids:>7}")
    if per_victim:
        print(f"{'notices per victim (median / max)':<34} {statistics.median(per_victim):>4g} / {max(per_victim)}")
    print(f"{'failures':<34} {len(failures):>7}")
    for f in failures[:15]:
        print(f"FAIL  {f}")
    if failures or not notices:
        raise SystemExit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
