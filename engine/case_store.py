"""
engine/case_store.py -- the case store: data\\cases.db (SQLite, stdlib only).

PROJECT_CONTEXT.md Section 15. Officer actions and generated documents live
here, NOT in case.duckdb: the engine database stays read-only for the API and
this file is the only thing the API writes.

Five tables, all append-only -- a correction adds a row, nothing is ever
updated or deleted:
    cases           one row per investigation
    case_outputs    one row per generated document (a regenerated document is
                    a new row with the next version)
    freeze_actions  one row per officer action on an account (a withdrawal is
                    a WITHDRAWN row, the REQUESTED row stays)
    case_events     one row per step of a case (OPENED, NOTICES_GENERATED, ...);
                    the current status of a case is its latest event
    output_bodies   the HTML of a document stored by add_document, so the API
                    writes this one file and nothing else; verify() re-hashes
                    every body against the sha256 of its case_outputs row

Append-only is held three ways:
    1. this module has no helper that updates or deletes;
    2. BEFORE UPDATE / BEFORE DELETE triggers abort any such statement;
    3. every row carries row_hash = SHA-256(prev_hash + its own values), a
       chain per table, and seq comes from AUTOINCREMENT. verify() recomputes
       the chain, so a row changed or removed behind the triggers shows up as
       a broken link, a gap in seq, or a seq counter ahead of the last row.
verify() cannot see a rewrite by someone who also recomputes every hash and
resets sqlite_sequence; that needs a copy of the last row_hash kept elsewhere.

Usage:  .venv\\Scripts\\python.exe engine\\case_store.py [--db data\\cases.db]
        (creates the file if missing, then prints the integrity check)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "cases.db"

DOC_TYPES = ("FREEZE_NOTICE", "CASE_DIARY", "FIR")
GENERATORS = ("TEMPLATE", "LLM+VALIDATED", "TEMPLATE_FALLBACK")
ACTIONS = ("REQUESTED", "WITHDRAWN")
EVENTS = ("OPENED", "NOTICES_GENERATED", "DIARY_GENERATED", "FIR_GENERATED", "CLOSED")
CLOSED = "CLOSED"
# The labels a document type may be stored under. TEMPLATE: no model was asked.
# TEMPLATE_FALLBACK: a model was asked and its answer was not used.
# LLM+VALIDATED: its answer passed validation. Only the diary has a model-written part.
DOC_GENERATORS = {"FREEZE_NOTICE": ("TEMPLATE",), "CASE_DIARY": GENERATORS, "FIR": ("TEMPLATE",)}
STATUS_OPEN = "OPEN"

# Section 15 columns, in order. seq / prev_hash / row_hash are bookkeeping.
COLUMNS = {
    "cases": ("case_id", "created_at", "officer", "fir_number", "complainant",
              "victim_accts", "dataset_sha256", "profile_id", "status"),
    "case_outputs": ("case_id", "doc_type", "bank", "version", "file_path", "sha256",
                     "validated", "generator", "created_at"),
    "freeze_actions": ("case_id", "account", "bank", "amount_paise", "action", "note",
                       "officer", "created_at"),
    "case_events": ("case_id", "event", "officer", "note", "created_at"),
    "output_bodies": ("output_seq", "sha256", "body"),
}
# Tables whose case_id must name a row of `cases`.
CASE_TABLES = ("case_outputs", "freeze_actions", "case_events")


class CaseClosedError(ValueError):
    """The case's latest event is CLOSED: nothing more may be recorded on it."""


class DocumentMismatch(Exception):
    """A stored document no longer has the sha256 recorded for it."""


