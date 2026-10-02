"""Cases, the freeze register and the vault, over engine\\case_store.py.

The case store (data\\cases.db) is the ONLY thing the API writes, and only by
appending rows. data\\case.duckdb is read through the usual read-only connection.
"""
from __future__ import annotations

from fastapi import HTTPException

from api.deps import Profile, cases_path
from api.repositories import banks as banks_repo
from api.repositories import status as status_repo
from api.repositories import trace as trace_repo
from api.schemas.cases import (
    ArtifactsResponse, CaseClose, CaseCreate, CaseDetail, CaseEvent, CaseItem, CaseOutput,
    CaseOutputs, CasesResponse, FreezeAction, FreezeRequest, FreezeResponse, FreezeSkipped,
    FrozenAccount, StoredOutput, VerifyResponse)
from api.services import rupees
from api.services import trace as trace_service
from api.services.trace import engine

import case_store  # noqa: E402  (engine\ is on sys.path: api.services.trace)

REQUESTED, WITHDRAWN = case_store.ACTIONS


def store(fn, *args, **kwargs):
    """Call a case_store writer on the API's case store; its refusals become 422,
    a write on a closed case 409."""
    try:
        return fn(*args, db=cases_path(), **kwargs)
    except case_store.CaseClosedError as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def case_or_404(case_id: str) -> dict:
    case = case_store.get_case(case_id, cases_path())
    if case is None:
        raise HTTPException(404, f"unknown case {case_id}")
    return case


def open_case(case_id: str) -> dict:
    """The case, for a write: 404 if unknown, 409 once it is closed. The case
    store refuses the write again inside its own transaction."""
    case = case_or_404(case_id)
    if case["status"] == case_store.CLOSED:
        raise HTTPException(409, f"{case_id} is closed: nothing more can be recorded on it")
    return case


def _item(c: dict) -> dict:
    return {"case_id": c["case_id"], "created_at": c["created_at"], "officer": c["officer"],
            "fir_number": c["fir_number"], "complainant": c["complainant"],
            "victims": c["victim_accts"], "dataset_sha256": c["dataset_sha256"],
            "profile_id": c["profile_id"], "status": c["status"]}


def output(o: dict, model=CaseOutput, **extra) -> CaseOutput:
    return model(
        **extra,
        output_id=o["seq"], case_id=o["case_id"], doc_type=o["doc_type"], bank=o["bank"],
        version=o["version"], file_name=o["file_path"], sha256=o["sha256"],
        validated=bool(o["validated"]), generator=o["generator"], created_at=o["created_at"],
        row_hash=o["row_hash"])


def _action(a: dict, names: dict[str, str]) -> FreezeAction:
    return FreezeAction(
        action_id=a["seq"], case_id=a["case_id"], account=a["account"], bank=a["bank"],
        bank_name=names.get(a["bank"]), amount=rupees(a["amount_paise"]), action=a["action"],
        note=a["note"], officer=a["officer"], created_at=a["created_at"])


def _detail(con, case: dict) -> CaseDetail:
    names = banks_repo.names(con)
    return CaseDetail(
        **_item(case),
        events=[CaseEvent(event_id=e["seq"], case_id=e["case_id"], event=e["event"],
                          officer=e["officer"], note=e["note"], created_at=e["created_at"])
                for e in case["events"]],
        outputs=[output(o) for o in case["outputs"]],
        freeze_actions=[_action(a, names) for a in case["freeze_actions"]])


def create(con, profile: Profile, body: CaseCreate) -> CaseDetail:
    victims = list(dict.fromkeys(v.strip() for v in body.victims))
    unknown = sorted(set(victims) - set(trace_repo.ifsc_of(con, victims)))
    if unknown:
        raise HTTPException(422, f"not an account of the loaded dataset: {unknown}")
    ingest = status_repo.latest_ingest(con)
    if ingest is None:
        raise HTTPException(503, "no dataset is loaded: the dataset SHA-256 is unknown")
    case_id = store(case_store.create_case, body.officer, victims, ingest["file_sha256"],
                    profile.profile_id, fir_number=body.fir_number, complainant=body.complainant)
    return _detail(con, case_or_404(case_id))


def list_all() -> CasesResponse:
    cases = [CaseItem(**_item(c)) for c in case_store.list_cases(cases_path())]
    return CasesResponse(count=len(cases), cases=cases)


def detail(con, case_id: str) -> CaseDetail:
    return _detail(con, case_or_404(case_id))


