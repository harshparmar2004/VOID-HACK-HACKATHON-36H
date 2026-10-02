"""Responses of /trace, /trace/batch, /cells and /network. Money is in rupees."""
from __future__ import annotations

from datetime import datetime

from pydantic import Field

from api.schemas import ApiModel

MAX_BATCH_VICTIMS = 500           # request size limit, not an engine rule


class NotFound(ApiModel):
    found: bool = False
    message: str


class BatchNotFound(NotFound):
    not_found: list[str]


class VictimShare(ApiModel):
    tainted_received: float
    tainted_forwarded: float
    untraced_out: float
    holding_amount: float
    share_of_tainted_in: float | None


class TraceNode(ApiModel):
    # Names the UI reads.
    id: str                       # account number
    hop: int                      # distance at first arrival, display only
    role: str | None
    bank: str | None
    ifsc: str | None
    risk_score: float | None      # = final_index; victim_score for a VICTIM
    holding_amount: float         # the traced money still held here
    tainted_received: float
    tainted_forwarded: float
    # Ours are per transfer: the most frequent value on the node's OUTGOING
    # links in this trace; null for a node that sends nothing in it.
    device_type: str | None = None
    ip_address: str | None = None
    # Ours.
    final_index: float | None
    mule_index: float | None
    trust_index: float | None
    victim_score: float | None
    band: str | None
    is_flagged: bool | None
    role_confirmed: bool | None
    freeze_recommended: bool
    reasons: list[str]
    cell_ids: list[int]
    network_id: int | None
    untraced_out: float
    account_holding: float | None  # the account's own balance kept (scores)
    stopped: str | None
    by_victim: dict[str, VictimShare] | None = None   # batch trace only


class TraceLink(ApiModel):
    # Names the UI reads.
    source: str
    target: str
    amount: float
    timestamp: str
    txn_id: str | None            # original Transaction_ID, display only
    payment_mode: str | None
    # Ours.
    tx_key: int
    link_type: str | None         # null = followed by the fallback rules
    lag_seconds: int | None       # arrival at source -> this transfer (layer links)
    hop: int
    tainted: float
    via: str
    confidence: str
    l1_edge_score: float | None
    narration: str | None
    device_type: str | None
    ip_address: str | None
    by_victim: dict[str, float] | None = None         # batch trace only


class PerHop(ApiModel):
    hop: int
    accounts: int
    transfers: int
    tainted: float
    first_ts: str
    last_ts: str
    seconds_since_previous_hop: int | None
    minutes_since_previous_hop: float | None


class Finding(ApiModel):
    pattern: str
    confidence: str
    evidence: list[str]
    accounts: list[str]
    tx_keys: list[int]
    tx_ids: list[str | None]
    hop_range: list[int]


class Receipt(ApiModel):
    tx_id: str | None
    tx_key: int
    ts: str
    amount: float
    tainted: float
    by_victim: dict[str, float] | None = None


class FreezeCandidate(ApiModel):
    acct_no: str
    bank: str | None
    role: str | None
    hop: int
    cell_id: int | None = None
    cell_ids: list[int]
    holding: float
    tainted_in: float | None = None
    by_victim: dict[str, float] | None = None
    receipts: list[Receipt]


class Reconcile(ApiModel):
    victim_paid: float
    commissions_kept: float
    holding_at_end: float
    untraced: float
    difference: float             # rounding only


class PaymentsNotFollowed(ApiModel):
    count: int
    amount: float


class TraceSummary(ApiModel):
    tainted_total: float
    accounts: int
    accounts_by_role: dict[str, int]
    transfers: int
    hops: int
    max_hops: int
    holding_total: float
    cell_ids: list[int]
    freeze_recommended: int
    freeze_holding_total: float
    untraced_total: float
    who: str
    how: str
    why: str
    when: str
    first_ts: str | None
    last_ts: str | None
    seconds_first_to_last: int | None
    used_fallback: bool
    low_confidence: bool
    payments_not_followed: PaymentsNotFollowed
    truncated: bool


class Window(ApiModel):
    min: float
    max: float


class ProfileUsed(ApiModel):
    """The active profile's trace settings. time_window never replaces them."""
    profile_id: str
    max_hops: int
    split_forward_minutes: Window
    single_forward_minutes: Window
    fallback_minutes: Window
    coverage_target: float
    max_accounts: int


class FiltersApplied(ApiModel):
    """What was done to the RETURNED nodes / links. Totals, summary, reconcile
    and fingerprint always describe the whole trace."""
    max_hops_requested: int | None
    max_hops_shown: int
    min_amount: float | None
    bank_filter: str | None
    keyword: str | None
    ignored: list[str]            # parameters sent but not used
    nodes_total: int
    links_total: int
    nodes_returned: int
    links_returned: int


