"""
audits/check_api.py -- checks the API (Step 6 batches B1, B2, B3, B4a, B4b; Step 8d) against the database.

data\\case.duckdb is only read. The Step 8d write routes run on a SCRATCH case
store in %TEMP% (ABHEDYA_CASES_DB), never on data\\cases.db. Uses FastAPI's
TestClient (no server, no network; --llm also asks the local model once).

Checked (8d): a case opens with its OPENED event, the dataset SHA-256 and the
active profile; notices, diary and FIR draft are stored with the sha256 of the
page returned and each passes its validator (the notices also the Step 8b
audit's check, against a trace run here); the diary comes back as the template
without asking the model, and its summary route stores AI text only when the
answer validates; the freeze routes record REQUESTED / WITHDRAWN rows with the
trace's holding and never say a bank was notified; after every request every
earlier row of the case store is still there unchanged, UPDATE and DELETE are
refused; vault verify passes on the clean store and fails on five tampered
copies; data\\cases.db is untouched.

Checked (8d follow-up): the diary route's page is labelled TEMPLATE (model not
asked), TEMPLATE_FALLBACK only after a failed attempt, and a page stored under
another label than it prints is rejected, as is a label the document type cannot
carry; GET /cases/{id}/outputs/{output_id} returns each stored page byte for
byte with its sha256, and answers 409 with the vault error on a tampered copy;
POST /cases/{id}/close appends CLOSED, after which every write route answers
409 and writes nothing, while the read routes still answer.

Checked (7c1): every account the API returns with a bank also carries the
bank_directory name of that bank (entities for ALL accounts, victims, mules,
trace nodes and freeze list, batch, cell summaries); bank_stats names are all
filled; trace answers carry elapsed_ms, no larger than the request's timing
header; both dev-server origins pass CORS; every table has the same row count
after the run as before it.

Checked (B4b): the benchmark's ingest and graph times equal ingest_meta and
the graph manifest, its trace sample is measured and no speed-up is claimed; the
blind test marks every VICTIM account correct, agrees with GET /trace on what
each trace found, repeats for a seed, and carries no ground-truth metric.

Checked (B4a): the scanner summary and the problematic-transaction filters equal
SQL written here, and the fields our data lacks are null; the CSV template has
the 11 columns and one example row; deferred endpoints answer 501, dropped ones
410, the frozen-accounts list is empty.

Checked (B3): the active profile's weights, switches and gate status equal the
stored definition; a preview with NO changes reproduces the stored scores (0
flags gained / lost, 0 role changes, 0 final-index movement); a preview with
MP4 weight 0 is internally consistent; invalid changes answer 422; profile
writes answer 501; transaction search counts equal SQL written here and unknown
fields are refused; trace nodes that send carry a device and an IP.

Checked (B2): the sample trace has 11 traced accounts + the victim root and 11
links, reconciles to 0 and carries the fingerprint the CLI prints; link amounts,
lags and IFSCs equal SQL written here; filters change only the returned graph;
an unknown account answers found=false; the batch trace agrees with the single
traces; every cell's /victims equals reverse_trace_cell.

Checked (B1):
  * every response is HTTP 200, carries the timing header and passes its schema
    (the Pydantic models reject unknown fields);
  * counts match SQL run here, independently of the API's repositories
    (e.g. /mules?role_filter=L2 against count(*) of scores with that role);
  * filters (role, min_risk, min_amount, bank, limit) match the same filter in SQL;
  * errors are clean JSON (404, 422) and CORS answers the UI origin;
  * data\\case.duckdb is unchanged after the run (size and modified time) and
    no .wal file appeared.

Filter values (a risk cut, a bank, an amount) are taken from the data, not
hard-coded. Run:  .venv\\Scripts\\python.exe audits\\check_api.py [--samples]
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import duckdb
import yaml
from pydantic import TypeAdapter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from api.deps import DEFAULT_CASES_DB, db_path  # noqa: E402
from api.main import app  # noqa: E402
from api.middleware import ALLOWED_ORIGINS, TIMING_HEADER  # noqa: E402
from api.schemas.cases import (  # noqa: E402
    ArtifactsResponse, CaseDetail, CaseOutputs, CasesResponse, FreezeResponse, FrozenAccount,
    VerifyResponse)
from api.schemas.legal import DiarySummary, LegalDocument, NoticesResponse  # noqa: E402
from api.schemas.benchmark import (  # noqa: E402
    DEFAULT_JURY_VICTIMS, MAX_JURY_VICTIMS, BenchmarkResponse, JuryResponse)
from api.schemas.entities import EntitiesResponse  # noqa: E402
from api.schemas.mules import MuleItem  # noqa: E402
from api.schemas.profiles import PreviewResponse, ProfileResponse  # noqa: E402
from api.schemas.scanner import (  # noqa: E402
    MAX_SCANNER_LIMIT, ProblematicTransaction, ScannerSummary)
from api.schemas.status import StatusResponse  # noqa: E402
from api.schemas.trace import (  # noqa: E402
    BatchNotFound, BatchResponse, CellsResponse, CellSummary, CellVictims, NetworkResponse,
    NotFound, TraceResponse)
from api.schemas.transactions import MAX_SEARCH_LIMIT, TransactionSearchResponse  # noqa: E402
from api.schemas.victims import VictimsResponse  # noqa: E402
from api.services import rupees  # noqa: E402
from api.services.cases import case_store  # noqa: E402
from api.services.legal import build_evidence  # noqa: E402
from api.services.legal import diary as diary_mod  # noqa: E402
from api.services.legal import fir as fir_mod  # noqa: E402
from api.services.legal import notices as notices_mod  # noqa: E402
from api.services.trace import engine  # noqa: E402

sys.path.insert(0, str(ROOT / "audits"))
import check_notices  # noqa: E402

SCHEMAS_8D = {
    "case": TypeAdapter(CaseDetail),
    "cases": TypeAdapter(CasesResponse),
    "notices": TypeAdapter(NoticesResponse),
    "document": TypeAdapter(LegalDocument),
    "diary_summary": TypeAdapter(DiarySummary),
    "freeze": TypeAdapter(FreezeResponse),
    "frozen": TypeAdapter(list[FrozenAccount]),
    "artifacts": TypeAdapter(ArtifactsResponse),
    "verify": TypeAdapter(VerifyResponse),
    "outputs": TypeAdapter(CaseOutputs),
}
CASES_ENV = "ABHEDYA_CASES_DB"
SCRATCH_DIR = Path(os.environ["TEMP"]) / "abhedya_check_api"
OFFICER = "AUDIT"
# Step 8d: the routes that append to the case store (vault/verify only reads it).
CASE_STORE_POSTS = ["POST /api/cases", "POST /api/cases/{case_id}/close", "POST /api/legal/fir", "POST /api/scanner/emergency-freeze",
                    "POST /api/scanner/unfreeze", "POST /api/vault/verify"]

SCHEMAS = {
    "/api/status": TypeAdapter(StatusResponse),
    "/api/victims": TypeAdapter(VictimsResponse),
    "/api/detected-victims": TypeAdapter(VictimsResponse),
    "/api/mules": TypeAdapter(list[MuleItem]),
    "/api/entities": TypeAdapter(EntitiesResponse),
    "trace": TypeAdapter(TraceResponse),
    "not_found": TypeAdapter(NotFound),
    "batch": TypeAdapter(BatchResponse),
    "batch_not_found": TypeAdapter(BatchNotFound),
    "/api/cells": TypeAdapter(CellsResponse),
    "cell": TypeAdapter(CellSummary),
    "cell_victims": TypeAdapter(CellVictims),
    "/api/network": TypeAdapter(NetworkResponse),
    "profile": TypeAdapter(ProfileResponse),
    "preview": TypeAdapter(PreviewResponse),
    "/api/transactions/search": TypeAdapter(TransactionSearchResponse),
    "/api/scanner/summary": TypeAdapter(ScannerSummary),
    "benchmark": TypeAdapter(BenchmarkResponse),
    "jury": TypeAdapter(JuryResponse),
    "/api/scanner/problematic-transactions": TypeAdapter(list[ProblematicTransaction]),
}

SAMPLE_VICTIM = "SBIN10000294"     # the trace the task names; 11 accounts, 11 transfers
SAMPLE_ACCOUNTS = 11
SAMPLE_LINKS = 11
UNKNOWN_ACCOUNT = "NOSUCHACCOUNT0000"
BANK_NAME_PLACES = 11             # the places below that return a bank with its name
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]   # the Vite dev server
READ_ONLY_POSTS = ["POST /api/profiles/preview", "POST /api/trace/batch",
                   "POST /api/scanner/run-60s-benchmark", "POST /api/jury/blind-test"]
BENCHMARK_TRACES = 20             # the sample size the task names
JURY_SEED = 7                     # any fixed seed: the same victims twice
# Profile writes are deferred: these routes exist and answer 501.
DEFERRED_POSTS = ["POST /api/profiles", "POST /api/profiles/{profile_id}/activate"]
# API_CONTRACT.md rows marked DEFERRED / LATER (501) and DROP (410), as (method, path called).
DEFERRED_B4 = [("POST", "/api/upload"), ("GET", "/api/vault/certificate/x")]
DROPPED = [
    ("POST", "/api/victim/load-demo/case_sunil_4hop"), ("POST", "/api/ingest-url"),
    ("GET", "/api/settings"), ("POST", "/api/settings"),
    ("POST", "/api/settings/test-connection"), ("POST", "/api/assistant/chat")]
REFUSED_POSTS = [
    "POST /api/upload", "POST /api/victim/load-demo/{demo_id}", "POST /api/ingest-url",
    "POST /api/settings", "POST /api/settings/test-connection", "POST /api/assistant/chat"]
TEMPLATE_COLUMNS = [
    "Transaction_ID", "Sender_Account", "Receiver_Account", "Sender_IFSC", "Receiver_IFSC",
    "Amount", "Timestamp", "Payment_Mode", "Narration", "IP_Address", "Device_Type"]
# Fields the UI reads that our data does not have: always null.
SUMMARY_NULLS = ("elapsed_seconds", "speedup_factor", "throughput_txns_per_second",
                 "benchmark_passed", "target_seconds", "parameters_evaluated",
                 "heavy_whale_transactions", "hyper_frequency_accounts")
ROW_NULLS = ("hop_stage", "anomaly_flags", "urgency", "estimated_minutes_to_exit",
             "is_scam_narration")
# The explorer's population, written here independently of the API's joins.
SCOPE = ("(EXISTS (SELECT 1 FROM layer_links l WHERE l.tx_key = t.tx_key AND l.profile_id = ?) "
         "OR t.src IN (SELECT acct_id FROM scores WHERE profile_id = ? AND is_flagged) "
         "OR t.dst IN (SELECT acct_id FROM scores WHERE profile_id = ? AND is_flagged))")
LINK = "EXISTS (SELECT 1 FROM layer_links l WHERE l.tx_key = t.tx_key AND l.profile_id = ?{})"
PREVIEW_PARAMETER = "MP4"         # the change the task names: its weight set to 0
PREVIEW_LIST_LIMIT = 200          # the preview's default account_limit

results: list[tuple[str, bool, str]] = []
timings: dict[str, list[float]] = {}


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))


def same(name: str, got, want) -> None:
    check(name, got == want, f"api {got} / db {want}")


def file_state(path: Path) -> tuple[int, int]:
    st = path.stat()
    return st.st_size, st.st_mtime_ns


def table_counts(db: Path) -> dict[str, int]:
    """Row count of every table: the content the API run must leave as it found it."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        tables = [r[0] for r in con.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY 1").fetchall()]
        return {t: con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in tables}
    finally:
        con.close()


