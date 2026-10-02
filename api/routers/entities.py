from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.deps import Profile, get_con, get_profile
from api.schemas.entities import EntitiesResponse
from api.services import entities as service

router = APIRouter(tags=["entities"])


@router.get("/entities", response_model=EntitiesResponse)
def entities(limit: int = Query(500, ge=1, le=100000),
             bank_filter: str | None = None,
             min_amount: float = Query(0, ge=0),
             con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.list_entities(con, profile, limit=limit, bank_filter=bank_filter,
                                 min_amount=min_amount)
