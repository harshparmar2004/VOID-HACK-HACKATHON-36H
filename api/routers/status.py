from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import Profile, get_con, get_profile
from api.schemas.status import StatusResponse
from api.services import status as service

router = APIRouter(tags=["status"])


@router.get("/status", response_model=StatusResponse)
def status(con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.get_status(con, profile)
