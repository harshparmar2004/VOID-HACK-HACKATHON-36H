from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import Profile, get_con, get_profile
from api.schemas.benchmark import BenchmarkResponse, JuryRequest, JuryResponse
from api.services import benchmark as service

router = APIRouter(tags=["benchmark"])


@router.post("/scanner/run-60s-benchmark", response_model=BenchmarkResponse)
def run_benchmark(con=Depends(get_con), profile: Profile = Depends(get_profile)):
    """Read-only: stored ingest / graph build times and a live timed trace sample.
    Never re-runs ingestion."""
    return service.run_benchmark(con, profile)


@router.post("/jury/blind-test", response_model=JuryResponse)
def blind_test(body: JuryRequest | None = None,
               con=Depends(get_con), profile: Profile = Depends(get_profile)):
    """Read-only: random victims traced and checked against the structural chain."""
    body = body or JuryRequest()
    return service.blind_test(con, profile, body.n, body.seed)
