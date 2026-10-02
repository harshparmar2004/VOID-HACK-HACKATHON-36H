"""
legal/fir.py -- the FIR draft: one printable A4 HTML page for a victim's trace
(PROJECT_CONTEXT.md Section 15).

    fir_details(complainant, offence_summary, ...) -> what the officer entered, cleaned
    build_fir(evidence, details)                   -> {html, generator, problems}
    validate_html(page, evidence, details)         -> problems (empty when the page may be stored)
    write_fir(evidence, details, out_dir)

Two kinds of text, kept apart on the page:
    officer-entered  the complainant's name, address, phone and email, the
                     police station, the sections of law and the summary of the
                     offence. Printed as typed, only inside elements of class
                     "officer". Code neither writes nor corrects them.
    code-filled      the amounts and the three annexures (traced accounts,
                     transfers followed, accounts recommended for freezing),
                     from the evidence object (legal\\evidence.py) alone.

No LLM. validate_html reads the finished page back: the officer blocks must be
exactly what was entered, and outside them every account number, IFSC, amount,
tx_id, timestamp and hash must be in the evidence, with nothing missing. A
page that fails is not returned. The case store is not written here.

Usage:  .venv\\Scripts\\python.exe legal\\fir.py --victim SBIN10000294 --case TEST-1
            --name "..." --summary "..." --out %TEMP%\\fir
"""

from __future__ import annotations

import argparse
import hashlib
import html
import re
import sys
import time
from pathlib import Path

LEGAL_DIR = Path(__file__).resolve().parent
FIR_TEMPLATE = "fir.html.j2"
if str(LEGAL_DIR) not in sys.path:
    sys.path.insert(0, str(LEGAL_DIR))

from diary import evidence_problems  # noqa: E402
from evidence import GENERATOR_TEMPLATE, EvidenceError, build_evidence  # noqa: E402
from notices import _environment, _file_part, label_problems, page_problems, visible_text  # noqa: E402

COMPLAINANT_FIELDS = ("name", "address", "phone", "email")
MAX_FIELD = 300
MAX_SUMMARY = 4000
OFFICER_RE = re.compile(r'<(td|div) class="officer">(.*?)</\1>', re.S)


class FirError(Exception):
    """No valid FIR draft could be built; nothing may be written."""


def _text(value, name: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise FirError(f"{name} must be text")
    value = "\n".join(line.strip() for line in value.strip().splitlines())
    if required and not value:
        raise FirError(f"{name} is required")
    if len(value) > limit:
        raise FirError(f"{name} is longer than {limit} characters")
    return value


def fir_details(complainant: dict, offence_summary: str, sections_of_law: str | None = None,
                police_station: str | None = None) -> dict:
    """What the officer entered, trimmed. Only the name and the summary are required."""
    if not isinstance(complainant, dict) or set(complainant) - set(COMPLAINANT_FIELDS):
        raise FirError(f"complainant must hold only {COMPLAINANT_FIELDS}")
    return {
        "complainant": {k: _text(complainant.get(k), f"complainant {k}", MAX_FIELD, required=k == "name")
                        for k in COMPLAINANT_FIELDS},
        "police_station": _text(police_station, "police station", MAX_FIELD),
        "sections_of_law": _text(sections_of_law, "sections of law", MAX_FIELD),
        "offence_summary": _text(offence_summary, "offence summary", MAX_SUMMARY, required=True),
    }


def officer_values(details: dict) -> list[str]:
    """The officer-entered texts in the order the template prints them."""
    return [*(details["complainant"][k] for k in COMPLAINANT_FIELDS),
            details["police_station"], details["sections_of_law"], details["offence_summary"]]


def render(evidence: dict, details: dict) -> str:
    return _environment().get_template(FIR_TEMPLATE).render(ev=evidence, fir=details)


def validate_html(page: str, evidence: dict, details: dict) -> list[str]:
    """Problems on a rendered FIR draft, read as plain text against the evidence."""
    problems: list[str] = []
    entered = [html.unescape(m.group(2)) for m in OFFICER_RE.finditer(page)]
    if entered != officer_values(details):
        problems.append("the officer-entered blocks are not what the officer entered")
    text = visible_text(OFFICER_RE.sub(" ", page))
    problems += evidence_problems(text, evidence, "FIR draft") + label_problems(text, evidence)
    for name, needle in (("draft label", evidence["legal"]["draft_label"]),
                         ("FIR legal reference", evidence["legal"]["fir"]),
                         ("case id", evidence["case_id"]), ("profile id", evidence["profile_id"]),
                         ("heading", "First Information Report"),
                         ("annexure: traced accounts", "Annexure A"),
                         ("annexure: transfers followed", "Annexure B"),
                         ("annexure: accounts recommended for freezing", "Annexure C")):
        if needle not in text:
            problems.append(f"{name} is not on the FIR draft")
    return problems + page_problems(page, text)


def build_fir(evidence: dict, details: dict) -> dict:
    page = render(evidence, details)
    problems = validate_html(page, evidence, details)
    if problems:
        raise FirError(f"the FIR draft failed validation: {problems}")
    return {"html": page, "generator": GENERATOR_TEMPLATE, "problems": []}


def write_fir(evidence: dict, details: dict, out_dir: Path) -> dict:
    result = build_fir(evidence, details)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"fir_{_file_part(evidence['case_id'])}.html"
    data = result["html"].encode("utf-8")
    path.write_bytes(data)
    return {**result, "path": path, "sha256": hashlib.sha256(data).hexdigest()}


def main() -> None:
    ap = argparse.ArgumentParser(description="Write the FIR draft for a victim's trace.")
    ap.add_argument("--victim", required=True, help="victim account number")
    ap.add_argument("--case", required=True, help="case id")
    ap.add_argument("--fir", default=None, help="FIR number, if registered")
    ap.add_argument("--name", required=True, help="complainant's name")
    ap.add_argument("--address", default=None)
    ap.add_argument("--phone", default=None)
    ap.add_argument("--email", default=None)
    ap.add_argument("--summary", required=True, help="summary of the offence, as the officer words it")
    ap.add_argument("--sections", default=None, help="sections of law, as the officer enters them")
    ap.add_argument("--station", default=None, help="police station / unit")
    ap.add_argument("--out", type=Path, required=True, help="folder to write the HTML file to")
    ap.add_argument("--db", type=Path, default=None, help="DuckDB file to read")
    args = ap.parse_args()

    t0 = time.perf_counter()
    try:
        details = fir_details({"name": args.name, "address": args.address, "phone": args.phone,
                               "email": args.email}, args.summary, args.sections, args.station)
        ev = build_evidence(args.victim, args.case, args.fir, args.db)
        r = write_fir(ev, details, args.out)
    except (EvidenceError, FirError) as e:
        raise SystemExit(f"fir: {e}")
    print(f"runtime {time.perf_counter() - t0:.2f} s   case {ev['case_id']}   victim {ev['victim']['acct_no']}")
    print(f"generator   {r['generator']}")
    print(f"validation  page passed ({len(ev['transfers'])} transfers, {len(ev['accounts'])} accounts, "
          f"{len(ev['freeze_candidates'])} to freeze)")
    print(f"file        {r['path']}")
    print(f"fingerprint {ev['fingerprint']}")
    print(f"dataset     {ev['dataset']['sha256']}")


if __name__ == "__main__":
    main()