def _in_list(values: tuple) -> str:
    return ", ".join(f"'{v}'" for v in values)


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS cases (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id        TEXT NOT NULL UNIQUE,
    created_at     TEXT NOT NULL,
    officer        TEXT NOT NULL,
    fir_number     TEXT,
    complainant    TEXT,
    victim_accts   TEXT NOT NULL,          -- JSON list of account numbers (text)
    dataset_sha256 TEXT NOT NULL,
    profile_id     TEXT NOT NULL,
    status         TEXT NOT NULL,
    prev_hash      TEXT NOT NULL,
    row_hash       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_outputs (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id    TEXT NOT NULL REFERENCES cases (case_id),
    doc_type   TEXT NOT NULL CHECK (doc_type IN ({_in_list(DOC_TYPES)})),
    bank       TEXT,                       -- bank_prefix; NULL for a diary / FIR
    version    INTEGER NOT NULL CHECK (version >= 1),
    file_path  TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    validated  INTEGER NOT NULL CHECK (validated IN (0, 1)),
    generator  TEXT NOT NULL CHECK (generator IN ({_in_list(GENERATORS)})),
    created_at TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    row_hash   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS freeze_actions (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id      TEXT NOT NULL REFERENCES cases (case_id),
    account      TEXT NOT NULL,
    bank         TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    action       TEXT NOT NULL CHECK (action IN ({_in_list(ACTIONS)})),
    note         TEXT,
    officer      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    prev_hash    TEXT NOT NULL,
    row_hash     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id    TEXT NOT NULL REFERENCES cases (case_id),
    event      TEXT NOT NULL CHECK (event IN ({_in_list(EVENTS)})),
    officer    TEXT NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    row_hash   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS output_bodies (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    output_seq INTEGER NOT NULL UNIQUE REFERENCES case_outputs (seq),
    sha256     TEXT NOT NULL,
    body       TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    row_hash   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS case_outputs_case ON case_outputs (case_id, doc_type, bank);
CREATE INDEX IF NOT EXISTS freeze_actions_case ON freeze_actions (case_id, account);
CREATE INDEX IF NOT EXISTS case_events_case ON case_events (case_id);
""" + "".join(
    f"""
CREATE TRIGGER IF NOT EXISTS {t}_no_{verb.lower()} BEFORE {verb} ON {t}
BEGIN SELECT RAISE(ABORT, '{t} is append-only: {verb} is not allowed'); END;
""" for t in COLUMNS for verb in ("UPDATE", "DELETE"))

TRIGGERS = tuple(f"{t}_no_{v}" for t in COLUMNS for v in ("update", "delete"))


def connect(db: Path = DEFAULT_DB) -> sqlite3.Connection:
    """Open (and create if needed) the case store. The caller closes it."""
    db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db), isolation_level=None, timeout=10)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(SCHEMA)
    except BaseException:
        con.close()
        raise
    return con


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _row_hash(prev_hash: str, values: tuple) -> str:
    body = json.dumps(list(values), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256((prev_hash + "\n" + body).encode("utf-8")).hexdigest()


def _append(con: sqlite3.Connection, table: str, values: tuple) -> None:
    """Insert one row at the end of the table's hash chain. Inside a transaction."""
    last = con.execute(f"SELECT row_hash FROM {table} ORDER BY seq DESC LIMIT 1").fetchone()
    prev_hash = last[0] if last else ""
    cols = COLUMNS[table]
    con.execute(
        f"INSERT INTO {table} ({', '.join(cols)}, prev_hash, row_hash) "
        f"VALUES ({', '.join('?' * (len(cols) + 2))})",
        (*values, prev_hash, _row_hash(prev_hash, values)))


def _write(db: Path, work):
    con = connect(db)
    try:
        con.execute("BEGIN IMMEDIATE")
        try:
            out = work(con)
            con.execute("COMMIT")
            return out
        except BaseException:
            con.execute("ROLLBACK")
            raise
    finally:
        con.close()


def _need(value, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"case_store: {name} is required")
    return value.strip()


def _need_case(con: sqlite3.Connection, case_id: str) -> None:
    if con.execute("SELECT 1 FROM cases WHERE case_id = ?", (case_id,)).fetchone() is None:
        raise ValueError(f"case_store: unknown case_id {case_id!r}")


def _need_open(con: sqlite3.Connection, case_id: str) -> None:
    _need_case(con, case_id)
    last = con.execute("SELECT event FROM case_events WHERE case_id = ? ORDER BY seq DESC LIMIT 1",
                       (case_id,)).fetchone()
    if last and last[0] == CLOSED:
        raise CaseClosedError(f"case_store: {case_id} is closed: nothing more can be recorded on it")


def _need_label(doc_type: str, generator: str) -> None:
    if doc_type not in DOC_TYPES:
        raise ValueError(f"case_store: doc_type must be one of {DOC_TYPES}")
    if generator not in DOC_GENERATORS[doc_type]:
        raise ValueError(f"case_store: generator of a {doc_type} must be one of {DOC_GENERATORS[doc_type]}")


def _mismatch(output_seq) -> str:
    return f"output_bodies: the stored document of case_outputs seq {output_seq} does not match its sha256"


def create_case(officer: str, victim_accts: list[str], dataset_sha256: str, profile_id: str,
                fir_number: str | None = None, complainant: str | None = None,
                db: Path = DEFAULT_DB) -> str:
    """Append a case with its OPENED event and return its case_id (CASE-000001, ...)."""
    officer = _need(officer, "officer")
    dataset_sha256 = _need(dataset_sha256, "dataset_sha256")
    profile_id = _need(profile_id, "profile_id")
    if not victim_accts or not all(isinstance(a, str) and a for a in victim_accts):
        raise ValueError("case_store: victim_accts must be a non-empty list of account numbers (text)")
    accts = json.dumps(list(victim_accts))

    def work(con):
        n = con.execute("SELECT coalesce(max(seq), 0) + 1 FROM cases").fetchone()[0]
        case_id = f"CASE-{n:06d}"
        now = _now()
        _append(con, "cases", (case_id, now, officer, fir_number, complainant, accts,
                               dataset_sha256, profile_id, STATUS_OPEN))
        _append(con, "case_events", (case_id, "OPENED", officer, None, now))
        return case_id

    return _write(db, work)


def add_output(case_id: str, doc_type: str, file_path: str | Path, validated: bool,
               generator: str, bank: str | None = None, sha256: str | None = None,
               db: Path = DEFAULT_DB) -> int:
    """Append a generated document and return its version (1, 2, ... per case,
    doc_type and bank). sha256 is taken from the file unless it is passed."""
    _need_label(doc_type, generator)
    if sha256 is None:
        p = Path(file_path)
        sha256 = hashlib.sha256((p if p.is_absolute() else ROOT / p).read_bytes()).hexdigest()

    def work(con):
        _need_open(con, case_id)
        version = con.execute(
            "SELECT coalesce(max(version), 0) + 1 FROM case_outputs "
            "WHERE case_id = ? AND doc_type = ? AND bank IS ?", (case_id, doc_type, bank)).fetchone()[0]
        _append(con, "case_outputs", (case_id, doc_type, bank, version, str(file_path), sha256,
                                      int(bool(validated)), generator, _now()))
        return version

    return _write(db, work)


def add_document(case_id: str, doc_type: str, name: str, html: str, validated: bool,
                 generator: str, bank: str | None = None, db: Path = DEFAULT_DB) -> dict:
    """Append a generated document AND its HTML (output_bodies) in one
    transaction. file_path is the name the page has when saved:
    <name>_v<version>.html. Returns {output_id, version, file_path, sha256, created_at}."""
    _need_label(doc_type, generator)
    name = _need(name, "name")
    if not isinstance(html, str) or not html:
        raise ValueError("case_store: html is required")
    sha256 = hashlib.sha256(html.encode("utf-8")).hexdigest()

    def work(con):
        _need_open(con, case_id)
        version = con.execute(
            "SELECT coalesce(max(version), 0) + 1 FROM case_outputs "
            "WHERE case_id = ? AND doc_type = ? AND bank IS ?", (case_id, doc_type, bank)).fetchone()[0]
        file_path, now = f"{name}_v{version}.html", _now()
        _append(con, "case_outputs", (case_id, doc_type, bank, version, file_path, sha256,
                                      int(bool(validated)), generator, now))
        output_id = con.execute("SELECT max(seq) FROM case_outputs").fetchone()[0]
        _append(con, "output_bodies", (output_id, sha256, html))
        return {"output_id": output_id, "version": version, "file_path": file_path,
                "sha256": sha256, "created_at": now}

    return _write(db, work)


def add_event(case_id: str, event: str, officer: str, note: str | None = None,
              db: Path = DEFAULT_DB) -> int:
    """Append a case event and return its seq. The latest event is the case's
    status; after CLOSED every write on the case raises CaseClosedError."""
    if event not in EVENTS:
        raise ValueError(f"case_store: event must be one of {EVENTS}")
    officer = _need(officer, "officer")

    def work(con):
        _need_open(con, case_id)
        _append(con, "case_events", (case_id, event, officer, note, _now()))
        return con.execute("SELECT max(seq) FROM case_events").fetchone()[0]

    return _write(db, work)


def add_freeze_action(case_id: str, account: str, bank: str, amount_paise: int, action: str,
                      officer: str, note: str | None = None, db: Path = DEFAULT_DB) -> int:
    """Append an officer action on an account and return its seq."""
    if action not in ACTIONS:
        raise ValueError(f"case_store: action must be one of {ACTIONS}")
    account, bank, officer = _need(account, "account"), _need(bank, "bank"), _need(officer, "officer")
    if isinstance(amount_paise, bool) or not isinstance(amount_paise, int) or amount_paise < 0:
        raise ValueError("case_store: amount_paise must be a non-negative integer (paise)")

    def work(con):
        _need_open(con, case_id)
        _append(con, "freeze_actions", (case_id, account, bank, amount_paise, action, note,
                                        officer, _now()))
        return con.execute("SELECT max(seq) FROM freeze_actions").fetchone()[0]

    return _write(db, work)


# --- reads ----------------------------------------------------------------------

# A case's status is its latest event; a case opened before case_events existed
# has none and keeps the status of its own row.
_CASE_SQL = """
    SELECT c.case_id, c.created_at, c.officer, c.fir_number, c.complainant, c.victim_accts,
           c.dataset_sha256, c.profile_id,
           coalesce((SELECT e.event FROM case_events e WHERE e.case_id = c.case_id
                     ORDER BY e.seq DESC LIMIT 1), c.status) AS status
    FROM cases c"""
# The account's latest action in its case is still REQUESTED.
_STILL_REQUESTED = """action = 'REQUESTED' AND seq = (
    SELECT max(g.seq) FROM freeze_actions g
    WHERE g.case_id = freeze_actions.case_id AND g.account = freeze_actions.account)"""


def _rows(con: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    cur = con.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _read(db: Path, work):
    con = connect(db)
    try:
        return work(con)
    finally:
        con.close()


def _case(row: dict) -> dict:
    row["victim_accts"] = json.loads(row["victim_accts"])
    return row


def _select(con: sqlite3.Connection, table: str, case_id: str | None, extra: str | None = None) -> list[dict]:
    where = [w for w in ("case_id = ?" if case_id else None, extra) if w]
    return _rows(con, f"SELECT seq, {', '.join(COLUMNS[table])}, row_hash FROM {table} "
                      f"{'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY seq",
                 (case_id,) if case_id else ())


def list_cases(db: Path = DEFAULT_DB) -> list[dict]:
    return _read(db, lambda con: [_case(r) for r in _rows(con, _CASE_SQL + " ORDER BY c.seq")])


def get_case(case_id: str, db: Path = DEFAULT_DB) -> dict | None:
    """The case with its events, outputs and freeze actions; None if unknown."""
    def work(con):
        found = _rows(con, _CASE_SQL + " WHERE c.case_id = ?", (case_id,))
        if not found:
            return None
        return {**_case(found[0]),
                "events": _select(con, "case_events", case_id),
                "outputs": _select(con, "case_outputs", case_id),
                "freeze_actions": _select(con, "freeze_actions", case_id)}

    return _read(db, work)


def list_outputs(case_id: str | None = None, db: Path = DEFAULT_DB) -> list[dict]:
    return _read(db, lambda con: _select(con, "case_outputs", case_id))


def document_body(output_id: int, db: Path = DEFAULT_DB) -> str | None:
    """The stored HTML of a case_outputs row (None if it was not stored here)."""
    def work(con):
        r = con.execute("SELECT body FROM output_bodies WHERE output_seq = ?", (output_id,)).fetchone()
        return r[0] if r else None

    return _read(db, work)


def case_documents(case_id: str, output_id: int | None = None, db: Path = DEFAULT_DB) -> list[dict]:
    """The case's outputs (or the one named), each with its stored HTML as
    `body` (None if the page was not stored here). Every stored page is re-hashed
    first: DocumentMismatch if one no longer has its recorded sha256."""
    def work(con):
        rows = _select(con, "case_outputs", case_id,
                       None if output_id is None else f"seq = {int(output_id)}")
        for r in rows:
            b = con.execute("SELECT body FROM output_bodies WHERE output_seq = ?", (r["seq"],)).fetchone()
            r["body"] = b[0] if b else None
            if b and hashlib.sha256(b[0].encode("utf-8")).hexdigest() != r["sha256"]:
                raise DocumentMismatch(_mismatch(r["seq"]))
        return rows

    return _read(db, work)


def current_requests(case_id: str | None = None, db: Path = DEFAULT_DB) -> list[dict]:
    """Accounts whose latest action in their case is REQUESTED."""
    return _read(db, lambda con: _select(con, "freeze_actions", case_id, _STILL_REQUESTED))


def verify(db: Path = DEFAULT_DB) -> dict:
    """Integrity check: nothing was updated or deleted. Read-only."""
    if not db.is_file():
        raise FileNotFoundError(f"case_store: case store not found: {db}")
    con = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        problems: list[str] = []
        sqlite_ok = con.execute("PRAGMA integrity_check").fetchone()[0]
        if sqlite_ok != "ok":
            problems.append(f"sqlite integrity_check: {sqlite_ok}")
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
        problems += [f"trigger missing: {t}" for t in TRIGGERS if t not in have]
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        counters = (dict(con.execute("SELECT name, seq FROM sqlite_sequence").fetchall())
                    if "sqlite_sequence" in tables else {})
        rows = {}
        for table, cols in COLUMNS.items():
            if table not in tables:
                problems.append(f"table missing: {table}")
                continue
            data = con.execute(
                f"SELECT seq, prev_hash, row_hash, {', '.join(cols)} FROM {table} ORDER BY seq").fetchall()
            rows[table] = len(data)
            prev = ""
            for i, (seq, prev_hash, row_hash, *values) in enumerate(data, start=1):
                if seq != i:
                    problems.append(f"{table}: seq {i} is missing (a row was deleted)")
                    break
                if prev_hash != prev or row_hash != _row_hash(prev, tuple(values)):
                    problems.append(f"{table}: row seq {seq} does not match its hash (changed or re-ordered)")
                    break
                prev = row_hash
            if counters.get(table, 0) != len(data):
                problems.append(f"{table}: {len(data)} rows but {counters.get(table, 0)} were issued "
                                f"(rows were deleted)")
        for table in (t for t in CASE_TABLES if t in tables):
            orphans = con.execute(
                f"SELECT count(*) FROM {table} t LEFT JOIN cases c ON c.case_id = t.case_id "
                f"WHERE c.case_id IS NULL").fetchone()[0]
            if orphans:
                problems.append(f"{table}: {orphans} row(s) point to a case that does not exist")
        if {"case_outputs", "output_bodies"} <= tables:
            for seq, sha, body in con.execute(
                    "SELECT b.output_seq, o.sha256, b.body FROM output_bodies b "
                    "LEFT JOIN case_outputs o ON o.seq = b.output_seq ORDER BY b.seq").fetchall():
                if sha is None or hashlib.sha256(body.encode("utf-8")).hexdigest() != sha:
                    problems.append(_mismatch(seq))
        return {"ok": not problems, "rows": rows, "triggers": len(have & set(TRIGGERS)),
                "problems": problems}
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Create the case store and check its integrity.")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite case store")
    args = ap.parse_args()

    t0 = time.perf_counter()
    existed = args.db.is_file()
    con = connect(args.db)
    con.close()
    r = verify(args.db)
    print(f"runtime {time.perf_counter() - t0:.2f} s   case store {args.db.name} "
          f"({'already there' if existed else 'created'})")
    print("rows   " + "   ".join(f"{t} {n}" for t, n in r["rows"].items())
          + f"   append-only triggers {r['triggers']}/{len(TRIGGERS)}")
    for p in r["problems"]:
        print(f"PROBLEM  {p}")
    if not r["ok"]:
        raise SystemExit("case_store: FAILED integrity check")
    print("PASSED")


if __name__ == "__main__":
    main()
