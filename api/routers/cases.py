"""Cases, the freeze register and the vault. The write routes here append to
data\\cases.db and to nothing else; data\\case.duckdb is only read."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from api.deps import Profile, get_con, get_profile
from api.schemas.cases import (
    ArtifactsResponse, CaseClose, CaseCreate, CaseDetail, CaseOutputs, CasesResponse,
    FreezeRequest, FreezeResponse, FrozenAccount, VerifyResponse)
from api.services import cases as service

router = APIRouter(tags=["cases"])

SHA_HEADER = "X-Content-SHA256"


@router.post("/cases", response_model=CaseDetail, status_code=201)
def create_case(body: CaseCreate, con=Depends(get_con), profile: Profile = Depends(get_profile)):
    """Open a case: one cases row and its OPENED event."""
    return service.create(con, profile, body)


@router.get("/cases", response_model=CasesResponse)
def list_cases():
    return service.list_all()


@router.get("/cases/{case_id}", response_model=CaseDetail)
def get_case(case_id: str, con=Depends(get_con)):
    return service.detail(con, case_id)


@router.post("/cases/{case_id}/close", response_model=CaseDetail)
def close_case(case_id: str, body: CaseClose, con=Depends(get_con)):
    """Append the CLOSED event. Every later write on the case answers 409."""
    return service.close(con, case_id, body)


@router.get("/cases/{case_id}/outputs", response_model=CaseOutputs)
def case_outputs(case_id: str):
    """The case's documents; 409 with the vault error if a stored page fails its sha256."""
    return service.outputs(case_id)


@router.get("/cases/{case_id}/outputs/{output_id}", response_class=Response,
            responses={200: {"content": {"text/html": {}}}})
def case_output_page(case_id: str, output_id: int):
    """The stored page, byte for byte, after re-hashing it against its sha256 (409 on a mismatch)."""
    doc = service.output_page(case_id, output_id)
    return Response(doc["body"].encode("utf-8"), media_type="text/html; charset=utf-8",
                    headers={SHA_HEADER: doc["sha256"],
                             "Content-Disposition": f'inline; filename="{doc["file_path"]}"'})


@router.post("/scanner/emergency-freeze", response_model=FreezeResponse)
def emergency_freeze(body: FreezeRequest, con=Depends(get_con)):
    """Record REQUESTED for each account. Nothing is sent to a bank."""
    return service.request_freeze(con, body)


@router.post("/scanner/unfreeze", response_model=FreezeResponse)
def unfreeze(body: FreezeRequest, con=Depends(get_con)):
    """Record WITHDRAWN for each account; the REQUESTED rows stay."""
    return service.withdraw_freeze(con, body)


@router.get("/scanner/frozen-accounts", response_model=list[FrozenAccount])
def frozen_accounts(case_id: str | None = None, con=Depends(get_con)):
    """Accounts with a freeze REQUESTED and not withdrawn (not: frozen by a bank)."""
    return service.frozen_accounts(con, case_id)


@router.get("/vault/artifacts", response_model=ArtifactsResponse)
def vault_artifacts(con=Depends(get_con)):
    return service.artifacts(con)


@router.post("/vault/verify", response_model=VerifyResponse)
def vault_verify():
    """Read-only: recompute the hash chain of every case-store table and re-hash
    every stored document."""
    return service.verify()