def expected_banks(db: Path) -> dict:
    """Bank names from SQL written here: per bank code and per account."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        return {
            "directory": dict(con.execute(
                "SELECT bank_prefix, bank_name FROM bank_directory").fetchall()),
            "codes": [r[0] for r in con.execute(
                "SELECT DISTINCT bank FROM accounts ORDER BY 1").fetchall()],
            "of_account": dict(con.execute(
                "SELECT a.acct_no, d.bank_name FROM accounts a "
                "LEFT JOIN bank_directory d ON d.bank_prefix = a.bank").fetchall()),
        }
    finally:
        con.close()


def expected(db: Path) -> dict:
    """Everything the API should agree with, from SQL written here."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        one = lambda sql, p=None: con.execute(sql, p or []).fetchone()[0]  # noqa: E731
        pid = one("SELECT profile_id FROM scoring_profiles WHERE is_active")
        e = {"profile_id": pid}
        e["ingest"] = con.execute(
            "SELECT rows_loaded, rows_total, load_seconds, file_sha256 FROM ingest_meta "
            "ORDER BY load_id DESC LIMIT 1").fetchone()
        e["accounts"] = one("SELECT count(*) FROM accounts")
        e["flagged"] = one("SELECT count(*) FROM scores WHERE profile_id = ? AND is_flagged", [pid])
        e["freeze"] = one(
            "SELECT count(*) FROM scores WHERE profile_id = ? AND freeze_recommended", [pid])
        e["roles"] = dict(con.execute(
            "SELECT role, count(*) FROM scores WHERE profile_id = ? AND role IS NOT NULL "
            "GROUP BY role", [pid]).fetchall())
        e["flagged_roles"] = dict(con.execute(
            "SELECT role, count(*) FROM scores WHERE profile_id = ? AND is_flagged "
            "AND role IS NOT NULL GROUP BY role", [pid]).fetchall())
        e["cells"] = one("SELECT count(*) FROM cells WHERE profile_id = ?", [pid])
        e["foreign"] = one("SELECT count(*) FROM tx WHERE is_foreign_ip")
        e["receivers"] = one("SELECT count(DISTINCT dst) FROM tx")
        e["holding_paise"] = one(
            "SELECT sum(holding_paise) FROM scores WHERE profile_id = ? AND is_flagged", [pid])
        e["victim_paid_paise"] = one(
            "SELECT sum(amount_paise) FROM layer_links WHERE profile_id = ? "
            "AND link_type = 'VICTIM_L1'", [pid])
        # Filter values taken from the data.
        e["risk_cut"] = one(
            "SELECT median(final_index) FROM scores WHERE profile_id = ? AND is_flagged", [pid])
        e["n_risk"] = one(
            "SELECT count(*) FROM scores WHERE profile_id = ? AND is_flagged "
            "AND final_index >= ?", [pid, e["risk_cut"]])
        e["bank"], e["n_bank_mules"] = con.execute(
            "SELECT a.bank, count(*) FROM scores s JOIN accounts a USING (acct_id) "
            "WHERE s.profile_id = ? AND s.is_flagged GROUP BY a.bank "
            "ORDER BY count(*) DESC, a.bank LIMIT 1", [pid]).fetchone()
        e["n_bank_accounts"] = one("SELECT count(*) FROM accounts WHERE bank = ?", [e["bank"]])
        e["amount_cut_paise"] = one(
            "SELECT CAST(median(tot) AS BIGINT) FROM (SELECT sum(t.amount_paise) AS tot "
            "FROM tx t JOIN scores s ON s.acct_id = t.dst "
            "WHERE s.profile_id = ? AND s.is_flagged GROUP BY t.dst)", [pid])
        e["n_amount"] = one(
            "SELECT count(*) FROM (SELECT sum(t.amount_paise) AS tot "
            "FROM tx t JOIN scores s ON s.acct_id = t.dst "
            "WHERE s.profile_id = ? AND s.is_flagged GROUP BY t.dst) WHERE tot >= ?",
            [pid, e["amount_cut_paise"]])
        return e
    finally:
        con.close()


def expected_b2(db: Path, pid: str, tx_keys: list[int], acct_nos: list[str]) -> dict:
    """What the B2 endpoints should agree with, from SQL written here."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        e = {}
        e["tx"] = {k: (amt, mode) for k, amt, mode in con.execute(
            "SELECT tx_key, amount_paise, mode FROM tx WHERE tx_key IN (SELECT unnest(?))",
            [tx_keys]).fetchall()}
        e["lag"] = dict(con.execute(
            "SELECT tx_key, lag_seconds FROM layer_links WHERE profile_id = ? "
            "AND tx_key IN (SELECT unnest(?))", [pid, tx_keys]).fetchall())
        e["ifsc"] = dict(con.execute(
            "SELECT acct_no, ifsc FROM accounts WHERE acct_no IN (SELECT unnest(?))",
            [acct_nos]).fetchall())
        e["max_hops"] = con.execute(
            "SELECT CAST(json_extract(definition, '$.trace.max_hops') AS INTEGER) "
            "FROM scoring_profiles WHERE profile_id = ?", [pid]).fetchone()[0]
        e["cells"] = dict(con.execute(
            "SELECT cell_id, victim_count FROM cells WHERE profile_id = ?", [pid]).fetchall())
        e["networks"] = con.execute(
            "SELECT count(*) FROM rings WHERE profile_id = ?", [pid]).fetchone()[0]
        return e
    finally:
        con.close()


def expected_b3(db: Path, pid: str) -> dict:
    """What the B3 endpoints should agree with, from SQL written here."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        d = json.loads(con.execute(
            "SELECT CAST(definition AS VARCHAR) FROM scoring_profiles WHERE profile_id = ?",
            [pid]).fetchone()[0])
        params = (d["mule_index"]["parameters"] + d["mule_index"].get("zero_weight_parameters", [])
                  + d["trust_index"]["parameters"])
        gates = {g["id"]: g["status"] for g in d.get("reliability_gates", [])}
        return {
            "definition": d,
            "weights": {x["id"]: x["weight"] for x in params},
            "enabled": {x["id"]: bool(x.get("enabled")) for x in params},
            "gate_status": {x["id"]: gates[x["gate"]] for x in params if x.get("gate")},
            "bands": dict(con.execute(
                "SELECT band, count(*) FROM scores WHERE profile_id = ? GROUP BY band",
                [pid]).fetchall()),
            "role_counts": dict(con.execute(
                "SELECT coalesce(role, 'NONE'), count(*) FROM scores WHERE profile_id = ? "
                "GROUP BY 1", [pid]).fetchall()),
            "links": con.execute(
                "SELECT count(*) FROM layer_links WHERE profile_id = ?", [pid]).fetchone()[0],
        }
    finally:
        con.close()


def expected_b4(db: Path, pid: str) -> dict:
    """What the B4a scanner endpoints should agree with, from SQL written here."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        scope = ("FROM tx t JOIN accounts s ON s.acct_id = t.src "
                 "JOIN accounts d ON d.acct_id = t.dst WHERE " + SCOPE)
        e = {"tx": con.execute("SELECT count(*) FROM tx").fetchone()[0]}
        e["scope_n"], e["scope_paise"], e["foreign_n"], e["foreign_paise"] = con.execute(
            "SELECT count(*), sum(t.amount_paise), count(*) FILTER (WHERE t.is_foreign_ip), "
            "coalesce(sum(t.amount_paise) FILTER (WHERE t.is_foreign_ip), 0) " + scope,
            [pid] * 3).fetchone()
        e["types"] = {k: (n, amt) for k, n, amt in con.execute(
            "SELECT link_type, count(*), sum(amount_paise) FROM layer_links "
            "WHERE profile_id = ? GROUP BY link_type", [pid]).fetchall()}
        e["holders"] = con.execute(
            "SELECT count(*) FROM scores WHERE profile_id = ? AND is_flagged "
            "AND holding_paise > 0", [pid]).fetchone()[0]
        e["amount_cut"] = con.execute(
            "SELECT CAST(median(t.amount_paise) AS BIGINT) " + scope, [pid] * 3).fetchone()[0]
        e["bank"] = con.execute(
            "SELECT d.bank " + scope + " GROUP BY d.bank ORDER BY count(*) DESC, d.bank LIMIT 1",
            [pid] * 3).fetchone()[0]
        e["category"] = con.execute(
            "SELECT split_part(split_part(t.narration, '/', 2), '#', 1) AS c " + scope
            + " GROUP BY c ORDER BY count(*) DESC, c LIMIT 1", [pid] * 3).fetchone()[0]
        return e
    finally:
        con.close()


def tx_count(db: Path, where: str = "TRUE", params: list | None = None) -> int:
    """count(*) of tx (with both accounts joined) under a condition written by the audit."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        return con.execute(
            "SELECT count(*) FROM tx t JOIN accounts s ON s.acct_id = t.src "
            "JOIN accounts d ON d.acct_id = t.dst WHERE " + where, params or []).fetchone()[0]
    finally:
        con.close()


def post(client: TestClient, path: str, schema: str | None, body: dict, expect: int = 200):
    """POST, then status / timing / schema checks. Returns the JSON body."""
    label = f"POST {path} {json.dumps(body)[:70]}"
    r = client.post(path, json=body)
    check(f"{label}  {expect}", r.status_code == expect, f"HTTP {r.status_code} {r.text[:200]}")
    if TIMING_HEADER in r.headers and expect == 200:
        timings.setdefault(schema or path, []).append(float(r.headers[TIMING_HEADER]))
    if r.status_code == 200 and schema:
        try:
            SCHEMAS[schema].validate_python(r.json(), strict=False)
            check(f"{label}  schema", True)
        except Exception as ex:
            check(f"{label}  schema", False, str(ex)[:300])
    return r.json()


def cli_fingerprint(victim: str) -> str | None:
    """The fingerprint the engine's own command line prints for this victim."""
    out = subprocess.run(
        [sys.executable, str(ROOT / "engine" / "victim_trace.py"), "--victim", victim, "--json"],
        capture_output=True, text=True, check=True).stdout
    return json.loads(out)["fingerprint"]


def paise(amount_rupees: float) -> int:
    return round(amount_rupees * 100)


def get(client: TestClient, path: str, schema: str | None = None, **params):
    """GET, then the checks every response must pass. Returns the JSON body."""
    label = path + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")
    r = client.get(path, params=params)
    check(f"{label}  200", r.status_code == 200, f"HTTP {r.status_code}")
    check(f"{label}  timing header", TIMING_HEADER in r.headers)
    if TIMING_HEADER in r.headers:
        timings.setdefault(schema or path, []).append(float(r.headers[TIMING_HEADER]))
    body = r.json()
    if r.status_code == 200:
        try:
            SCHEMAS[schema or path].validate_python(body, strict=False)
            check(f"{label}  schema", True)
        except Exception as ex:  # report, do not stop the audit
            check(f"{label}  schema", False, str(ex)[:300])
    return body


