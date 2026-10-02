from __future__ import annotations

from datetime import datetime
from typing import Any

from api.schemas import ApiModel

MAX_SEARCH_LIMIT = 1000           # response size limit, not an engine rule


class TransactionItem(ApiModel):
    tx_key: int
    txn_id: str | None            # original Transaction_ID, display only
    source: str
    target: str
    source_bank: str | None
    target_bank: str | None
    amount: float                 # rupees
    timestamp: datetime
    payment_mode: str | None
    narration: str | None
    narration_category: str | None
    device_type: str | None
    ip_address: str | None
    is_foreign_ip: bool | None
    is_headless: bool | None
    link_type: str | None         # proven layer link of the active profile, if any


class TransactionSearchResponse(ApiModel):
    matched: int                  # all transactions matching the filters
    returned: int
    limit: int
    filters: dict[str, Any]       # the filters applied, as received
    transactions: list[TransactionItem]
