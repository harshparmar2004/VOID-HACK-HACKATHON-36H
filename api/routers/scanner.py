from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.deps import Profile, get_con, get_profile
from api.schemas.scanner import MAX_SCANNER_LIMIT, ProblematicTransaction, ScannerSummary
from api.services import scanner as service

router = APIRouter(tags=["scanner"])

FILTER_FIELDS = ("limit", "filter_type", "link_type", "min_amount", "bank_filter", "keyword")


@router.get("/scanner/summary", response_model=ScannerSummary)
def summary(con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.summary(con, profile.profile_id)


@router.get("/scanner/problematic-transactions", response_model=list[ProblematicTransaction])
def problematic_transactions(request: Request,
                             limit: int = Query(100, ge=1, le=MAX_SCANNER_LIMIT),
                             filter_type: str | None = None,
                             link_type: str | None = None,
                             min_amount: float | None = Query(None, ge=0),
                             bank_filter: str | None = None,
                             keyword: str | None = None,
                             con=Depends(get_con), profile: Profile = Depends(get_profile)):
    """Layer links and transfers touching a flagged account, newest first."""
    unknown = sorted(set(request.query_params) - set(FILTER_FIELDS))
    if unknown:
        raise HTTPException(422, f"Unknown filter(s): {', '.join(unknown)}. "
                                 f"Allowed: {', '.join(FILTER_FIELDS)}")
    return service.problematic(
        con, profile.profile_id, limit=limit, filter_type=filter_type, link_type=link_type,
        min_amount=min_amount, bank_filter=bank_filter, keyword=keyword)


# The freeze register is deferred (deferred.py); until it exists nothing is frozen.
@router.get("/scanner/frozen-accounts", response_model=list)
def frozen_accounts():
    return []
