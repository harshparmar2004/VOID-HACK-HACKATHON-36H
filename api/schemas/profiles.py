"""Responses of /profiles. The preview writes nothing."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from api.schemas import ApiModel

MAX_PREVIEW_ACCOUNTS = 2000       # request size limit, not an engine rule


class GateInfo(ApiModel):
    id: str
    status: str | None
    gates: list[str]
    description: str | None
    measured: float | None
    reason: str | None


class ParameterInfo(ApiModel):
    id: str
    name: str
    index: str | None             # mule / trust
    weight: float
    enabled: bool
    scored: bool                  # enabled and weight above zero
    gate: str | None
    gate_status: str | None       # open / closed; null = the parameter has no gate
    scoring_pass: int             # 2 = needs neighbour risk
    features: list[str]
    thresholds: dict[str, Any]    # the parameter's rule, as stored
    description: str              # one line
    disabled_reason: str | None


class NeverScored(ApiModel):
    id: str
    name: str
    reason: str | None


class TwoSignalRule(ApiModel):
    enabled: bool
    always_on: bool | None
    min_parameters_at_half: int
    over: list[str]


class FinalInfo(ApiModel):
    formula: str | None
    trust_discount_factor: float
    flag_threshold: float
    two_signal_rule: TwoSignalRule
    override_floor: float | None
    bands: list[dict[str, Any]]


class ProfileResponse(ApiModel):
    profile_id: str
    is_active: bool
    is_locked: bool
    created_at: datetime | None
    version: Any | None
    description: str | None
    mule_total_weight: float
    trust_total_weight: float
    min_tx_for_trust: float | None
    parameters: list[ParameterInfo]
    never_score: list[NeverScored]
    gates: list[GateInfo]
    final: FinalInfo
    windows: dict[str, Any]
    definition: dict[str, Any]    # the stored profile, unchanged


class ParameterChange(ApiModel):
    weight: float | None = None
    enabled: bool | None = None


class ProfileChanges(ApiModel):
    """Only these values can be previewed: they are read at scoring time.
    Windows and feature rules are measured into `features` and are not."""
    parameters: dict[str, ParameterChange] = Field(default_factory=dict)
    flag_threshold: float | None = Field(None, ge=0, le=100)
    trust_discount_factor: float | None = Field(None, ge=0, le=1)
    min_parameters_at_half: int | None = None
    two_signal_rule_enabled: bool | None = None


class PreviewRequest(ApiModel):
    changes: ProfileChanges = Field(default_factory=ProfileChanges)
    account_limit: int = Field(200, ge=0, le=MAX_PREVIEW_ACCOUNTS)


class PreviewAccount(ApiModel):
    account: str
    bank: str | None
    role_before: str | None
    role_after: str | None
    final_index_before: float | None
    final_index_after: float | None
    flagged_before: bool | None
    flagged_after: bool | None


class AccountList(ApiModel):
    count: int
    truncated: bool               # accounts holds fewer than count
    accounts: list[PreviewAccount]


class RoleTransition(ApiModel):
    role_before: str
    role_after: str
    count: int


class RoleChanges(AccountList):
    transitions: list[RoleTransition]


class BeforeAfter(ApiModel):
    before: dict[str, int]
    after: dict[str, int]


class CountChange(ApiModel):
    before: int
    after: int


class PreviewResponse(ApiModel):
    profile_id: str               # the active profile the copy was made from
    written: bool = False         # always false: nothing is saved
    changes: ProfileChanges
    warnings: list[str]
    seconds: float
    accounts: int
    flagged_count: int
    flagged: CountChange
    flags_gained: AccountList
    flags_lost: AccountList
    role_changes: RoleChanges
    band_counts: BeforeAfter
    role_counts: BeforeAfter
    freeze_recommended: CountChange
    layer_links: CountChange
    final_index_changed: int      # accounts whose final_index moved
    max_final_index_change: float | None
