from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_con
from api.schemas.profiles import PreviewRequest, PreviewResponse, ProfileResponse
from api.services import profiles as service

router = APIRouter(tags=["profiles"])

NOT_YET = "not yet available"


@router.get("/profiles/active", response_model=ProfileResponse)
def active_profile(con=Depends(get_con)):
    return service.get_active(con)


@router.post("/profiles/preview", response_model=PreviewResponse)
def preview(body: PreviewRequest, con=Depends(get_con)):
    """Read-only: re-scores a changed COPY of the active profile in memory. Saves nothing."""
    return service.preview(con, body)


@router.get("/profiles/{profile_id}", response_model=ProfileResponse)
def profile(profile_id: str, con=Depends(get_con)):
    return service.get_profile(con, profile_id)


# Writes are deferred (API_CONTRACT.md): the API is read-only for now.
@router.post("/profiles", status_code=501)
def create_profile():
    raise HTTPException(501, NOT_YET)


@router.post("/profiles/{profile_id}/activate", status_code=501)
def activate_profile(profile_id: str):
    raise HTTPException(501, NOT_YET)
