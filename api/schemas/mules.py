from __future__ import annotations

from api.schemas import ApiModel


class MuleItem(ApiModel):
    # Names the UI reads (aliases carry the same value).
    account: str
    account_id: str
    bank: str
    ifsc: str
    bank_ifsc: str
    role: str | None
    risk_index: float | None      # = final_index
    risk_score: float | None      # = final_index
    risk_band: str | None         # = band
    forensic_reason: str          # reasons joined into one string
    forensic_reasons: list[str]
    reasons: list[str]
    distinct_senders: int
    distinct_receivers: int
    total_incoming_amt: float     # rupees, all money received (tx)
    total_outgoing_amt: float     # rupees, all money sent (tx)
    current_holding_balance: float | None
    holding_amount: float | None
    # The UI expects these; our tables have no equivalent.
    hop: None = None
    p1_score: None = None
    p2_score: None = None
    p3_score: None = None
    p4_score: None = None
    p5_score: None = None
    p6_score: None = None
    # Ours.
    final_index: float | None
    mule_index: float | None
    trust_index: float | None
    band: str | None
    role_confirmed: bool | None
    freeze_recommended: bool | None
    param_points: dict[str, float | None] | None
    cell_ids: list[int]
    network_id: int | None