def close(con, case_id: str, body: CaseClose) -> CaseDetail:
    open_case(case_id)
    store(case_store.add_event, case_id, case_store.CLOSED, body.officer, note=body.note)
    return _detail(con, case_or_404(case_id))


def _documents(case_id: str, output_id: int | None = None) -> list[dict]:
    case_or_404(case_id)
    try:
        return case_store.case_documents(case_id, output_id, cases_path())
    except case_store.DocumentMismatch as e:
        raise HTTPException(409, str(e)) from e


def outputs(case_id: str) -> CaseOutputs:
    items = [output(d, StoredOutput, stored=d["body"] is not None) for d in _documents(case_id)]
    return CaseOutputs(case_id=case_id, count=len(items), outputs=items)


def output_page(case_id: str, output_id: int) -> dict:
    """The case_outputs row with its page (`body`), re-hashed against its sha256."""
    found = _documents(case_id, output_id)
    if not found:
        raise HTTPException(404, f"{case_id} has no output {output_id}")
    if found[0]["body"] is None:
        raise HTTPException(404, f"the page of output {output_id} is not kept in the case store")
    return found[0]


# --- freeze register ------------------------------------------------------------

def _traced_holdings(case: dict) -> dict[str, dict]:
    """account -> bank and the paise of this case's victims' money the trace holds there."""
    held: dict[str, dict] = {}
    for victim in case["victim_accts"]:
        r, _ = trace_service._run(engine.trace_victim, victim)
        for a in r["accounts"] if r["found"] else ():
            entry = held.setdefault(a["acct_no"], {"bank": a["bank"], "paise": 0})
            entry["paise"] += int(a["holding"])
    return held


def _record(con, body: FreezeRequest, action: str) -> FreezeResponse:
    case = open_case(body.case_id)
    accounts = list(dict.fromkeys(a.strip() for a in body.accounts))
    officer = body.officer or case["officer"]
    held = _traced_holdings(case)
    outside = sorted(set(accounts) - set(held))
    if outside:
        raise HTTPException(422, f"not reached by the traces of {body.case_id}: {outside}")
    open_now = {a["account"] for a in case_store.current_requests(body.case_id, cases_path())}
    recorded, skipped = [], []
    for account in accounts:
        if (account in open_now) == (action == REQUESTED):
            skipped.append(FreezeSkipped(account=account, reason=(
                "a freeze request is already recorded" if action == REQUESTED
                else "no freeze request is recorded")))
            continue
        recorded.append(store(case_store.add_freeze_action, body.case_id, account,
                              held[account]["bank"], held[account]["paise"], action, officer,
                              note=body.note))
    names = banks_repo.names(con)
    written = [a for a in case_or_404(body.case_id)["freeze_actions"] if a["seq"] in set(recorded)]
    return FreezeResponse(case_id=body.case_id, action=action,
                          recorded=[_action(a, names) for a in written], skipped=skipped)


def request_freeze(con, body: FreezeRequest) -> FreezeResponse:
    return _record(con, body, REQUESTED)


def withdraw_freeze(con, body: FreezeRequest) -> FreezeResponse:
    return _record(con, body, WITHDRAWN)


def frozen_accounts(con, case_id: str | None) -> list[FrozenAccount]:
    names = banks_repo.names(con)
    return [FrozenAccount(case_id=a["case_id"], account=a["account"], bank=a["bank"],
                          bank_name=names.get(a["bank"]), amount=rupees(a["amount_paise"]),
                          requested_at=a["created_at"], officer=a["officer"], note=a["note"])
            for a in case_store.current_requests(case_id, cases_path())]


# --- vault ----------------------------------------------------------------------

def artifacts(con) -> ArtifactsResponse:
    ingest = status_repo.latest_ingest(con) or {}
    items = [output(o) for o in case_store.list_outputs(None, cases_path())]
    return ArtifactsResponse(count=len(items), dataset_file=ingest.get("file_name"),
                             dataset_sha256=ingest.get("file_sha256"), artifacts=items)


def verify() -> VerifyResponse:
    db = cases_path()
    if not db.is_file():
        case_store.connect(db).close()
    r = case_store.verify(db)
    return VerifyResponse(ok=r["ok"], rows=r["rows"], triggers=r["triggers"],
                          triggers_expected=len(case_store.TRIGGERS),
                          documents=r["rows"].get("output_bodies", 0), problems=r["problems"])