TRIMMED = ("entities", "bank_stats", "items", "nodes", "links", "per_hop", "findings",
           "freeze_candidates", "receipts", "cells", "victims", "freeze_accounts", "networks",
           "evidence")


def trim(body):
    """One item per list and at most 2 reasons, for the report."""
    if isinstance(body, list):
        return [trim(body[0])] if body else []
    if isinstance(body, dict):
        return {k: (v[:2] if k in ("reasons", "forensic_reasons") else
                    (v[:160] if k == "forensic_reason" else
                     trim(v) if isinstance(v, (list, dict)) and k in TRIMMED else v))
                for k, v in body.items()}
    return body


def chain(db: Path) -> dict[str, list[tuple]]:
    """(seq, row_hash) of every row of every case-store table, in seq order."""
    con = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        return {t: con.execute(f"SELECT seq, row_hash FROM {t} ORDER BY seq").fetchall()
                for t in case_store.COLUMNS}
    finally:
        con.close()


def raw_sql(db: Path, *statements: str) -> None:
    """Run statements straight on the file, as a tamperer would."""
    con = sqlite3.connect(str(db), isolation_level=None)
    try:
        for sql in statements:
            con.execute(sql)
    finally:
        con.close()


def call(client: TestClient, method: str, path: str, schema: str | None = None,
         expect: int = 200, **kwargs):
    """One request to a Step 8d route: status, timing header, schema. Returns the JSON body."""
    label = f"{method} {path} {json.dumps(kwargs.get('params') or kwargs.get('json') or {})[:60]}"
    r = client.request(method, path, **kwargs)
    check(f"{label}  {expect}", r.status_code == expect, f"HTTP {r.status_code} {r.text[:300]}")
    if TIMING_HEADER in r.headers and schema and r.status_code == expect:
        timings.setdefault(schema, []).append(float(r.headers[TIMING_HEADER]))
    if schema and r.status_code == expect:
        try:
            SCHEMAS_8D[schema].validate_python(r.json(), strict=False)
            check(f"{label}  schema", True)
        except Exception as ex:
            check(f"{label}  schema", False, str(ex)[:300])
    return r.json()