class CellBrief(ApiModel):
    cell_id: int
    network_id: int | None
    l1_account: str | None
    size: int | None
    l1_count: int | None
    l2_count: int | None
    l3_count: int | None
    unclassified_count: int | None
    victim_count: int | None
    total_in: float | None
    holding: float | None
    first_ts: datetime | None
    last_ts: datetime | None
    patterns: list[str]
    fingerprint: str | None


class TraceResponse(ApiModel):
    found: bool = True
    # Names the UI reads.
    nodes: list[TraceNode]
    links: list[TraceLink]
    total_siphoned_inr: float
    recoverable_holding_inr: float    # held in freeze-recommended accounts
    # Ours.
    display_trimmed: bool             # true = nodes / links are a filtered view
    full_hops: int                    # hops of the whole trace, whatever is shown
    victim: str
    amount_unit: str
    fingerprint: str | None
    profile: ProfileUsed
    filters: FiltersApplied
    summary: TraceSummary
    reconcile: Reconcile
    per_hop: list[PerHop]
    findings: list[Finding]
    freeze_candidates: list[FreezeCandidate]
    cells: list[CellBrief]


class BatchRequest(ApiModel):
    victims: list[str] = Field(min_length=1, max_length=MAX_BATCH_VICTIMS)


class BatchVictim(ApiModel):
    acct_no: str
    bank: str | None
    paid: float
    accounts: int
    transfers: int
    holding_total: float
    untraced_total: float
    cell_ids: list[int]
    first_ts: str | None
    last_ts: str | None
    fingerprint: str | None


class BatchSummary(ApiModel):
    victims: int
    tainted_total: float
    accounts: int
    shared_accounts: int
    accounts_by_role: dict[str, int]
    transfers: int
    shared_transfers: int
    holding_total: float
    untraced_total: float
    cell_ids: list[int]
    freeze_recommended: int
    used_fallback: bool
    low_confidence: bool
    truncated: bool


class BatchResponse(ApiModel):
    found: bool = True
    nodes: list[TraceNode]
    links: list[TraceLink]
    total_siphoned_inr: float
    recoverable_holding_inr: float
    amount_unit: str
    fingerprint: str | None
    profile: ProfileUsed
    victims: list[BatchVictim]
    not_found: list[str]
    summary: BatchSummary
    freeze_candidates: list[FreezeCandidate]
    cells: list[CellBrief]


class CellsResponse(ApiModel):
    profile_id: str
    amount_unit: str
    count: int
    cells: list[CellBrief]


class CellVictim(ApiModel):
    acct_no: str
    bank: str | None
    amount: float
    first_ts: str
    last_ts: str


class FreezeAccount(ApiModel):
    acct_no: str
    bank: str | None
    role: str | None
    account_holding: float | None
    cell_ids: list[int]


class CellSummary(ApiModel):
    found: bool = True
    amount_unit: str
    profile_id: str
    cell_id: int
    network_id: int | None
    l1_account: str
    victim_count: int
    victims: list[CellVictim]
    total_in: float
    holding: float | None
    mules: int
    mules_by_role: dict[str, int]
    freeze_recommended: int
    freeze_holding: float
    freeze_accounts: list[FreezeAccount]
    first_ts: str | None
    last_ts: str | None
    patterns: list[str]
    fingerprint: str | None


class VictimPayment(ApiModel):
    to: str
    tx_key: int
    tx_id: str | None
    ts: str
    amount: float
    via: str


class ReverseVictim(ApiModel):
    acct_no: str
    bank: str | None
    role: str | None
    amount: float
    first_ts: str
    last_ts: str
    l1_accounts: list[str]
    payments: list[VictimPayment]


class CellVictims(ApiModel):
    found: bool = True
    amount_unit: str
    profile_id: str
    cell_id: int
    network_id: int | None
    l1_accounts: list[str]
    victim_count: int
    total_in: float
    payments: int
    first_ts: str | None
    last_ts: str | None
    victims: list[ReverseVictim]


class NetworkItem(ApiModel):
    network_id: int
    cells: int
    size: int | None
    l1_count: int | None
    l2_count: int | None
    l3_count: int | None
    unclassified_count: int | None
    victim_count: int | None
    total_in: float | None
    holding: float | None
    first_ts: datetime | None
    last_ts: datetime | None
    patterns: list[str]
    fingerprint: str | None


class NetworkResponse(ApiModel):
    profile_id: str
    amount_unit: str
    count: int
    networks: list[NetworkItem]
