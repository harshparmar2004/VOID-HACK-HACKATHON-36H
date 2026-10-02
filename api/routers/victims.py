from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import Profile, get_con, get_profile
from api.schemas.victims import VictimsResponse
from api.services import victims as service

router = APIRouter(tags=["victims"])


@router.get("/victims", response_model=VictimsResponse)
@router.get("/detected-victims", response_model=VictimsResponse)
def victims(con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.list_victims(con, profile)
