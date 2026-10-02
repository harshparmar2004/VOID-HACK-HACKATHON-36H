"""The case store (data\\cases.db): cases, events, generated documents, the freeze register."""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from api.schemas import ApiModel

MAX_CASE_VICTIMS = 100            # request size limit, not a scoring value
MAX_FREEZE_ACCOUNTS = 500
MAX_TEXT = 300

NOT_NOTIFIED = ("Recorded in the case register only. No bank has been notified: "
                "a freeze takes effect only when a signed notice reaches the bank.")


class CaseCreate(ApiModel):
    victims: list[str] = Field(min_length=1, max_length=MAX_CASE_VICTIMS)
    officer: str = Field(min_length=1, max_length=MAX_TEXT)
    fir_number: str | None = Field(None, max_length=MAX_TEXT)
    complainant: str | None = Field(None, max_length=MAX_TEXT)


class CaseClose(ApiModel):
    officer: str = Field(min_length=1, max_length=MAX_TEXT)
    note: str | None = Field(None, max_length=MAX_TEXT)


class CaseEvent(ApiModel):
    event_id: int
    case_id: str
    event: str                    # OPENED / NOTICES_GENERATED / DIARY_GENERATED / FIR_GENERATED / CLOSED
    officer: str
    note: str | None
    created_at: str


class CaseOutput(ApiModel):
    output_id: int
    case_id: str
    doc_type: str                 # FREEZE_NOTICE / CASE_DIARY / FIR
    bank: str | None              # bank prefix of a freeze notice
    version: int
    file_name: str
    sha256: str                   # of the stored HTML
    validated: bool
    generator: str                # TEMPLATE (model not asked) / LLM+VALIDATED /
                                  # TEMPLATE_FALLBACK (model asked, answer not used)
    created_at: str
    row_hash: str                 # this row's link in the append-only hash chain


class StoredOutput(CaseOutput):
    stored: bool                  # its page is in the case store: GET /cases/{id}/outputs/{output_id}


class CaseOutputs(ApiModel):
    """Listed only after every stored page was re-hashed against its sha256."""
    case_id: str
    count: int
    outputs: list[StoredOutput]


class FreezeAction(ApiModel):
    action_id: int
    case_id: str
    account: str
    bank: str
    bank_name: str | None
    amount: float                 # rupees of the case's victims' money traced as held there
    action: str                   # REQUESTED / WITHDRAWN
    note: str | None
    officer: str
    created_at: str


class CaseItem(ApiModel):
    case_id: str
    created_at: str
    officer: str
    fir_number: str | None
    complainant: str | None
    victims: list[str]
    dataset_sha256: str
    profile_id: str
    status: str                   # the latest event


class CaseDetail(CaseItem):
    events: list[CaseEvent]
    outputs: list[CaseOutput]
    freeze_actions: list[FreezeAction]


class CasesResponse(ApiModel):
    count: int
    cases: list[CaseItem]


class FreezeRequest(ApiModel):
    case_id: str
    accounts: list[str] = Field(min_length=1, max_length=MAX_FREEZE_ACCOUNTS)
    officer: str | None = Field(None, max_length=MAX_TEXT)      # default: the case's officer
    note: str | None = Field(None, max_length=MAX_TEXT)


class FreezeSkipped(ApiModel):
    account: str
    reason: str


class FreezeResponse(ApiModel):
    case_id: str
    action: str                   # REQUESTED / WITHDRAWN
    recorded: list[FreezeAction]
    skipped: list[FreezeSkipped]
    bank_notified: Literal[False] = False
    message: str = NOT_NOTIFIED


class FrozenAccount(ApiModel):
    """An account whose latest action in its case is REQUESTED."""
    case_id: str
    account: str
    bank: str
    bank_name: str | None
    amount: float
    status: Literal["REQUESTED"] = "REQUESTED"
    bank_notified: Literal[False] = False
    requested_at: str
    officer: str
    note: str | None


class ArtifactsResponse(ApiModel):
    count: int
    dataset_file: str | None
    dataset_sha256: str | None    # ingest_meta: the loaded dataset
    artifacts: list[CaseOutput]


class VerifyResponse(ApiModel):
    ok: bool
    rows: dict[str, int]          # rows per case-store table
    triggers: int                 # append-only triggers present
    triggers_expected: int
    documents: int                # stored documents re-hashed against their sha256
    problems: list[str]
