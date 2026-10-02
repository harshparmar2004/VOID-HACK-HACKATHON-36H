from __future__ import annotations

from datetime import datetime

from api.schemas import ApiModel


class VictimItem(ApiModel):
    account: str
    account_id: str               # same as account (the UI reads either)
    bank: str
    bank_name: str | None         # bank_directory name
    ifsc: str
    amount: float | None          # rupees paid into the chain (proven VICTIM_L1 links)
    timestamp: datetime | None    # first such payment
    payments: int | None
    victim_score: float | None
    cell_ids: list[int]
    network_id: int | None


class VictimsResponse(ApiModel):
    victims: list[str]            # account numbers (the UI's case list)
    items: list[VictimItem]       # the same accounts, same order, with details
