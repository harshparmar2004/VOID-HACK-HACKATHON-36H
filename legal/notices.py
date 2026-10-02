"""
legal/notices.py -- freeze notices: one printable HTML page per bank in the
trace's freeze list (PROJECT_CONTEXT.md Section 15).

    render_notices(evidence)            -> [{bank, html}]
    write_notices(evidence, out_dir)    -> [{bank, path, sha256, accounts, holding_paise}]

Filled ONLY by code: the Jinja2 template legal\\templates\\freeze_notice.html.j2
reads the evidence object (legal\\evidence.py) and nothing else. No LLM. The
legal references and the DRAFT label come from legal\\config.yaml. The page is
A4 with print CSS; the browser's "Save as PDF" makes the PDF. It loads nothing
from the network.

A notice is a draft for an officer to review and sign. Nothing here sends it,
and nothing on the page says it was sent. The case store is not written here:
recording a generated notice (case_store.add_output) is the API step's job,
because the store is append-only and a test run must not leave rows in it.

Usage:  .venv\\Scripts\\python.exe legal\\notices.py --victim SBIN10000294 --case TEST-1 --out %TEMP%\\notices
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import time
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

LEGAL_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = LEGAL_DIR / "templates"
NOTICE_TEMPLATE = "freeze_notice.html.j2"
if str(LEGAL_DIR) not in sys.path:
    sys.path.insert(0, str(LEGAL_DIR))

from evidence import EvidenceError, build_evidence  # noqa: E402


def rupees(paise: int) -> str:
    """Integer paise as rupees with Indian digit grouping: 2169303100 -> ₹2,16,93,031.00"""
    whole, frac = divmod(int(paise), 100)
    s = str(whole)
    head, tail = s[:-3], s[-3:]
    head = re.sub(r"(?<=\d)(?=(\d\d)+$)", ",", head)
    return f"₹{head + ',' if head else ''}{tail}.{frac:02d}"


def _environment() -> Environment:
    # StrictUndefined: a value missing from the evidence object is an error,
    # never an empty space on a notice.
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), undefined=StrictUndefined,
                      autoescape=select_autoescape(default=True, default_for_string=True),
                      trim_blocks=True, lstrip_blocks=True)
    env.filters["rupees"] = rupees
    return env


def render_notices(evidence: dict) -> list[dict]:
    template = _environment().get_template(NOTICE_TEMPLATE)
    return [{"bank": b["bank_prefix"], "html": template.render(ev=evidence, bank=b)}
            for b in evidence["banks"]]


def _file_part(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("_") or "case"


def write_notices(evidence: dict, out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    by_bank = {b["bank_prefix"]: b for b in evidence["banks"]}
    written = []
    for n in render_notices(evidence):
        path = out_dir / f"freeze_notice_{_file_part(evidence['case_id'])}_{n['bank']}.html"
        data = n["html"].encode("utf-8")
        path.write_bytes(data)
        written.append({"bank": n["bank"], "path": path, "sha256": hashlib.sha256(data).hexdigest(),
                        "accounts": len(by_bank[n["bank"]]["accounts"]),
                        "holding_paise": by_bank[n["bank"]]["holding_total_paise"]})
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description="Write one freeze notice per bank for a victim's trace.")
    ap.add_argument("--victim", required=True, help="victim account number")
    ap.add_argument("--case", required=True, help="case id")
    ap.add_argument("--fir", default=None, help="FIR number, if registered")
    ap.add_argument("--out", type=Path, required=True, help="folder to write the HTML files to")
    ap.add_argument("--db", type=Path, default=None, help="DuckDB file to read")
    args = ap.parse_args()

    t0 = time.perf_counter()
    try:
        ev = build_evidence(args.victim, args.case, args.fir, args.db)
    except EvidenceError as e:
        raise SystemExit(f"notices: {e}")
    written = write_notices(ev, args.out)
    print(f"runtime {time.perf_counter() - t0:.2f} s   case {ev['case_id']}   victim {ev['victim']['acct_no']}   "
          f"notices {len(written)}   folder {args.out}")
    if not written:
        print("no freeze-recommended account holds this victim's money: nothing to write")
        return
    print(f"{'BANK':<6} {'ACCOUNTS':>8} {'HOLDING':>18}  FILE")
    for w in written:
        print(f"{w['bank']:<6} {w['accounts']:>8} {rupees(w['holding_paise'])[1:]:>18}  {w['path'].name}")
    print(f"fingerprint {ev['fingerprint']}")


if __name__ == "__main__":
    main()
