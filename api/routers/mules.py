from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.deps import Profile, get_con, get_profile
from api.schemas.mules import MuleItem
from api.services import mules as service

router = APIRouter(tags=["mules"])


@router.get("/mules", response_model=list[MuleItem])
def mules(limit: int = Query(2000, ge=1, le=100000),
          role_filter: str | None = None,
          min_risk: float = Query(0, ge=0, le=100),
          min_amount: float = Query(0, ge=0),
          bank_filter: str | None = None,
          con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.list_mules(con, profile, limit=limit, role_filter=role_filter,
                              min_risk=min_risk, min_amount=min_amount,
                              bank_filter=bank_filter)
