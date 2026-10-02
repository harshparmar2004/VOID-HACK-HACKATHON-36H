from __future__ import annotations

from datetime import datetime

from api.schemas import ApiModel


class StatusResponse(ApiModel):
    # Names the UI reads.
    records_loaded: int | None
    records_parsed: int | None
    ingestion_seconds: float | None
    load_duration_seconds: float | None
    hash: str | None
    high_risk_mules: int          # accounts flagged by the active profile
    foreign_ip_txns: int
    unique_receivers: int
    victims: int
    # Ours.
    load_id: int | None
    file_name: str | None
    rows_rejected: int | None
    loaded_at: datetime | None
    accounts: int
    flagged: int
    freeze_recommended: int
    roles: dict[str, int]
    bands: dict[str, int]
    cells: int
    networks: int
    profile_id: str
