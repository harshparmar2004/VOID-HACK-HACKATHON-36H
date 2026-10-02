from __future__ import annotations

from datetime import datetime

from api.schemas import ApiModel


class EntityItem(ApiModel):
    # Names the UI reads.
    account: str
    bank: str
    ifsc: str
    type: str                     # label of the engine role
    totalIn: float                # rupees
    totalOut: float               # rupees
    balance: float                # rupees, totalIn - totalOut
    risk: str | None              # "<BAND> (<final_index>)"
    # Ours.
    role: str | None
    role_confirmed: bool | None
    is_flagged: bool | None
    final_index: float | None
    mule_index: float | None
    trust_index: float | None
    victim_score: float | None
    band: str | None
    freeze_recommended: bool | None
    tx_count: int | None
    n_in: int | None
    n_out: int | None
    days_active: int | None
    first_seen: datetime | None
    last_seen: datetime | None


class BankStat(ApiModel):
    code: str
    name: str | None              # bank_directory name; null until that table is filled
    count: int
    share: float                  # percent of all accounts


class EntitiesResponse(ApiModel):
    entities: list[EntityItem]
    bank_stats: list[BankStat]
    total_accounts: int           # all accounts in the database
    matched: int                  # accounts passing the filters (before limit)
    returned: int
    profile_id: str
