from __future__ import annotations

from datetime import datetime

from api.schemas import ApiModel

MAX_SCANNER_LIMIT = 1000          # response size limit, not an engine rule


class ForeignIpSummary(ApiModel):
    foreign_ip_txns: int          # flagged transfers sent from a foreign IP
    total_volume_inr: float
    subnets_flagged: None = None  # not measured


class LinkageSummary(ApiModel):
    flagged_txns: int             # proven layer links of the active profile
    total_volume_inr: float


class HoldingSummary(ApiModel):
    holding_accounts_at_risk: int         # flagged accounts still holding money
    recoverable_holding_inr: float
    predicted_cashout_window_mins: None = None   # not measured


class FlaggedTransferSummary(ApiModel):
    count: int                    # layer links + transfers touching a flagged account
    total_volume_inr: float


class LinkTypeCount(ApiModel):
    link_type: str
    count: int
    total_volume_inr: float


class ScannerSummary(ApiModel):
    status: str
    profile_id: str
    records_scanned: int
    # The UI's benchmark numbers: not measured here, so null (never invented).
    elapsed_seconds: None = None
    speedup_factor: None = None
    throughput_txns_per_second: None = None
    benchmark_passed: None = None
    target_seconds: None = None
    parameters_evaluated: None = None
    heavy_whale_transactions: None = None        # no "whales" in our engine
    hyper_frequency_accounts: None = None
    multi_ip_geolocation: ForeignIpSummary
    illegal_linkages: LinkageSummary
    early_intervention: HoldingSummary
    flagged_transfers: FlaggedTransferSummary
    link_types: list[LinkTypeCount]


class ProblematicTransaction(ApiModel):
    # their field names
    Transaction_ID: str | None    # original Transaction_ID, display only
    txn_timestamp: datetime
    Sender_Account: str
    Sender_IFSC: str | None
    Receiver_Account: str
    Receiver_IFSC: str | None
    Amount_INR: float
    Payment_Mode: str | None
    Narration: str | None
    IP_Address: str | None
    Device_Type: str | None
    receiver_bank: str | None
    receiver_role: str | None
    is_foreign_ip: bool | None
    holding_balance: float | None  # the receiver's holding, rupees
    # read by the UI, not in our data
    hop_stage: None = None
    anomaly_flags: None = None
    urgency: None = None
    estimated_minutes_to_exit: None = None
    is_scam_narration: None = None
    # ours
    tx_key: int
    link_type: str | None
    lag_seconds: int | None
    sender_bank: str | None
    sender_role: str | None
    sender_flagged: bool
    receiver_flagged: bool
    narration_category: str | None
    is_headless: bool | None