def check_case_store_api(client: TestClient, db: Path, e: dict, scratch: Path, live_llm: bool) -> dict:
    """Step 8d: the write routes, on the scratch case store only."""
    V = SAMPLE_VICTIM
    steps: list[dict] = [chain(scratch)] if scratch.is_file() else []

    def appended(step: str) -> None:
        """Every row that was there before this step is still there, unchanged."""
        now = chain(scratch)
        if steps:
            check(f"rows only appended: {step}",
                  all(now[t][:len(rows)] == rows for t, rows in steps[-1].items()))
        steps.append(now)

    con = duckdb.connect(str(db), read_only=True)
    try:
        dataset_sha = con.execute(
            "SELECT file_sha256 FROM ingest_meta ORDER BY load_id DESC LIMIT 1").fetchone()[0]
        ifsc = dict(con.execute("SELECT acct_no, ifsc FROM accounts").fetchall())
        directory = {r[0]: r[1:] for r in con.execute(
            "SELECT bank_prefix, bank_name, nodal_officer_title, address_block "
            "FROM bank_directory").fetchall()}
    finally:
        con.close()
    legal_cfg = yaml.safe_load((ROOT / "legal" / "config.yaml").read_text(encoding="utf-8"))
    trace = engine.trace_victim(V, db)                     # run here, apart from the API
    candidates = {c["acct_no"]: c for c in trace["freeze_candidates"]}
    banks = sorted({c["bank"] for c in candidates.values()})

    # cases
    case = call(client, "POST", "/api/cases", "case", 201, json={
        "victims": [V], "officer": OFFICER, "fir_number": "AUDIT/8D/1", "complainant": "AUDIT"})
    cid = case["case_id"]
    appended("POST /cases")
    same("case: status is its only event", (case["status"], [x["event"] for x in case["events"]]),
         ("OPENED", ["OPENED"]))
    same("case: dataset SHA-256 is ingest_meta's", case["dataset_sha256"], dataset_sha)
    same("case: profile is the active one", case["profile_id"], e["profile_id"])
    for name, bad in (("unknown account", {"victims": [UNKNOWN_ACCOUNT], "officer": OFFICER}),
                      ("no victims", {"victims": [], "officer": OFFICER}),
                      ("blank officer", {"victims": [V], "officer": "  "}),
                      ("unknown field", {"victims": [V], "officer": OFFICER, "status": "CLOSED"})):
        r = client.post("/api/cases", json=bad)
        check(f"POST /cases {name} -> 422", r.status_code == 422, f"HTTP {r.status_code}")
    appended("refused cases wrote nothing")
    same("refused cases wrote nothing (one case)", len(steps[-1]["cases"]), 1)
    listed = call(client, "GET", "/api/cases", "cases")
    same("GET /cases lists the case", [c["case_id"] for c in listed["cases"]], [cid])
    r = client.get("/api/cases/CASE-999999")
    check("GET /cases/{unknown} -> 404", r.status_code == 404, f"HTTP {r.status_code}")

    def stored(doc: dict, label: str) -> None:
        body = case_store.document_body(doc["output_id"], scratch)
        check(f"{label}: sha256 is the page's and the stored copy is the page",
              body == doc["html"] and doc["sha256"] == hashlib.sha256(doc["html"].encode("utf-8")).hexdigest())
        check(f"{label}: DRAFT label, dataset SHA-256 and fingerprint on the page",
              all(x in doc["html"] for x in (legal_cfg["draft_label"], dataset_sha, trace["fingerprint"])))

    def evidence_of(doc: dict) -> dict:
        """The evidence rebuilt here, stamped with the page's own time and generator."""
        return {**build_evidence(V, cid, case["fir_number"], db),
                "generated_at": doc["generated_at"], "generator": doc["generator"]}

    # freeze notices
    for name, params, status in (("no case_id", {}, 422), ("unknown case", {"case_id": "CASE-999999"}, 404)):
        r = client.get(f"/api/legal/notices/{V}", params=params)
        check(f"notices {name} -> {status}", r.status_code == status, f"HTTP {r.status_code}")
    other = next(a for a in candidates if a != V)
    r = client.get(f"/api/legal/notices/{other}", params={"case_id": cid})
    check("notices for an account that is not the case's victim -> 422", r.status_code == 422,
          f"HTTP {r.status_code}")
    nt = call(client, "GET", f"/api/legal/notices/{V}", "notices", params={"case_id": cid})
    appended("GET /legal/notices")
    same("notices: one per bank of the trace's freeze list", [n["bank"] for n in nt["notices"]], banks)
    check_notices.CASE_ID = cid
    for n in nt["notices"]:
        ev = evidence_of(n)
        problems = check_notices.check_notice(n["html"], n["bank"], trace, ifsc, directory, dataset_sha,
                                              legal_cfg)
        problems += notices_mod.validate_notice(
            n["html"], ev, next(b for b in ev["banks"] if b["bank_prefix"] == n["bank"]))
        check(f"notice {n['bank']} passes its validator and the Step 8b audit", not problems, str(problems[:3]))
        stored(n, f"notice {n['bank']}")

    # case diary: the template at once, the AI narrative apart
    dy = call(client, "GET", f"/api/legal/case-diary/{V}", "document", params={"case_id": cid})
    appended("GET /legal/case-diary")
    same("diary: labelled TEMPLATE, model not asked", dy["generator"], diary_mod.GENERATOR_TEMPLATE)
    relabelled = dy["html"].replace(">TEMPLATE<", ">TEMPLATE_FALLBACK<")
    check("diary validator rejects a page printing another label than it is stored under",
          relabelled != dy["html"] and bool(diary_mod.validate_html(relabelled, evidence_of(dy)))
          and bool(diary_mod.validate_html(dy["html"], {**evidence_of(dy), "generator": "TEMPLATE_FALLBACK"})))
    for doc_type, label in (("FREEZE_NOTICE", "TEMPLATE_FALLBACK"), ("FIR", "LLM+VALIDATED"),
                            ("CASE_DIARY", "LLM")):
        try:
            case_store.add_document(cid, doc_type, "audit", "audit", True, label, bank=None, db=scratch)
            check(f"case store refuses a {doc_type} labelled {label}", False)
        except ValueError:
            check(f"case store refuses a {doc_type} labelled {label}", True)
    appended("refused labels wrote nothing")
    check("diary passes its validator", not diary_mod.validate_html(dy["html"], evidence_of(dy)),
          str(diary_mod.validate_html(dy["html"], evidence_of(dy))[:3]))
    stored(dy, "diary")

    ask = diary_mod.ask_ollama
    sp = f"/api/legal/case-diary/{V}/summary"
    ai_diary = False                  # --llm: the live answer validated and was stored
    try:
        def down(tokens, llm):
            raise ConnectionRefusedError("audit: model switched off")
        diary_mod.ask_ollama = down
        sm = call(client, "GET", sp, "diary_summary", params={"case_id": cid})
        appended("diary summary, model down")
        check("summary, model down: TEMPLATE_FALLBACK, no AI text, nothing stored",
              sm["generator"] == diary_mod.GENERATOR_FALLBACK and sm["summary"] is None
              and sm["entries"] == [] and sm["document"] is None
              and len(steps[-1]["case_outputs"]) == len(steps[-2]["case_outputs"]), str(sm)[:200])
        # A model that answers with a wrong account token: rejected, nothing stored.
        def wrong(tokens, llm):
            answer = diary_mod.template_narrative(tokens)
            answer["entries"][0]["sentence"] += " ACC_999"
            return answer
        diary_mod.ask_ollama = wrong
        sm = call(client, "GET", sp, "diary_summary", params={"case_id": cid})
        appended("diary summary, wrong answer")
        check("summary, answer with an unknown token: TEMPLATE_FALLBACK, rejected, nothing stored",
              sm["llm"]["status"] == "rejected by validation" and sm["document"] is None
              and sm["generator"] == diary_mod.GENERATOR_FALLBACK
              and len(steps[-1]["case_outputs"]) == len(steps[-2]["case_outputs"]), str(sm)[:200])
        if live_llm:
            diary_mod.ask_ollama = ask
            sm = call(client, "GET", sp, "diary_summary", params={"case_id": cid})
            appended("diary summary, live model")
            print(f"diary summary (live model): {sm['generator']}, {sm['llm']['status']}, "
                  f"{sm['llm']['seconds']} s")
            if sm["document"]:
                d, ai_diary = sm["document"], True
                check("summary (live): stored as the next diary version and valid",
                      d["version"] == dy["version"] + 1 and d["generator"] == diary_mod.GENERATOR_LLM
                      and not diary_mod.validate_html(d["html"], evidence_of(d)))
                stored(d, "diary with AI narrative")
            else:
                check("summary (live): no AI text without a validated answer",
                      sm["summary"] is None and sm["entries"] == [])
    finally:
        diary_mod.ask_ollama = ask

    # FIR draft
    entered = {"complainant": {"name": "AUDIT <Complainant> & Co", "address": "1 Audit Road\nAudit Town",
                               "phone": "0000000000"},
               "offence_summary": "Entered for the audit: the caller asked for 1,00,000 to be sent\n"
                                  "to an account such as ZZZZ00000000.",
               "police_station": "AUDIT PS"}
    fr = call(client, "POST", "/api/legal/fir", "document", json={"case_id": cid, "victim": V, **entered})
    appended("POST /legal/fir")
    details = fir_mod.fir_details(entered["complainant"], entered["offence_summary"], None,
                                  entered["police_station"])
    problems = fir_mod.validate_html(fr["html"], evidence_of(fr), details)
    check("FIR draft passes its validator", not problems, str(problems[:3]))
    stored(fr, "FIR draft")
    text = fir_mod.visible_text(fr["html"])
    check("FIR draft: officer's text printed as typed, annexure lists every traced account",
          entered["complainant"]["name"] in text
          and all(a["acct_no"] in text for a in trace["accounts"]))
    for what, page in (("a wrong amount", fr["html"].replace("₹", "₹9", 1)),
                       ("an account outside the trace", fr["html"].replace(
                           "<h2>Annexure A", "<p>ZZZZ00000000</p><h2>Annexure A", 1)),
                       ("changed officer text", fr["html"].replace("AUDIT PS", "OTHER PS", 1))):
        check(f"FIR validator rejects a page with {what}",
              bool(fir_mod.validate_html(page, evidence_of(fr), details)))
    for name, bad in (("no complainant name", {**entered, "complainant": {"address": "x"}}),
                      ("no offence summary", {**entered, "offence_summary": ""})):
        r = client.post("/api/legal/fir", json={"case_id": cid, "victim": V, **bad})
        check(f"POST /legal/fir {name} -> 422", r.status_code == 422, f"HTTP {r.status_code}")
    appended("refused FIR drafts wrote nothing")

    detail = call(client, "GET", f"/api/cases/{cid}", "case")
    same("case: events in order, status = latest",
         ([x["event"] for x in detail["events"]], detail["status"]),
         (["OPENED", "NOTICES_GENERATED", "DIARY_GENERATED"] + ["DIARY_GENERATED"] * ai_diary
          + ["FIR_GENERATED"], "FIR_GENERATED"))
    same("case: outputs (type, bank, version)",
         sorted(((o["doc_type"], o["bank"] or "", o["version"]) for o in detail["outputs"])),
         sorted([("FREEZE_NOTICE", b, 1) for b in banks] + [("CASE_DIARY", "", 1), ("FIR", "", 1)]
                + [("CASE_DIARY", "", 2)] * ai_diary))
    check("case: every output validated", all(o["validated"] for o in detail["outputs"]))

    # freeze register: REQUESTED / WITHDRAWN rows only
    accts = sorted(candidates)
    fz = call(client, "POST", "/api/scanner/emergency-freeze", "freeze",
              json={"case_id": cid, "accounts": accts, "note": "audit"})
    appended("POST /scanner/emergency-freeze")
    same("freeze: one REQUESTED row per account", sorted(a["account"] for a in fz["recorded"]), accts)
    check("freeze: amount is the trace's holding, bank the account's",
          all(a["action"] == "REQUESTED" and paise(a["amount"]) == candidates[a["account"]]["holding"]
              and a["bank"] == candidates[a["account"]]["bank"] for a in fz["recorded"]))
    check("freeze: never claims a bank was notified",
          fz["bank_notified"] is False and "No bank has been notified" in fz["message"])
    again = call(client, "POST", "/api/scanner/emergency-freeze", "freeze",
                 json={"case_id": cid, "accounts": accts})
    appended("repeated freeze request")
    check("freeze: a repeated request records nothing",
          again["recorded"] == [] and len(again["skipped"]) == len(accts))
    r = client.post("/api/scanner/emergency-freeze", json={"case_id": cid, "accounts": [V]})
    check("freeze: an account the case's traces do not reach -> 422", r.status_code == 422,
          f"HTTP {r.status_code}")
    fa = call(client, "GET", "/api/scanner/frozen-accounts", "frozen")
    check("frozen-accounts: the requested accounts, status REQUESTED, bank not notified",
          sorted(a["account"] for a in fa) == accts
          and all(a["status"] == "REQUESTED" and a["bank_notified"] is False for a in fa))
    uf = call(client, "POST", "/api/scanner/unfreeze", "freeze",
              json={"case_id": cid, "accounts": accts[:1], "note": "audit"})
    appended("POST /scanner/unfreeze")
    check("unfreeze: one WITHDRAWN row, the REQUESTED row stays",
          [a["action"] for a in uf["recorded"]] == ["WITHDRAWN"]
          and len(steps[-1]["freeze_actions"]) == len(accts) + 1)
    fa = call(client, "GET", "/api/scanner/frozen-accounts", "frozen", params={"case_id": cid})
    same("frozen-accounts after the withdrawal", sorted(a["account"] for a in fa), accts[1:])
    uf = call(client, "POST", "/api/scanner/unfreeze", "freeze", json={"case_id": cid, "accounts": accts[:1]})
    check("unfreeze: nothing to withdraw records nothing", uf["recorded"] == [] and len(uf["skipped"]) == 1)

    # vault
    va = call(client, "GET", "/api/vault/artifacts", "artifacts")
    same("vault: one artifact per case_outputs row", va["count"], len(steps[-1]["case_outputs"]))
    same("vault: dataset SHA-256", va["dataset_sha256"], dataset_sha)
    check("vault: every artifact's sha256 is its stored document's",
          all(hashlib.sha256(case_store.document_body(a["output_id"], scratch).encode("utf-8")).hexdigest()
              == a["sha256"] for a in va["artifacts"]))
    vf = call(client, "POST", "/api/vault/verify", "verify")
    check("vault verify: clean store passes", vf["ok"] and not vf["problems"]
          and vf["triggers"] == vf["triggers_expected"] and vf["documents"] == va["count"], str(vf))
    for table in case_store.COLUMNS:
        for sql in (f"UPDATE {table} SET row_hash = 'x'", f"DELETE FROM {table}"):
            try:
                raw_sql(scratch, sql)
                check(f"{sql.split()[0]} on {table} refused", False)
            except sqlite3.DatabaseError:
                check(f"{sql.split()[0]} on {table} refused", True)
    appended("after every request and refused UPDATE / DELETE")

    # stored pages, read back exactly as stored
    returned = {d["output_id"]: d["html"].encode("utf-8") for d in (*nt["notices"], dy, fr)}
    ol = call(client, "GET", f"/api/cases/{cid}/outputs", "outputs")
    same("outputs: every case_outputs row of the case, each with its stored page",
         (ol["count"], all(o["stored"] for o in ol["outputs"])), (len(steps[-1]["case_outputs"]), True))
    same("outputs: labels", sorted({(o["doc_type"], o["generator"]) for o in ol["outputs"]}),
         sorted({("FREEZE_NOTICE", "TEMPLATE"), ("CASE_DIARY", "TEMPLATE"), ("FIR", "TEMPLATE")}
                | ({("CASE_DIARY", "LLM+VALIDATED")} if ai_diary else set())))
    exact = []
    for o in ol["outputs"]:
        r = client.get(f"/api/cases/{cid}/outputs/{o['output_id']}")
        exact.append(r.status_code == 200 and r.headers["content-type"].startswith("text/html")
                     and hashlib.sha256(r.content).hexdigest() == o["sha256"] == r.headers.get("x-content-sha256")
                     and r.content == returned.get(o["output_id"], r.content))
    check("output pages: byte for byte the page first returned, sha256 matches",
          all(exact) and len(exact) >= len(returned), str(exact))
    for name, path in (("unknown output", f"/api/cases/{cid}/outputs/999999"),
                       ("unknown case", "/api/cases/CASE-999999/outputs"),
                       ("unknown case (page)", "/api/cases/CASE-999999/outputs/1")):
        r = client.get(path)
        check(f"outputs {name} -> 404", r.status_code == 404, f"HTTP {r.status_code}")

    # close: CLOSED is appended, then every write is refused
    cp = f"/api/cases/{cid}/close"
    for name, path, body, status in (("unknown case", "/api/cases/CASE-999999/close", {"officer": OFFICER}, 404),
                                     ("no officer", cp, {"note": "x"}, 422),
                                     ("blank officer", cp, {"officer": "  "}, 422)):
        r = client.post(path, json=body)
        check(f"close {name} -> {status}", r.status_code == status, f"HTTP {r.status_code}")
    appended("refused closes wrote nothing")
    same("refused closes wrote nothing (events)", len(steps[-1]["case_events"]), len(steps[-2]["case_events"]))
    cl = call(client, "POST", cp, "case", json={"officer": OFFICER, "note": "audit close"})
    appended("POST /cases/{id}/close")
    same("close: CLOSED is the latest event and the status",
         (cl["status"], cl["events"][-1]["event"], cl["events"][-1]["note"],
          len(steps[-1]["case_events"]) - len(steps[-2]["case_events"])),
         ("CLOSED", "CLOSED", "audit close", 1))
    fir_body = {"case_id": cid, "victim": V, **entered}
    writes = {
        "notices": ("GET", f"/api/legal/notices/{V}", {"params": {"case_id": cid}}),
        "diary": ("GET", f"/api/legal/case-diary/{V}", {"params": {"case_id": cid}}),
        "diary summary": ("GET", sp, {"params": {"case_id": cid}}),
        "FIR draft": ("POST", "/api/legal/fir", {"json": fir_body}),
        "freeze": ("POST", "/api/scanner/emergency-freeze", {"json": {"case_id": cid, "accounts": accts[:1]}}),
        "unfreeze": ("POST", "/api/scanner/unfreeze", {"json": {"case_id": cid, "accounts": accts[1:2]}}),
        "second close": ("POST", cp, {"json": {"officer": OFFICER}}),
    }
    for name, (method, path, kwargs) in writes.items():
        r = client.request(method, path, **kwargs)
        check(f"after CLOSED: {name} -> 409", r.status_code == 409 and "closed" in r.json().get("detail", ""),
              f"HTTP {r.status_code} {r.text[:120]}")
    for name, fn in (("event", lambda: case_store.add_event(cid, "FIR_GENERATED", OFFICER, db=scratch)),
                     ("document", lambda: case_store.add_document(
                         cid, "FIR", "audit", "audit", True, "TEMPLATE", db=scratch))):
        try:
            fn()
            check(f"after CLOSED: the case store itself refuses a new {name}", False)
        except case_store.CaseClosedError:
            check(f"after CLOSED: the case store itself refuses a new {name}", True)
    check("after CLOSED: nothing was written", chain(scratch) == steps[-1])
    for path, schema in ((f"/api/cases/{cid}", "case"), (f"/api/cases/{cid}/outputs", "outputs"),
                         ("/api/scanner/frozen-accounts", "frozen"), ("/api/vault/artifacts", "artifacts")):
        call(client, "GET", path, schema)
    r = client.get(f"/api/cases/{cid}/outputs/{dy['output_id']}")
    check("after CLOSED: stored pages can still be read",
          r.status_code == 200 and r.content == returned[dy["output_id"]])
    vf = call(client, "POST", "/api/vault/verify", "verify")
    check("vault verify: passes with the closed case", vf["ok"], str(vf["problems"]))

    # Tampering behind the triggers, each on its own copy; the triggers are put
    # back (connect) so that the changed row is the only thing verify can find.
    tampers = {
        "a changed case_outputs row": ("case_outputs", "UPDATE case_outputs SET sha256 = '{}' WHERE seq = 1".format("0" * 64)),
        "a changed stored document": ("output_bodies", "UPDATE output_bodies SET body = body || ' ' WHERE seq = 2"),
        "a changed freeze action": ("freeze_actions", "UPDATE freeze_actions SET action = 'WITHDRAWN' WHERE seq = 2"),
        "a changed case event": ("case_events", "UPDATE case_events SET officer = 'x' WHERE seq = 1"),
        "a deleted case event": ("case_events", "DELETE FROM case_events WHERE seq = 2"),
    }
    try:
        for i, (name, (table, sql)) in enumerate(tampers.items()):
            copy = scratch.with_name(f"tamper{i}.db")
            shutil.copyfile(scratch, copy)
            raw_sql(copy, f"DROP TRIGGER {table}_no_update", f"DROP TRIGGER {table}_no_delete", sql)
            case_store.connect(copy).close()
            os.environ[CASES_ENV] = str(copy)
            r = client.post("/api/vault/verify").json()
            check(f"vault verify detects {name}", r["ok"] is False
                  and any(table in p for p in r["problems"]), str(r["problems"])[:200])
            if table == "output_bodies":       # body seq 2 is the page of case_outputs seq 2
                vault_error = next(p for p in r["problems"] if "sha256" in p)
                for path in (f"/api/cases/{cid}/outputs/2", f"/api/cases/{cid}/outputs"):
                    t = client.get(path)
                    check(f"tampered page: GET {path} -> 409 with the vault error",
                          t.status_code == 409 and t.json().get("detail") == vault_error, t.text[:200])
                t = client.get(f"/api/cases/{cid}/outputs/1")
                check("tampered page: an untouched page of the same case is still served",
                      t.status_code == 200 and t.content == returned[1])
    finally:
        os.environ[CASES_ENV] = str(scratch)
    return {"case": cl, "notices": nt, "freeze": fz, "frozen": fa, "verify": vf,
            "rows": {t: len(rows) for t, rows in steps[-1].items()}}


