"""Freeze notices, case diary and FIR draft for a case, over legal\\*.py.

Each call builds the evidence object from one trace, renders, validates and
only then stores the page in the case store (case_outputs + its HTML) and adds
the case event. A page that fails its validator is neither stored nor returned.
Nothing here sends anything to a bank.
"""
from __future__ import annotations

import sys

from fastapi import HTTPException

from api.deps import ROOT, cases_path
from api.schemas.legal import (
    DiaryEntry, DiarySummary, FirRequest, LegalDocument, LlmStatus, NoticesResponse)
from api.services import cases as cases_service
from api.services import trace as trace_service
from api.services.cases import case_store

# The legal modules import each other by bare name (same directory).
LEGAL_DIR = ROOT / "legal"
if str(LEGAL_DIR) not in sys.path:
    sys.path.insert(0, str(LEGAL_DIR))

import diary  # noqa: E402
import fir  # noqa: E402
import notices  # noqa: E402
from evidence import EvidenceError, build_evidence  # noqa: E402

NO_NOTICES = "no freeze-recommended account holds this victim's money: no notice to write"


def _evidence(case_id: str, victim: str) -> tuple[dict, dict]:
    case = cases_service.open_case(case_id)
    if victim not in case["victim_accts"]:
        raise HTTPException(422, f"{victim} is not a victim account of {case_id}")
    try:
        ev, _ = trace_service._run(build_evidence, victim, case_id, case["fir_number"])
    except EvidenceError as e:
        raise HTTPException(422, str(e)) from e
    return case, ev


def _invalid(what: str, problems) -> HTTPException:
    return HTTPException(500, f"{what} failed validation; nothing was stored: {problems}")


def _store(ev: dict, doc_type: str, name: str, page: str, generator: str,
           bank: dict | None = None) -> LegalDocument:
    """Append a validated page to the case store and describe it."""
    row = cases_service.store(
        case_store.add_document, ev["case_id"], doc_type, name, page, True, generator,
        bank=bank["bank_prefix"] if bank else None)
    return LegalDocument(
        case_id=ev["case_id"], victim=ev["victim"]["acct_no"], doc_type=doc_type,
        bank=bank["bank_prefix"] if bank else None, bank_name=bank["bank_name"] if bank else None,
        output_id=row["output_id"], version=row["version"], file_name=row["file_path"],
        sha256=row["sha256"], validated=True, generator=generator,
        generated_at=ev["generated_at"], fingerprint=ev["fingerprint"],
        dataset_sha256=ev["dataset"]["sha256"], profile_id=ev["profile_id"], html=page)


def _name(kind: str, ev: dict, *parts: str) -> str:
    return "_".join(notices._file_part(p) for p in (kind, ev["case_id"], ev["victim"]["acct_no"], *parts))


def _event(case: dict, ev: dict, event: str, note: str, officer: str | None = None) -> None:
    cases_service.store(case_store.add_event, ev["case_id"], event, officer or case["officer"],
                        note=f"victim {ev['victim']['acct_no']}: {note}")


def freeze_notices(case_id: str, victim: str) -> NoticesResponse:
    case, ev = _evidence(case_id, victim)
    by_bank = {b["bank_prefix"]: b for b in ev["banks"]}
    pages = notices.render_notices(ev)
    for p in pages:
        problems = notices.validate_notice(p["html"], ev, by_bank[p["bank"]])
        if problems:
            raise _invalid(f"freeze notice for {p['bank']}", problems)
    docs = [_store(ev, "FREEZE_NOTICE", _name("freeze_notice", ev, p["bank"]), p["html"],
                   ev["generator"], by_bank[p["bank"]]) for p in pages]
    if docs:
        _event(case, ev, "NOTICES_GENERATED",
               f"{len(docs)} notice(s), banks {', '.join(d.bank for d in docs)}")
    return NoticesResponse(case_id=case_id, victim=victim, count=len(docs),
                           message=None if docs else NO_NOTICES, notices=docs)


def _diary(ev: dict, use_llm: bool) -> dict:
    try:
        return diary.build_diary(ev, use_llm=use_llm)
    except diary.DiaryError as e:
        raise _invalid("case diary", e) from e


def case_diary(case_id: str, victim: str) -> LegalDocument:
    """The template diary, at once: the local model is not asked."""
    case, ev = _evidence(case_id, victim)
    r = _diary(ev, use_llm=False)
    doc = _store(ev, "CASE_DIARY", _name("case_diary", ev), r["html"], r["generator"])
    _event(case, ev, "DIARY_GENERATED", f"template diary v{doc.version}")
    return doc


def diary_summary(case_id: str, victim: str) -> DiarySummary:
    """Ask the local model for the summary (3 to 5 sentences; the entries are the
    template's). Only a validated answer is returned as AI text and stored, as
    the next version of the diary."""
    case, ev = _evidence(case_id, victim)
    r = _diary(ev, use_llm=True)
    llm = LlmStatus(status=r["llm"]["status"], seconds=round(r["llm"]["seconds"], 1),
                    problems=r["llm"]["problems"])
    if r["generator"] != diary.GENERATOR_LLM:
        return DiarySummary(case_id=case_id, victim=victim, generator=r["generator"], llm=llm,
                            summary=None, entries=[], document=None)
    doc = _store(ev, "CASE_DIARY", _name("case_diary", ev), r["html"], r["generator"])
    _event(case, ev, "DIARY_GENERATED", f"diary v{doc.version} with validated AI narrative")
    return DiarySummary(case_id=case_id, victim=victim, generator=r["generator"], llm=llm,
                        summary=r["narrative"]["summary"],
                        entries=[DiaryEntry(**e) for e in r["narrative"]["entries"]], document=doc)


def fir_draft(body: FirRequest) -> LegalDocument:
    try:
        details = fir.fir_details(body.complainant.model_dump(), body.offence_summary,
                                  body.sections_of_law, body.police_station)
    except fir.FirError as e:
        raise HTTPException(422, str(e)) from e
    case, ev = _evidence(body.case_id, body.victim)
    try:
        r = fir.build_fir(ev, details)
    except fir.FirError as e:
        raise _invalid("FIR draft", e) from e
    doc = _store(ev, "FIR", _name("fir", ev), r["html"], r["generator"])
    _event(case, ev, "FIR_GENERATED", f"FIR draft v{doc.version}", body.officer)
    return doc
