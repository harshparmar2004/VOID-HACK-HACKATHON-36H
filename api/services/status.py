from __future__ import annotations

from api.deps import Profile
from api.repositories import status as repo
from api.schemas.status import StatusResponse


def get_status(con, profile: Profile) -> StatusResponse:
    ingest = repo.latest_ingest(con) or {}
    tx = repo.tx_counts(con)
    scores = repo.score_counts(con, profile.profile_id)
    roles = {r["role"]: r["n"] for r in repo.role_counts(con, profile.profile_id)}
    bands = {r["band"]: r["n"] for r in repo.band_counts(con, profile.profile_id)}
    cells = repo.cell_counts(con, profile.profile_id)
    return StatusResponse(
        records_loaded=ingest.get("rows_loaded"),
        records_parsed=ingest.get("rows_total"),
        ingestion_seconds=ingest.get("load_seconds"),
        load_duration_seconds=ingest.get("load_seconds"),
        hash=ingest.get("file_sha256"),
        high_risk_mules=scores["flagged"],
        foreign_ip_txns=tx["foreign_ip_txns"],
        unique_receivers=tx["unique_receivers"],
        victims=roles.get("VICTIM", 0),
        load_id=ingest.get("load_id"),
        file_name=ingest.get("file_name"),
        rows_rejected=ingest.get("rows_rejected"),
        loaded_at=ingest.get("loaded_at"),
        accounts=repo.account_count(con),
        flagged=scores["flagged"],
        freeze_recommended=scores["freeze_recommended"],
        roles=roles,
        bands=bands,
        cells=cells["cells"],
        networks=cells["networks"],
        profile_id=profile.profile_id,
    )