def main() -> None:
    t0 = time.perf_counter()
    shutil.rmtree(SCRATCH_DIR, ignore_errors=True)
    SCRATCH_DIR.mkdir(parents=True)
    scratch = SCRATCH_DIR / "cases.db"
    os.environ[CASES_ENV] = str(scratch)
    real_store = file_state(DEFAULT_CASES_DB) if DEFAULT_CASES_DB.is_file() else None
    db = db_path()
    before = file_state(db)
    counts_before = table_counts(db)
    banks = expected_banks(db)
    unnamed: dict[str, list] = {}

    def named(where: str, rows: list[dict], acct: str, code: str = "bank") -> None:
        """Every row carries its bank's directory name (collected, reported once per place)."""
        bad = [r[acct] for r in rows
               if r.get("bank_name") is None
               or r["bank_name"] != banks["directory"].get(r[code])
               or r["bank_name"] != banks["of_account"].get(r[acct])]
        unnamed.setdefault(where, []).extend(bad)
    wal = db.with_name(db.name + ".wal")
    wal_before = wal.exists()
    e = expected(db)
    samples = {}

    with TestClient(app) as client:
        # /status
        s = get(client, "/api/status")
        samples["/api/status"] = s
        same("status records_loaded", s["records_loaded"], e["ingest"][0])
        same("status records_parsed", s["records_parsed"], e["ingest"][1])
        same("status ingestion_seconds", s["ingestion_seconds"], e["ingest"][2])
        same("status hash", s["hash"], e["ingest"][3])
        same("status accounts", s["accounts"], e["accounts"])
        same("status flagged", s["flagged"], e["flagged"])
        same("status high_risk_mules", s["high_risk_mules"], e["flagged"])
        same("status freeze_recommended", s["freeze_recommended"], e["freeze"])
        same("status roles", s["roles"], e["roles"])
        same("status victims", s["victims"], e["roles"].get("VICTIM", 0))
        same("status cells", s["cells"], e["cells"])
        same("status foreign_ip_txns", s["foreign_ip_txns"], e["foreign"])
        same("status unique_receivers", s["unique_receivers"], e["receivers"])
        same("status profile_id", s["profile_id"], e["profile_id"])

        # /victims, /detected-victims
        v = get(client, "/api/victims")
        dv = get(client, "/api/detected-victims")
        samples["/api/victims"] = v
        samples["/api/detected-victims"] = dv
        same("victims count", len(v["victims"]), e["roles"].get("VICTIM", 0))
        check("detected-victims = victims", v == dv)
        check("victims list = items accounts",
              v["victims"] == [x["account"] for x in v["items"]])
        same("victims amount total (paise)",
             round(sum(x["amount"] or 0 for x in v["items"]) * 100), e["victim_paid_paise"])
        check("victims accounts unique", len(set(v["victims"])) == len(v["victims"]))
        named("victims", v["items"], "account")

        # /mules
        m = get(client, "/api/mules", limit=100000)
        samples["/api/mules"] = m
        same("mules count", len(m), e["flagged"])
        check("mules accounts unique", len({x["account"] for x in m}) == len(m))
        named("mules", m, "account")
        same("mules holding total (paise)",
             round(sum(x["holding_amount"] or 0 for x in m) * 100), e["holding_paise"])
        check("mules in - out = holding", all(
            x["holding_amount"] is None or
            round((x["total_incoming_amt"] - x["total_outgoing_amt"]) * 100)
            == round(x["holding_amount"] * 100) for x in m))
        check("mules sorted by final_index desc",
              [x["final_index"] for x in m] == sorted((x["final_index"] for x in m), reverse=True))
        for role, n in sorted(e["flagged_roles"].items()):
            got = get(client, "/api/mules", limit=100000, role_filter=role)
            same(f"mules role_filter={role}", len(got), n)
            check(f"mules role_filter={role} only that role", all(x["role"] == role for x in got))
        ui_label = get(client, "/api/mules", limit=100000, role_filter="L2_DISTRIBUTOR")
        same("mules role_filter=L2_DISTRIBUTOR (UI label)", len(ui_label),
             e["flagged_roles"].get("L2", 0))
        same("mules role_filter=L4_TERMINAL (no such role)",
             len(get(client, "/api/mules", role_filter="L4_TERMINAL")), 0)
        same("mules min_risk", len(get(client, "/api/mules", limit=100000,
                                       min_risk=e["risk_cut"])), e["n_risk"])
        same("mules bank_filter", len(get(client, "/api/mules", limit=100000,
                                          bank_filter=e["bank"])), e["n_bank_mules"])
        same("mules min_amount", len(get(client, "/api/mules", limit=100000,
                                         min_amount=e["amount_cut_paise"] / 100)), e["n_amount"])
        same("mules limit", len(get(client, "/api/mules", limit=7)), min(7, e["flagged"]))
        same("mules default = UI call (limit 2000)", len(get(client, "/api/mules", limit=2000)),
             min(2000, e["flagged"]))

        # /entities
        en = get(client, "/api/entities")
        samples["/api/entities"] = en
        same("entities total_accounts", en["total_accounts"], e["accounts"])
        same("entities matched (no filter)", en["matched"], e["accounts"])
        same("entities returned (default limit 500)", en["returned"], min(500, e["accounts"]))
        same("entities bank_stats sum", sum(b["count"] for b in en["bank_stats"]), e["accounts"])
        eb = get(client, "/api/entities", limit=100000, bank_filter=e["bank"])
        same("entities bank_filter matched", eb["matched"], e["n_bank_accounts"])
        same("entities bank_filter returned", len(eb["entities"]), e["n_bank_accounts"])
        check("entities bank_filter only that bank",
              all(x["bank"] == e["bank"] for x in eb["entities"]))
        ea = get(client, "/api/entities", limit=100000)
        same("entities all returned", len(ea["entities"]), e["accounts"])
        named("entities (all accounts)", ea["entities"], "account")
        same("bank directory covers every bank code in accounts",
             [c for c in banks["codes"] if not banks["directory"].get(c)], [])
        same("entities bank_name present for every account",
             sum(1 for x in ea["entities"] if x["bank_name"]), e["accounts"])
        same("entities bank_stats names = bank_directory",
             {b["code"]: b["name"] for b in en["bank_stats"]},
             {c: banks["directory"].get(c) for c in banks["codes"]})
        check("entities bank_stats names all filled", all(b["name"] for b in en["bank_stats"]))
        same("entities flagged", sum(1 for x in ea["entities"] if x["is_flagged"]), e["flagged"])

        # /trace/{victim}
        url = f"/api/trace/{SAMPLE_VICTIM}"
        tr = get(client, url, "trace")
        timings["trace (first, loads the context)"] = timings.pop("trace")
        samples[url] = tr
        nodes, links = tr["nodes"], tr["links"]
        b2 = expected_b2(db, e["profile_id"], [l["tx_key"] for l in links],
                         [n["id"] for n in nodes])
        roots = [n for n in nodes if n["hop"] == 0]
        check("trace found", tr["found"] is True)
        named("trace nodes", nodes, "id")
        named("trace freeze list", tr["freeze_candidates"], "acct_no")
        r = client.get(url)
        check("trace elapsed_ms measured, within the request time",
              0 < r.json()["elapsed_ms"] <= float(r.headers[TIMING_HEADER]),
              f"elapsed_ms {r.json()['elapsed_ms']} / header {r.headers[TIMING_HEADER]}")
        same("trace traced accounts (nodes without the victim root)",
             len(nodes) - len(roots), SAMPLE_ACCOUNTS)
        check("trace one victim root node", [n["id"] for n in roots] == [SAMPLE_VICTIM])
        same("trace links", len(links), SAMPLE_LINKS)
        same("trace summary.accounts", tr["summary"]["accounts"], SAMPLE_ACCOUNTS)
        same("trace reconcile difference", tr["reconcile"]["difference"], 0)
        same("trace fingerprint = CLI", tr["fingerprint"], cli_fingerprint(SAMPLE_VICTIM))
        same("trace link amounts = tx (paise)",
             {l["tx_key"]: paise(l["amount"]) for l in links},
             {k: v_[0] for k, v_ in b2["tx"].items()})
        same("trace link payment_mode = tx.mode",
             {l["tx_key"]: l["payment_mode"] for l in links},
             {k: v_[1] for k, v_ in b2["tx"].items()})
        same("trace link lag_seconds = layer_links",
             {l["tx_key"]: l["lag_seconds"] for l in links},
             {l["tx_key"]: b2["lag"].get(l["tx_key"]) for l in links})
        same("trace node ifsc = accounts", {n["id"]: n["ifsc"] for n in nodes}, b2["ifsc"])
        check("trace link ends are nodes", all(
            l["source"] in b2["ifsc"] and l["target"] in b2["ifsc"] for l in links))
        same("trace total_siphoned_inr = victim's links (paise)",
             paise(tr["total_siphoned_inr"]),
             sum(b2["tx"][l["tx_key"]][0] for l in links if l["source"] == SAMPLE_VICTIM))
        same("trace holding sum = summary.holding_total (paise)",
             sum(paise(n["holding_amount"]) for n in nodes),
             paise(tr["summary"]["holding_total"]))
        same("trace profile max_hops", tr["profile"]["max_hops"], b2["max_hops"])
        same("trace cells = summary.cell_ids",
             [c["cell_id"] for c in tr["cells"]], tr["summary"]["cell_ids"])

        # /trace filters: only the returned graph changes
        whole = {k: tr[k] for k in ("fingerprint", "summary", "reconcile",
                                    "total_siphoned_inr", "recoverable_holding_inr")}

        def filtered(name: str, **params) -> dict:
            got = get(client, url, "trace", **params)
            check(f"trace {name}: totals unchanged", {k: got[k] for k in whole} == whole)
            ids = {n["id"] for n in got["nodes"]}
            check(f"trace {name}: link ends are returned nodes",
                  all(l["source"] in ids and l["target"] in ids for l in got["links"]))
            return got

        f = filtered("max_hops above profile", max_hops=b2["max_hops"] + 5)
        same("trace max_hops capped at the profile", f["filters"]["max_hops_shown"], b2["max_hops"])
        check("trace max_hops above profile = full graph", f["links"] == links)
        f = filtered("max_hops=1", max_hops=1)
        check("trace max_hops=1 only first-hop links",
              f["links"] == [l for l in links if l["hop"] <= 1])
        f = filtered("time_window + custom_rules", time_window=1, custom_rules="[]")
        check("trace time_window / custom_rules ignored",
              f["links"] == links and f["nodes"] == nodes
              and f["filters"]["ignored"] == ["time_window", "custom_rules"])
        cut = sorted(l["amount"] for l in links)[len(links) // 2]
        f = filtered("min_amount", min_amount=cut)
        check("trace min_amount", f["links"] == [l for l in links if l["amount"] >= cut])
        bank_of = {n["id"]: n["bank"] for n in nodes}
        bank = bank_of[links[-1]["target"]]
        f = filtered("bank_filter", bank_filter=bank)
        check("trace bank_filter", f["links"] == [
            l for l in links if bank in (bank_of[l["source"]], bank_of[l["target"]])])
        word = next((l["narration"] for l in links if l["narration"]), None)
        if word:
            f = filtered("keyword", keyword=word.lower())
            check("trace keyword", f["links"] == [
                l for l in links if word.lower() in (l["narration"] or "").lower()])

        # unknown account
        unknown = get(client, f"/api/trace/{UNKNOWN_ACCOUNT}", "not_found")
        check("trace unknown elapsed_ms measured", (unknown.pop("elapsed_ms") or 0) > 0)
        same("trace unknown account", unknown,
             {"found": False, "message": "No transaction graph found"})

        # /trace/batch
        def post_batch(victims: list[str], schema: str):
            r = client.post("/api/trace/batch", json={"victims": victims})
            check(f"batch {len(victims)} victims  200", r.status_code == 200, f"HTTP {r.status_code}")
            timings.setdefault("batch", []).append(float(r.headers[TIMING_HEADER]))
            try:
                SCHEMAS[schema].validate_python(r.json(), strict=False)
                check(f"batch {len(victims)} victims  schema", True)
            except Exception as ex:
                check(f"batch {len(victims)} victims  schema", False, str(ex)[:300])
            return r.json()

        picked = [SAMPLE_VICTIM] + [a for a in v["victims"] if a != SAMPLE_VICTIM][:4]
        singles = {a: get(client, f"/api/trace/{a}", "trace") for a in picked}
        bt = post_batch(picked + [UNKNOWN_ACCOUNT], "batch")
        same("batch not_found", bt["not_found"], [UNKNOWN_ACCOUNT])
        named("batch nodes", bt["nodes"], "id")
        named("batch victims", bt["victims"], "acct_no")
        named("batch freeze list", bt["freeze_candidates"], "acct_no")
        check("batch elapsed_ms measured", bt["elapsed_ms"] > 0, str(bt["elapsed_ms"]))
        same("batch per-victim paid (paise)",
             {x["acct_no"]: paise(x["paid"]) for x in bt["victims"]},
             {a: paise(s_["total_siphoned_inr"]) for a, s_ in singles.items()})
        same("batch per-victim fingerprint",
             {x["acct_no"]: x["fingerprint"] for x in bt["victims"]},
             {a: s_["fingerprint"] for a, s_ in singles.items()})
        same("batch per-victim holding (paise)",
             {x["acct_no"]: paise(x["holding_total"]) for x in bt["victims"]},
             {a: paise(s_["summary"]["holding_total"]) for a, s_ in singles.items()})
        same("batch total = sum of victims (paise)", paise(bt["total_siphoned_inr"]),
             sum(paise(s_["total_siphoned_inr"]) for s_ in singles.values()))
        same("batch merged links = union of single traces",
             sorted(l["tx_key"] for l in bt["links"]),
             sorted({l["tx_key"] for s_ in singles.values() for l in s_["links"]}))
        same("batch merged nodes = union of single traces",
             sorted(n["id"] for n in bt["nodes"]),
             sorted({n["id"] for s_ in singles.values() for n in s_["nodes"]}))
        unknown_batch = post_batch([UNKNOWN_ACCOUNT], "batch_not_found")
        check("batch unknown elapsed_ms measured", (unknown_batch.pop("elapsed_ms") or 0) > 0)
        same("batch unknown only", unknown_batch,
             {"found": False, "message": "No transaction graph found",
              "not_found": [UNKNOWN_ACCOUNT]})
        r = client.post("/api/trace/batch", json={"victims": []})
        check("batch empty list 422", r.status_code == 422, f"HTTP {r.status_code}")

        # /cells, /cells/{id}, /cells/{id}/victims, /network
        cl = get(client, "/api/cells")
        samples["/api/cells"] = cl
        same("cells count", cl["count"], len(b2["cells"]))
        same("cells victim_count", {c["cell_id"]: c["victim_count"] for c in cl["cells"]},
             b2["cells"])
        mismatched, bad_summary = [], []
        for cid in sorted(b2["cells"]):
            got = get(client, f"/api/cells/{cid}/victims", "cell_victims")
            want = engine.reverse_trace_cell(cid, db)
            flat = lambda vs, money: [  # noqa: E731
                (x["acct_no"], money(x["amount"]), x["first_ts"], x["last_ts"], x["l1_accounts"],
                 [(p["tx_key"], p["to"], p["ts"], money(p["amount"]), p["via"])
                  for p in x["payments"]]) for x in vs]
            if (flat(got["victims"], paise) != flat(want["victims"], int)
                    or paise(got["total_in"]) != want["total_in"]
                    or got["victim_count"] != want["victim_count"]
                    or got["victim_count"] != b2["cells"][cid]):
                mismatched.append(cid)
            named("cell reverse-trace victims", got["victims"], "acct_no")
            cs = get(client, f"/api/cells/{cid}", "cell")
            named("cell victims", cs["victims"], "acct_no")
            named("cell freeze accounts", cs["freeze_accounts"], "acct_no")
            if (cs["victim_count"] != b2["cells"][cid]
                    or [x["acct_no"] for x in cs["victims"]] != [x["acct_no"] for x in want["victims"]]
                    or cs["total_in"] != rupees(want["total_in"])):
                bad_summary.append(cid)
        check("every cell's /victims = reverse_trace_cell", not mismatched, str(mismatched[:10]))
        check("every cell summary agrees with its victims", not bad_summary, str(bad_summary[:10]))
        samples["/api/cells/{id}"] = cs
        r = client.get("/api/cells/-1")
        check("unknown cell 404 clean JSON", r.status_code == 404 and "detail" in r.json(),
              r.text[:120])
        nw = get(client, "/api/network")
        samples["/api/network"] = nw
        same("network count", nw["count"], b2["networks"])
        same("network cells sum", sum(n["cells"] for n in nw["networks"]), len(b2["cells"]))

        # trace view markers and node device / IP (B3 step 0)
        check("trace full view: display_trimmed false", tr["display_trimmed"] is False)
        same("trace full_hops = summary.hops", tr["full_hops"], tr["summary"]["hops"])
        one_hop = get(client, url, "trace", max_hops=1)
        check("trace max_hops=1: display_trimmed true, full_hops kept",
              one_hop["display_trimmed"] is True and one_hop["full_hops"] == tr["full_hops"])
        sent = {}
        for l in links:
            sent.setdefault(l["source"], []).append(l)
        check("trace nodes that send have device_type and ip_address", all(
            n["device_type"] in {l["device_type"] for l in sent[n["id"]]}
            and n["ip_address"] in {l["ip_address"] for l in sent[n["id"]]}
            for n in nodes if n["id"] in sent))
        check("trace nodes that only receive have null device / IP", all(
            n["device_type"] is None and n["ip_address"] is None
            for n in nodes if n["id"] not in sent))
        check("trace has both kinds of node",
              any(n["id"] in sent for n in nodes) and any(n["id"] not in sent for n in nodes))

        # /profiles/active, /profiles/{id}
        b3 = expected_b3(db, e["profile_id"])
        pa = get(client, "/api/profiles/active", "profile")
        samples["/api/profiles/active"] = {k: v for k, v in pa.items() if k != "definition"}
        same("profile active id", pa["profile_id"], e["profile_id"])
        same("profile weights", {x["id"]: x["weight"] for x in pa["parameters"]}, b3["weights"])
        same("profile enabled", {x["id"]: x["enabled"] for x in pa["parameters"]}, b3["enabled"])
        same("profile gate status",
             {x["id"]: x["gate_status"] for x in pa["parameters"] if x["gate"]}, b3["gate_status"])
        check("profile ungated parameters have null gate_status",
              all(x["gate_status"] is None for x in pa["parameters"] if not x["gate"]))
        check("profile parameters: one-line description and thresholds", all(
            x["description"] and "\n" not in x["description"] and x["thresholds"]
            for x in pa["parameters"]))
        same("profile definition = stored", pa["definition"], b3["definition"])
        same("profile by id = active",
             get(client, f"/api/profiles/{e['profile_id']}", "profile"), pa)
        r = client.get("/api/profiles/no-such-profile")
        check("unknown profile 404", r.status_code == 404, f"HTTP {r.status_code}")

        # /profiles/preview with NO changes reproduces the stored scores
        pv = post(client, "/api/profiles/preview", "preview", {})
        samples["/api/profiles/preview (no changes)"] = pv
        same("preview no-change flags gained", pv["flags_gained"]["count"], 0)
        same("preview no-change flags lost", pv["flags_lost"]["count"], 0)
        same("preview no-change role changes", pv["role_changes"]["count"], 0)
        same("preview no-change final_index changed", pv["final_index_changed"], 0)
        same("preview no-change max final change", pv["max_final_index_change"], 0)
        same("preview no-change flagged", pv["flagged_count"], e["flagged"])
        same("preview accounts", pv["accounts"], e["accounts"])
        same("preview no-change bands after", pv["band_counts"]["after"], b3["bands"])
        same("preview bands before", pv["band_counts"]["before"], b3["bands"])
        same("preview no-change roles after", pv["role_counts"]["after"], b3["role_counts"])
        same("preview no-change layer links", pv["layer_links"],
             {"before": b3["links"], "after": b3["links"]})
        check("preview writes nothing (flag)", pv["written"] is False)

        # /profiles/preview with one weight set to 0
        change = {"changes": {"parameters": {PREVIEW_PARAMETER: {"weight": 0}}}}
        pm = post(client, "/api/profiles/preview", "preview", change)
        samples[f"/api/profiles/preview ({PREVIEW_PARAMETER} weight 0)"] = pm
        check("preview change: final_index moved", pm["final_index_changed"] > 0
              and pm["max_final_index_change"] > 0, str(pm["final_index_changed"]))
        same("preview change: before = stored flagged", pm["flagged"]["before"], e["flagged"])
        same("preview change: after = before + gained - lost", pm["flagged"]["after"],
             pm["flagged"]["before"] + pm["flags_gained"]["count"] - pm["flags_lost"]["count"])
        same("preview change: flagged_count = flagged.after", pm["flagged_count"],
             pm["flagged"]["after"])
        same("preview change: bands after cover every account",
             sum(pm["band_counts"]["after"].values()), e["accounts"])
        same("preview change: roles after cover every account",
             sum(pm["role_counts"]["after"].values()), e["accounts"])
        check("preview change: bands differ from stored",
              pm["band_counts"]["after"] != pm["band_counts"]["before"])
        same("preview change: role transitions sum = role changes",
             sum(x["count"] for x in pm["role_changes"]["transitions"]),
             pm["role_changes"]["count"])
        for part, was, now in (("flags_gained", False, True), ("flags_lost", True, False)):
            check(f"preview change: {part} accounts are consistent", all(
                a["flagged_before"] is was and a["flagged_after"] is now
                for a in pm[part]["accounts"])
                and len(pm[part]["accounts"]) == min(pm[part]["count"], PREVIEW_LIST_LIMIT))
        check("preview change: weight-sum warning", any(
            "mule weights" in w for w in pm["warnings"]), str(pm["warnings"]))
        check("preview change: stored profile untouched",
              get(client, "/api/profiles/active", "profile") == pa)

        # invalid changes -> 422, nothing scored
        signals = pa["final"]["two_signal_rule"]["over"]
        for name, bad in (
                ("negative weight", {"parameters": {PREVIEW_PARAMETER: {"weight": -1}}}),
                ("two-signal rule disabled", {"two_signal_rule_enabled": False}),
                ("two-signal rule below 2", {"min_parameters_at_half": 1}),
                ("fewer than 2 parameters enabled",
                 {"parameters": {x: {"enabled": False} for x in signals[1:]}}),
                ("unknown parameter", {"parameters": {"NOPE": {"weight": 1}}}),
                ("unknown change field", {"windows": {"single_forward_max_minutes": 5}}),
                ("flag threshold out of range", {"flag_threshold": 500})):
            r = client.post("/api/profiles/preview", json={"changes": bad})
            check(f"preview invalid: {name} -> 422", r.status_code == 422,
                  f"HTTP {r.status_code} {r.text[:160]}")

        # deferred writes
        for path in ("/api/profiles", f"/api/profiles/{e['profile_id']}/activate"):
            r = client.post(path, json={})
            check(f"POST {path} 501", r.status_code == 501
                  and r.json().get("detail") == "not yet available", r.text[:120])

        # /transactions/search
        sp = "/api/transactions/search"
        ts = get(client, sp, limit=5)
        samples[sp] = ts
        same("search no filter matched", ts["matched"], tx_count(db))
        same("search limit", ts["returned"], 5)
        first = ts["transactions"][0]
        day = first["timestamp"][:10]
        cut = e["amount_cut_paise"]
        cases = {
            "payment_mode": ("t.mode = ?", [first["payment_mode"]],
                             {"payment_mode": first["payment_mode"]}),
            "device": ("t.device = ?", [first["device_type"]], {"device": first["device_type"]}),
            "bank": ("(s.bank = ? OR d.bank = ?)", [first["source_bank"]] * 2,
                     {"bank": first["source_bank"]}),
            "narration_category": ("split_part(split_part(t.narration, '/', 2), '#', 1) = ?",
                                   [first["narration_category"]],
                                   {"narration_category": first["narration_category"]}),
            "foreign_ip": ("t.is_foreign_ip", [], {"foreign_ip": "true"}),
            "amount range": ("t.amount_paise BETWEEN ? AND ?", [cut, 2 * cut],
                             {"min_amount": cut / 100, "max_amount": 2 * cut / 100}),
            "time range": ("t.ts BETWEEN CAST(? AS TIMESTAMP) AND CAST(? AS TIMESTAMP)",
                           [day + " 00:00:00", first["timestamp"].replace("T", " ")],
                           {"from_ts": day + "T00:00:00", "to_ts": first["timestamp"]}),
            "foreign + amount": ("t.is_foreign_ip AND t.amount_paise >= ?", [cut],
                                 {"foreign_ip": "true", "min_amount": cut / 100}),
        }
        for name, (where, params, query) in cases.items():
            got = get(client, sp, limit=50, **query)
            same(f"search {name} matched", got["matched"], tx_count(db, where, params))
            check(f"search {name} returned <= limit", got["returned"] == min(50, got["matched"]))
        fx = get(client, sp, limit=50, foreign_ip="true")
        check("search foreign_ip rows are foreign", all(
            x["is_foreign_ip"] for x in fx["transactions"]))
        for name, query in (("unknown field", {"sql": "1"}),
                            ("unknown field order_by", {"order_by": "ts"}),
                            ("limit above the cap", {"limit": MAX_SEARCH_LIMIT + 1}),
                            ("bad timestamp", {"from_ts": "yesterday"})):
            r = client.get(sp, params=query)
            check(f"search {name} -> 422", r.status_code == 422, f"HTTP {r.status_code}")

        # B4a: /scanner/summary
        pid = e["profile_id"]
        b4 = expected_b4(db, pid)
        sm = get(client, "/api/scanner/summary")
        samples["/api/scanner/summary"] = sm
        same("scanner records_scanned", sm["records_scanned"], b4["tx"])
        same("scanner profile", sm["profile_id"], pid)
        same("scanner flagged transfers", sm["flagged_transfers"]["count"], b4["scope_n"])
        same("scanner flagged transfer volume",
             paise(sm["flagged_transfers"]["total_volume_inr"]), b4["scope_paise"])
        same("scanner layer links", sm["illegal_linkages"]["flagged_txns"],
             sum(n for n, _ in b4["types"].values()))
        same("scanner layer link volume", paise(sm["illegal_linkages"]["total_volume_inr"]),
             sum(amt for _, amt in b4["types"].values()))
        same("scanner link types", {x["link_type"]: (x["count"], paise(x["total_volume_inr"]))
                                    for x in sm["link_types"]}, b4["types"])
        same("scanner foreign ip transfers",
             sm["multi_ip_geolocation"]["foreign_ip_txns"], b4["foreign_n"])
        same("scanner foreign ip volume",
             paise(sm["multi_ip_geolocation"]["total_volume_inr"]), b4["foreign_paise"])
        same("scanner holding accounts",
             sm["early_intervention"]["holding_accounts_at_risk"], b4["holders"])
        same("scanner recoverable holding",
             paise(sm["early_intervention"]["recoverable_holding_inr"]), e["holding_paise"])
        check("scanner summary: fields we lack are null", all(sm[k] is None for k in SUMMARY_NULLS)
              and sm["multi_ip_geolocation"]["subnets_flagged"] is None
              and sm["early_intervention"]["predicted_cashout_window_mins"] is None)

        # B4a: /scanner/problematic-transactions
        pp = "/api/scanner/problematic-transactions"
        top = MAX_SCANNER_LIMIT
        rows = get(client, pp, limit=top)
        samples[pp] = rows
        same("problematic no filter returned", len(rows), min(top, b4["scope_n"]))
        same("problematic default limit", len(get(client, pp)), min(100, b4["scope_n"]))
        check("problematic rows: fields we lack are null",
              all(x[k] is None for x in rows for k in ROW_NULLS))
        check("problematic rows are a link or touch a flagged account", all(
            x["link_type"] or x["sender_flagged"] or x["receiver_flagged"] for x in rows))
        check("problematic rows newest first",
              [x["txn_timestamp"] for x in rows] == sorted(
                  (x["txn_timestamp"] for x in rows), reverse=True))
        keys = [x["tx_key"] for x in rows]
        same("problematic tx_keys unique", len(set(keys)), len(keys))
        con = duckdb.connect(str(db), read_only=True)
        try:
            stored = {k: v for k, *v in con.execute(
                "SELECT t.tx_key, t.amount_paise, t.tx_id, s.acct_no, d.acct_no, d.ifsc "
                "FROM tx t JOIN accounts s ON s.acct_id = t.src "
                "JOIN accounts d ON d.acct_id = t.dst WHERE t.tx_key IN (SELECT unnest(?))",
                [keys]).fetchall()}
        finally:
            con.close()
        same("problematic rows = stored transactions",
             {x["tx_key"]: [paise(x["Amount_INR"]), x["Transaction_ID"], x["Sender_Account"],
                            x["Receiver_Account"], x["Receiver_IFSC"]] for x in rows}, stored)
        cut4 = b4["amount_cut"]
        cases = {
            "filter_type=ILLEGAL_LINKAGES": (LINK.format(""), [pid],
                                             {"filter_type": "ILLEGAL_LINKAGES"}),
            "filter_type=FOREIGN_IP": ("t.is_foreign_ip", [], {"filter_type": "FOREIGN_IP"}),
            "min_amount": ("t.amount_paise >= ?", [cut4], {"min_amount": cut4 / 100}),
            "bank_filter": ("(s.bank = ? OR d.bank = ?)", [b4["bank"]] * 2,
                            {"bank_filter": b4["bank"]}),
            "keyword": ("contains(lower(split_part(split_part(t.narration, '/', 2), '#', 1)), "
                        "lower(?))", [b4["category"]], {"keyword": b4["category"].lower()}),
            "bank + min_amount": ("(s.bank = ? OR d.bank = ?) AND t.amount_paise >= ?",
                                  [b4["bank"]] * 2 + [cut4],
                                  {"bank_filter": b4["bank"], "min_amount": cut4 / 100}),
        }
        for lt in b4["types"]:
            cases[f"link_type={lt}"] = (LINK.format(" AND l.link_type = ?"), [pid, lt],
                                        {"link_type": lt})
            cases[f"filter_type={lt}"] = (LINK.format(" AND l.link_type = ?"), [pid, lt],
                                          {"filter_type": lt})
        for name, (where, params, query) in cases.items():
            got = get(client, pp, limit=top, **query)
            want = tx_count(db, SCOPE + " AND " + where, [pid] * 3 + params)
            same(f"problematic {name} returned", len(got), min(top, want))
            if "link_type" in query:
                check(f"problematic {name} rows carry it",
                      all(x["link_type"] == query["link_type"] for x in got))
        check("problematic ALL / bank ALL = no filter",
              get(client, pp, limit=top, filter_type="ALL", bank_filter="ALL") == rows)
        for name, query in (("whale tab", {"filter_type": "HEAVY_WHALES"}),
                            ("hop tab", {"filter_type": "SMURFING_HOPS"}),
                            ("unknown link_type", {"link_type": "L9_L9"}),
                            ("unknown filter", {"order_by": "ts"}),
                            ("limit above the cap", {"limit": top + 1})):
            r = client.get(pp, params=query)
            check(f"problematic {name} -> 422", r.status_code == 422, f"HTTP {r.status_code}")

        # B4a: CSV template
        r = client.get("/api/templates/Sample_Victim_4Hop_CyberCrime_Statement.csv")
        lines = r.text.splitlines()
        check("template 200 text/csv", r.status_code == 200
              and r.headers.get("content-type", "").startswith("text/csv"),
              f"HTTP {r.status_code} {r.headers.get('content-type')}")
        same("template columns", lines[0].split(",") if lines else [], TEMPLATE_COLUMNS)
        check("template has one example row",
              len(lines) == 2 and len(lines[1].split(",")) == len(TEMPLATE_COLUMNS), str(lines[1:]))
        for name in ("Sample_Victim_4Hop_CyberCrime_Statement.pdf", "template.xlsx"):
            r = client.get(f"/api/templates/{name}")
            check(f"template {name} 404", r.status_code == 404, f"HTTP {r.status_code}")

        # B4a: deferred -> 501, dropped -> 410, frozen-accounts -> []
        for method, path in DEFERRED_B4:
            r = client.request(method, path)
            check(f"{method} {path} 501", r.status_code == 501
                  and r.json().get("detail") == "not yet available", r.text[:120])
        for method, path in DROPPED:
            r = client.request(method, path)
            check(f"{method} {path} 410", r.status_code == 410 and "detail" in r.json(),
                  r.text[:120])
        r = client.get("/api/scanner/frozen-accounts")
        check("frozen-accounts is an empty list", r.status_code == 200 and r.json() == [],
              r.text[:120])

        # B4b: /scanner/run-60s-benchmark
        bm = post(client, "/api/scanner/run-60s-benchmark", "benchmark", {})
        samples["/api/scanner/run-60s-benchmark"] = bm
        same("benchmark ingest rows", bm["ingestion"]["rows_loaded"], e["ingest"][0])
        same("benchmark ingest seconds", bm["ingestion"]["load_seconds"], e["ingest"][2])
        manifest = json.loads((db.parent / "graph" / "manifest.json").read_text(encoding="utf-8"))
        same("benchmark graph build seconds", bm["graph"]["build_seconds"],
             manifest["build_seconds"])
        same("benchmark graph rows", bm["graph"]["rows"], manifest["rows"])
        check("benchmark graph is current", bm["graph"]["current"] is True)
        ts_ = bm["trace_sample"]
        same("benchmark trace sample size", ts_["traces"], BENCHMARK_TRACES)
        check("benchmark trace timings are measured and ordered",
              0 < ts_["min_ms"] <= ts_["median_ms"] <= ts_["max_ms"] <= ts_["total_ms"], str(ts_))
        check("benchmark claims no speed-up", all(bm[k] is None for k in SUMMARY_NULLS))
        same("benchmark carries the scanner summary",
             {k: v for k, v in bm.items() if k in sm}, sm)

        # B4b: /jury/blind-test
        jp = "/api/jury/blind-test"
        r = client.post(jp)                    # the UI sends no body
        check("jury no body 200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:160]}")
        same("jury no body default n",
             r.json()["jury_criteria_summary"]["victims_traced"] if r.status_code == 200 else None,
             min(DEFAULT_JURY_VICTIMS, e["roles"]["VICTIM"]))
        jr = post(client, jp, "jury", {"seed": JURY_SEED})
        samples[jp] = jr
        js, q = jr["jury_criteria_summary"], jr["query_results"]
        same("jury default n", len(q), min(DEFAULT_JURY_VICTIMS, e["roles"]["VICTIM"]))
        same("jury victims distinct", len({x["victim_account"] for x in q}), len(q))
        same("jury summary counts", (js["victims_traced"], js["correct"], js["incorrect"]),
             (len(q), sum(x["correct"] for x in q), sum(not x["correct"] for x in q)))
        check("jury no ground-truth metric", js["detection_metrics"] is None)
        check("jury latencies measured", all(x["latency_ms"] > 0 for x in q)
              and js["max_latency_ms"] == max(x["latency_ms"] for x in q))
        again = post(client, jp, "jury", {"seed": JURY_SEED})
        same("jury same seed = same victims and findings",
             [(x["victim_account"], x["correct"], x["nodes_identified"])
              for x in again["query_results"]],
             [(x["victim_account"], x["correct"], x["nodes_identified"]) for x in q])
        for x in q[:5]:                        # against GET /trace (nodes include the victim root)
            t_ = get(client, f"/api/trace/{x['victim_account']}", "trace")
            same(f"jury {x['victim_account']} = GET /trace",
                 (x["nodes_identified"], x["transfers_found"], paise(x["siphoned_amount"]),
                  x["freeze_targets"]),
                 (len(t_["nodes"]) - 1, len(t_["links"]), paise(t_["total_siphoned_inr"]),
                  len(t_["freeze_candidates"])))
        full = post(client, jp, "jury", {"n": MAX_JURY_VICTIMS})
        fq = full["query_results"]
        con = duckdb.connect(str(db), read_only=True)
        try:
            victim_nos = {r_[0] for r_ in con.execute(
                "SELECT a.acct_no FROM scores s JOIN accounts a USING (acct_id) "
                "WHERE s.profile_id = ? AND s.role = 'VICTIM'", [e["profile_id"]]).fetchall()}
        finally:
            con.close()
        same("jury all victims: exactly the VICTIM accounts",
             {x["victim_account"] for x in fq}, victim_nos)
        same("jury all victims correct", sum(x["correct"] for x in fq), len(victim_nos))
        check("jury correct rows: found = expected", all(
            x["nodes_identified"] == x["accounts_expected"]
            and x["transfers_found"] == x["transfers_expected"]
            and x["accounts_only_in_trace"] == 0 and x["accounts_only_in_chain"] == 0
            for x in fq if x["correct"]))
        check("jury roles add up to the accounts found", all(
            sum(x["roles_breakdown"].values()) == x["nodes_identified"] for x in fq))
        print(f"jury all victims: {len(fq)} traced, "
              f"{full['jury_criteria_summary']['correct']} correct, median "
              f"{full['jury_criteria_summary']['median_latency_ms']} ms, max "
              f"{full['jury_criteria_summary']['max_latency_ms']} ms, chain "
              f"{full['jury_criteria_summary']['chain_build_ms']} ms; benchmark sample: {ts_}; "
              f"ingest {bm['ingestion']['load_seconds']} s, graph "
              f"{bm['graph']['build_seconds']} s")
        for name, bad in (("n = 0", {"n": 0}), ("n above the cap", {"n": MAX_JURY_VICTIMS + 1}),
                          ("unknown field", {"ground_truth": "x"})):
            r = client.post(jp, json=bad)
            check(f"jury {name} -> 422", r.status_code == 422, f"HTTP {r.status_code}")

        # Step 8d: cases, legal documents, freeze register, vault (scratch case store)
        t8 = time.perf_counter()
        s8 = check_case_store_api(client, db, e, scratch, "--llm" in sys.argv)
        t8 = time.perf_counter() - t8
        samples["step 8d"] = {k: v for k, v in s8.items() if k in ("case", "frozen", "verify")}

        # errors and CORS
        r = client.get("/api/nope")
        check("404 clean JSON", r.status_code == 404 and r.json().get("status") == 404
              and "detail" in r.json(), r.text[:120])
        r = client.get("/api/mules", params={"limit": 0})
        check("422 clean JSON", r.status_code == 422 and "errors" in r.json(), r.text[:120])
        same("CORS origins", sorted(ALLOWED_ORIGINS), sorted(DEV_ORIGINS))
        for origin in DEV_ORIGINS:
            r = client.get("/api/status", headers={"Origin": origin})
            check(f"CORS allows {origin}",
                  r.headers.get("access-control-allow-origin") == origin)
        r = client.get("/api/status", headers={"Origin": "http://example.invalid"})
        check("CORS refuses another origin", "access-control-allow-origin" not in r.headers)
        # From the OpenAPI document: app.routes does not list included routers' routes.
        writes = sorted(f"{m_.upper()} {p_}" for p_, ops in app.openapi()["paths"].items()
                        for m_ in ops if m_ not in ("get", "head", "options"))
        check("routes are listed", len(app.openapi()["paths"]) >= len(SCHEMAS) - 3)
        check("POST routes: read-only, deferred 501, dropped 410, or case-store only",
              writes == sorted(READ_ONLY_POSTS + DEFERRED_POSTS + REFUSED_POSTS + CASE_STORE_POSTS),
              ", ".join(writes))

    for where, bad in unnamed.items():
        check(f"bank_name = bank_directory name: {where}", not bad,
              f"{len(bad)} rows, e.g. {bad[:5]}")
    same("bank_name places checked", len(unnamed), BANK_NAME_PLACES)
    after = file_state(db)
    counts_after = table_counts(db)
    check("database content unchanged (row count of every table)", counts_before == counts_after,
          str({t: (n, counts_after.get(t)) for t, n in counts_before.items()
               if counts_after.get(t) != n}))
    check("database size unchanged", before[0] == after[0], f"{before[0]} -> {after[0]}")
    check("database modified time unchanged", before[1] == after[1], f"{before[1]} -> {after[1]}")
    check("no .wal file created", wal.exists() == wal_before)
    check("data\\cases.db untouched (the run used the scratch case store)",
          (file_state(DEFAULT_CASES_DB) if DEFAULT_CASES_DB.is_file() else None) == real_store
          and scratch.parent == SCRATCH_DIR and ROOT not in scratch.parents)
    shutil.rmtree(SCRATCH_DIR, ignore_errors=True)

    failed = [r for r in results if not r[1]]
    print(f"runtime {time.perf_counter() - t0:.2f} s   database {db.name} "
          f"({after[0]:,} bytes)   profile {e['profile_id']}")
    print(f"checks {len(results)}   passed {len(results) - len(failed)}   failed {len(failed)}")
    print(f"counts: accounts {e['accounts']}, flagged {e['flagged']}, "
          f"roles {dict(sorted(e['roles'].items()))}, cells {e['cells']}")
    print(f"step 8d: {t8:.2f} s on scratch case store; rows appended {s8['rows']}; "
          f"notices {s8['notices']['count']}, freeze requests {len(s8['freeze']['recorded'])}, "
          f"vault verify ok={s8['verify']['ok']}")
    print("timings ms (median / max, n): " + "; ".join(
        f"{k.replace('/api/', '')} {sorted(t)[len(t) // 2]:.0f} / {max(t):.0f} ({len(t)})"
        for k, t in timings.items()))
    for part in ("nodes", "links"):
        rows = tr.get(part) or []
        print(f"trace {part} fields null in every row: "
              f"{sorted(k for k in (rows[0] if rows else {}) if all(x[k] is None for x in rows))}")
    for name, _, detail in failed:
        print(f"FAIL  {name}  {detail}")
    if "--samples" in sys.argv:
        for path, body in samples.items():
            print(f"\n{path}\n{json.dumps(trim(body), indent=1)[:1800]}")
    print("PASSED" if not failed else "FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
