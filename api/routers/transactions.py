from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.deps import Profile, get_con, get_profile
from api.schemas.transactions import MAX_SEARCH_LIMIT, TransactionSearchResponse
from api.services import transactions as service

router = APIRouter(tags=["transactions"])

SEARCH_FIELDS = ("min_amount", "max_amount", "bank", "payment_mode", "device", "foreign_ip",
                 "narration_category", "from_ts", "to_ts", "limit")


@router.get("/transactions/search", response_model=TransactionSearchResponse)
def search(request: Request,
           min_amount: float | None = Query(None, ge=0),
           max_amount: float | None = Query(None, ge=0),
           bank: str | None = None,
           payment_mode: str | None = None,
           device: str | None = None,
           foreign_ip: bool | None = None,
           narration_category: str | None = None,
           from_ts: datetime | None = None,
           to_ts: datetime | None = None,
           limit: int = Query(100, ge=1, le=MAX_SEARCH_LIMIT),
           con=Depends(get_con), profile: Profile = Depends(get_profile)):
    """Only the whitelisted fields may be searched; anything else is refused."""
    unknown = sorted(set(request.query_params) - set(SEARCH_FIELDS))
    if unknown:
        raise HTTPException(422, f"Unknown search field(s): {', '.join(unknown)}. "
                                 f"Allowed: {', '.join(SEARCH_FIELDS)}")
    return service.search(
        con, profile.profile_id, min_amount=min_amount, max_amount=max_amount, bank=bank,
        payment_mode=payment_mode, device=device, foreign_ip=foreign_ip,
        narration_category=narration_category, from_ts=from_ts, to_ts=to_ts, limit=limit)
