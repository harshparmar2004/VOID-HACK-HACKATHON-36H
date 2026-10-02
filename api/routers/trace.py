from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.deps import Profile, get_con, get_profile
from api.schemas.trace import (
    BatchNotFound, BatchRequest, BatchResponse, CellsResponse, CellSummary, CellVictims,
    NetworkResponse, NotFound, TraceResponse)
from api.services import trace as service

router = APIRouter(tags=["trace"])


# Declared before /trace/{victim}; it is a POST, so the two never collide.
@router.post("/trace/batch", response_model=BatchResponse | BatchNotFound)
def trace_batch(body: BatchRequest, con=Depends(get_con)):
    """Read-only: several victims traced into one merged graph. Writes nothing."""
    return service.trace_batch(con, body.victims)


@router.get("/trace/{victim}", response_model=TraceResponse | NotFound)
def trace(victim: str,
          max_hops: int | None = Query(None, ge=1),
          time_window: str | None = None,
          min_amount: float = Query(0, ge=0),
          bank_filter: str | None = None,
          keyword: str | None = None,
          custom_rules: str | None = None,
          con=Depends(get_con)):
    """time_window and custom_rules are accepted and ignored: the windows and
    rules come from the active profile (returned under `profile`)."""
    ignored = [name for name, value in (("time_window", time_window),
                                        ("custom_rules", custom_rules)) if value is not None]
    return service.trace(con, victim, max_hops=max_hops, min_amount=min_amount,
                         bank_filter=bank_filter, keyword=keyword, ignored=ignored)


@router.get("/cells", response_model=CellsResponse)
def cells(con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.list_cells(con, profile.profile_id)


@router.get("/cells/{cell_id}", response_model=CellSummary)
def cell(cell_id: int):
    return service.cell(cell_id)


@router.get("/cells/{cell_id}/victims", response_model=CellVictims)
def cell_victims(cell_id: int):
    return service.cell_victims(cell_id)


@router.get("/network", response_model=NetworkResponse)
def network(con=Depends(get_con), profile: Profile = Depends(get_profile)):
    return service.networks(con, profile.profile_id)
