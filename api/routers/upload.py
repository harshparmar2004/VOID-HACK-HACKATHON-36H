from __future__ import annotations

from fastapi import APIRouter, File, UploadFile

from api.services import upload as service

router = APIRouter(tags=["upload"])


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a new transaction CSV ledger. Ingests into DuckDB, computes behavioral
    features, scores mules across forensic parameters, traces layer links,
    and returns comprehensive timing and parameter execution metrics.
    """
    return service.process_dataset_upload(file)
