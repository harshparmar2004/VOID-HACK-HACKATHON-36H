from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["templates"])

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
TEMPLATE_CSV = "transactions_template.csv"


@router.get("/templates/{file}")
def template(file: str):
    """Any .csv name gets the one CSV template; the requested name is never used as a path."""
    if not file.lower().endswith(".csv"):
        raise HTTPException(404, "Only the CSV template is available")
    return FileResponse(STATIC_DIR / TEMPLATE_CSV, media_type="text/csv", filename=TEMPLATE_CSV)
