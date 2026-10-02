"""Step 8 documents for a case. Each call stores what it generated in the case
store (data\\cases.db) and adds the case event; nothing is sent anywhere."""
from __future__ import annotations

from fastapi import APIRouter

from api.schemas.legal import DiarySummary, FirRequest, LegalDocument, NoticesResponse
from api.services import legal as service

router = APIRouter(tags=["legal"])


@router.get("/legal/notices/{victim}", response_model=NoticesResponse)
def notices(victim: str, case_id: str):
    """One freeze notice per bank in the trace's freeze list."""
    return service.freeze_notices(case_id, victim)


# Declared before /legal/case-diary/{victim}: a longer path, so the two never collide.
@router.get("/legal/case-diary/{victim}/summary", response_model=DiarySummary)
def case_diary_summary(victim: str, case_id: str):
    """The AI narrative, from the local model (may take up to the configured timeout)."""
    return service.diary_summary(case_id, victim)


@router.get("/legal/case-diary/{victim}", response_model=LegalDocument)
def case_diary(victim: str, case_id: str):
    """The template diary, at once. The AI narrative is fetched from /summary."""
    return service.case_diary(case_id, victim)


@router.post("/legal/fir", response_model=LegalDocument)
def fir(body: FirRequest):
    return service.fir_draft(body)
