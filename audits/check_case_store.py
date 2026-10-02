"""
audits/check_case_store.py -- checks Step 8a: the case store, the bank
directory placeholders and legal\\config.yaml (PROJECT_CONTEXT.md Section 15).

The case store is append-only, so a test row written to data\\cases.db would
stay there for ever. Every write below therefore goes to a scratch store under
%TEMP% (deleted at the end); data\\cases.db and data\\case.duckdb are only read.
The scratch rows are audit fixtures (officer "AUDIT"), never shown anywhere.

Checked:
    scratch store   tables and columns are the Section 15 ones; the three
                    helpers append; versions count up per case/doc_type/bank;
                    bad values and unknown cases are refused; UPDATE and DELETE
                    are refused on every table; verify() passes, and then
                    catches a changed row, a deleted middle row, a deleted last
                    row and a dropped trigger.
    data\\cases.db   exists and passes verify().
    bank_directory  every bank holds a title and an address; none is NULL; the
                    untouched ones are exactly the Section 15 placeholders.
    legal config    the two default legal references and the draft label.

Usage:  .venv\\Scripts\\python.exe audits\\check_case_store.py
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

import duckdb
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

import case_store as cs  # noqa: E402
import seed_banks  # noqa: E402

ENGINE_DB = ROOT / "data" / "case.duckdb"
LEGAL_CONFIG = ROOT / "legal" / "config.yaml"
SCRATCH_DIR = Path(os.environ["TEMP"]) / "abhedya_check_case_store"

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(ok), detail))


def refused(fn, *exc) -> bool:
    try:
        fn()
    except exc:
        return True
    return False


def raw(db: Path, sql: str) -> None:
    """Run one statement straight on the file, as a tamperer would."""
    con = sqlite3.connect(str(db), isolation_level=None)
    try:
        con.execute(sql)
    finally:
        con.close()


def fresh(name: str, source: Path | None = None) -> Path:
    db = SCRATCH_DIR / name
    if source:
        shutil.copyfile(source, db)
    return db


def check_scratch_store() -> None:
    db = fresh("store.db")
    con = cs.connect(db)
    try:
        for table, cols in cs.COLUMNS.items():
            have = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
            check(f"{table}: Section 15 columns", have == ["seq", *cols, "prev_hash", "row_hash"], str(have))
    finally:
        con.close()

    doc = SCRATCH_DIR / "doc.html"
    doc.write_text("audit fixture", encoding="utf-8")

    c1 = cs.create_case("AUDIT", ["AUDIT-ACCT-1"], "0" * 64, "audit-profile", db=db)
    c2 = cs.create_case("AUDIT", ["AUDIT-ACCT-2", "AUDIT-ACCT-3"], "0" * 64, "audit-profile",
                        fir_number="AUDIT/1", complainant="AUDIT", db=db)
    check("create_case: ids are distinct and sequential", (c1, c2) == ("CASE-000001", "CASE-000002"), f"{c1} {c2}")

    v = [cs.add_output(c1, "FREEZE_NOTICE", doc, True, "TEMPLATE", bank="SBIN", db=db),
         cs.add_output(c1, "FREEZE_NOTICE", doc, True, "TEMPLATE", bank="SBIN", db=db),
         cs.add_output(c1, "FREEZE_NOTICE", doc, True, "TEMPLATE", bank="HDFC", db=db),
         cs.add_output(c1, "CASE_DIARY", doc, False, "TEMPLATE_FALLBACK", db=db),
         cs.add_output(c1, "CASE_DIARY", doc, True, "LLM+VALIDATED", db=db),
         cs.add_output(c2, "FIR", doc, True, "TEMPLATE", db=db)]
    check("add_output: version counts per case, doc_type and bank", v == [1, 2, 1, 1, 2, 1], str(v))

    a1 = cs.add_freeze_action(c1, "AUDIT-ACCT-9", "SBIN", 12345, "REQUESTED", "AUDIT", db=db)
    a2 = cs.add_freeze_action(c1, "AUDIT-ACCT-9", "SBIN", 12345, "WITHDRAWN", "AUDIT", note="audit", db=db)
    check("add_freeze_action: a withdrawal is a second row", (a1, a2) == (1, 2), f"{a1} {a2}")

    con = sqlite3.connect(str(db))
    try:
        sha, = con.execute("SELECT DISTINCT sha256 FROM case_outputs").fetchone()
    finally:
        con.close()
    check("add_output: sha256 is the file's", sha == hashlib.sha256(doc.read_bytes()).hexdigest())

    # Step 8d: case events (status = latest event) and documents stored in the store.
    check("create_case: each case starts with its OPENED event",
          [(c["case_id"], c["status"]) for c in cs.list_cases(db)] == [(c1, "OPENED"), (c2, "OPENED")]
          and [e["event"] for e in cs.get_case(c1, db)["events"]] == ["OPENED"])
    cs.add_event(c1, "NOTICES_GENERATED", "AUDIT", note="audit", db=db)
    cs.add_event(c1, "CLOSED", "AUDIT", db=db)
    check("add_event: status is the latest event", cs.get_case(c1, db)["status"] == "CLOSED"
          and cs.get_case(c2, db)["status"] == "OPENED" and cs.get_case("CASE-999999", db) is None)
    d = cs.add_document(c2, "FIR", "fir_audit", "<p>audit fixture</p>", True, "TEMPLATE", db=db)
    check("add_document: next version, sha256 of the HTML, body stored",
          (d["version"], d["file_path"]) == (2, "fir_audit_v2.html")
          and d["sha256"] == hashlib.sha256(b"<p>audit fixture</p>").hexdigest()
          and cs.document_body(d["output_id"], db) == "<p>audit fixture</p>"
          and cs.document_body(1, db) is None)
    check("current_requests: a withdrawn request is not current", cs.current_requests(c1, db) == [])
    closed = {
        "event": lambda: cs.add_event(c1, "FIR_GENERATED", "AUDIT", db=db),
        "second CLOSED": lambda: cs.add_event(c1, "CLOSED", "AUDIT", db=db),
        "output": lambda: cs.add_output(c1, "FIR", doc, True, "TEMPLATE", db=db),
        "document": lambda: cs.add_document(c1, "FIR", "x", "x", True, "TEMPLATE", db=db),
        "freeze action": lambda: cs.add_freeze_action(c1, "A", "SBIN", 1, "REQUESTED", "AUDIT", db=db),
    }
    for name, fn in closed.items():
        check(f"closed case refuses: {name}", refused(fn, cs.CaseClosedError))
    docs = cs.case_documents(c2, db=db)
    check("case_documents: rows with their stored page", [(x["seq"], x["body"]) for x in docs]
          == [(6, None), (d["output_id"], "<p>audit fixture</p>")]
          and cs.case_documents(c2, d["output_id"], db) == docs[1:]
          and cs.case_documents(c1, d["output_id"], db) == [])

    bad = {
        "unknown case (output)": lambda: cs.add_output("CASE-999999", "FIR", doc, True, "TEMPLATE", db=db),
        "unknown case (freeze)": lambda: cs.add_freeze_action("CASE-999999", "A", "SBIN", 1, "REQUESTED", "AUDIT", db=db),
        "bad doc_type": lambda: cs.add_output(c1, "NOTICE", doc, True, "TEMPLATE", db=db),
        "bad generator": lambda: cs.add_output(c1, "FIR", doc, True, "LLM", db=db),
        "FIR under a model label": lambda: cs.add_document(c2, "FIR", "x", "x", True, "LLM+VALIDATED", db=db),
        "notice under the fallback label": lambda: cs.add_output(
            c2, "FREEZE_NOTICE", doc, True, "TEMPLATE_FALLBACK", bank="SBIN", db=db),
        "bad event": lambda: cs.add_event(c1, "REOPENED", "AUDIT", db=db),
        "unknown case (event)": lambda: cs.add_event("CASE-999999", "CLOSED", "AUDIT", db=db),
        "unknown case (document)": lambda: cs.add_document("CASE-999999", "FIR", "x", "x", True, "TEMPLATE", db=db),
        "empty document": lambda: cs.add_document(c1, "FIR", "x", "", True, "TEMPLATE", db=db),
        "bad action": lambda: cs.add_freeze_action(c1, "A", "SBIN", 1, "FROZEN", "AUDIT", db=db),
        "amount not integer paise": lambda: cs.add_freeze_action(c1, "A", "SBIN", 1.5, "REQUESTED", "AUDIT", db=db),
        "negative amount": lambda: cs.add_freeze_action(c1, "A", "SBIN", -1, "REQUESTED", "AUDIT", db=db),
        "no officer": lambda: cs.create_case("", ["A"], "0" * 64, "p", db=db),
        "no victim accounts": lambda: cs.create_case("AUDIT", [], "0" * 64, "p", db=db),
        "missing document file": lambda: cs.add_output(c1, "FIR", SCRATCH_DIR / "none.html", True, "TEMPLATE", db=db),
    }
    for name, fn in bad.items():
        check(f"refused: {name}", refused(fn, ValueError, OSError))

    for table in cs.COLUMNS:
        check(f"{table}: UPDATE refused",
              refused(lambda: raw(db, f"UPDATE {table} SET created_at = 'x'"), sqlite3.DatabaseError))
        check(f"{table}: DELETE refused",
              refused(lambda: raw(db, f"DELETE FROM {table}"), sqlite3.DatabaseError))
    check("CHECK constraint refuses a raw bad action", refused(lambda: raw(
        db, "INSERT INTO freeze_actions (case_id, account, bank, amount_paise, action, officer, created_at, "
            "prev_hash, row_hash) VALUES ('CASE-000001', 'A', 'SBIN', 1, 'FROZEN', 'AUDIT', 'x', '', '')"),
        sqlite3.DatabaseError))

    r = cs.verify(db)
    check("verify: clean store passes", r["ok"] and r["rows"] == {
        "cases": 2, "case_outputs": 7, "freeze_actions": 2, "case_events": 4, "output_bodies": 1}
          and r["triggers"] == len(cs.TRIGGERS) == 2 * len(cs.COLUMNS), str(r))

    # Tampering behind the triggers: each on its own copy of the clean store.
    tampers = {
        "a changed row": ["DROP TRIGGER freeze_actions_no_update",
                          "UPDATE freeze_actions SET amount_paise = 1 WHERE seq = 1"],
        "a deleted middle row": ["DROP TRIGGER case_outputs_no_delete", "DELETE FROM case_outputs WHERE seq = 3"],
        "a deleted last row": ["DROP TRIGGER case_outputs_no_delete", "DELETE FROM case_outputs WHERE seq = 6"],
        "a dropped trigger": ["DROP TRIGGER cases_no_update"],
        "a changed event": ["DROP TRIGGER case_events_no_update",
                            "UPDATE case_events SET event = 'OPENED' WHERE seq = 4"],
        "a deleted event": ["DROP TRIGGER case_events_no_delete", "DELETE FROM case_events WHERE seq = 4"],
        "a changed stored document": ["DROP TRIGGER output_bodies_no_update",
                                      "UPDATE output_bodies SET body = 'x'"],
        "a missing table": ["DROP TABLE case_events"],
    }
    for i, (name, statements) in enumerate(tampers.items()):
        copy = fresh(f"tamper{i}.db", db)
        for sql in statements:
            raw(copy, sql)
        t = cs.verify(copy)
        check(f"verify catches {name}", not t["ok"], "; ".join(t["problems"]))


def check_real_store() -> None:
    check("data\\cases.db exists", cs.DEFAULT_DB.is_file())
    if cs.DEFAULT_DB.is_file():
        r = cs.verify(cs.DEFAULT_DB)
        check("data\\cases.db passes verify", r["ok"], f"{r['rows']} {r['problems']}")
        print(f"data\\cases.db rows: {r['rows']}")


def check_bank_directory() -> None:
    con = duckdb.connect(str(ENGINE_DB), read_only=True)
    try:
        banks, null_any, officer_ph, address_ph, officer_bracket_other = con.execute(
            "SELECT count(*), "
            "count(*) FILTER (WHERE nodal_officer_title IS NULL OR address_block IS NULL), "
            "count(*) FILTER (WHERE nodal_officer_title = replace(?, '{bank_name}', bank_name)), "
            "count(*) FILTER (WHERE address_block = ?), "
            "count(*) FILTER (WHERE nodal_officer_title LIKE '[%' "
            "                 AND nodal_officer_title <> replace(?, '{bank_name}', bank_name)) "
            "FROM bank_directory",
            [seed_banks.OFFICER_PLACEHOLDER, seed_banks.ADDRESS_PLACEHOLDER,
             seed_banks.OFFICER_PLACEHOLDER]).fetchone()
        unrouted = con.execute(
            "SELECT count(*) FROM (SELECT DISTINCT bank FROM accounts) a "
            "LEFT JOIN bank_directory d ON d.bank_prefix = a.bank "
            "WHERE d.nodal_officer_title IS NULL OR d.address_block IS NULL").fetchone()[0]
    finally:
        con.close()
    check("bank_directory: no NULL title or address", null_any == 0, f"{null_any} of {banks}")
    check("bank_directory: every bank in accounts has a title and an address", unrouted == 0, str(unrouted))
    check("bank_directory: placeholder titles carry their own bank's name", officer_bracket_other == 0,
          str(officer_bracket_other))
    check("placeholder wording is Section 15's",
          seed_banks.OFFICER_PLACEHOLDER.format(bank_name="<bank name>") == "[Nodal Officer, <bank name>]"
          and seed_banks.ADDRESS_PLACEHOLDER == "[Address to be confirmed]")
    print(f"bank_directory: {banks} banks   title placeholder {officer_ph}   address placeholder {address_ph}")


def check_legal_config() -> None:
    cfg = yaml.safe_load(LEGAL_CONFIG.read_text(encoding="utf-8"))
    refs = cfg.get("legal_references", {})
    check("legal: production-of-records default",
          refs.get("production_of_records") == "Section 94 BNSS (corresponding to Section 91 CrPC)")
    check("legal: freezing default", refs.get("freezing") == "Section 106 BNSS / Section 102 CrPC")
    check("legal: not marked as confirmed with mentors", refs.get("confirmed_with_mentors") is False)
    check("legal: draft label", cfg.get("draft_label") == "DRAFT — for officer review and signature",
          repr(cfg.get("draft_label")))
    text = " ".join(str(v) for v in [*refs.values(), cfg.get("draft_label")]).lower()
    check("legal: no text claims a notice was sent", not any(w in text for w in ("dispatched", "sent", "served")))


def main() -> None:
    t0 = time.perf_counter()
    shutil.rmtree(SCRATCH_DIR, ignore_errors=True)
    SCRATCH_DIR.mkdir(parents=True)
    try:
        check_scratch_store()
        check_real_store()
        check_bank_directory()
        check_legal_config()
    finally:
        shutil.rmtree(SCRATCH_DIR, ignore_errors=True)

    failed = [r for r in RESULTS if not r[1]]
    print(f"runtime {time.perf_counter() - t0:.2f} s   checks {len(RESULTS)}   failed {len(failed)}")
    for name, _, detail in failed:
        print(f"FAIL  {name}  {detail}")
    if failed:
        raise SystemExit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
