"""Step 8 documents: freeze notices, case diary, FIR draft. Every page is a draft."""
from __future__ import annotations

from pydantic import Field

from api.schemas import ApiModel
from api.schemas.cases import MAX_TEXT

MAX_OFFENCE_SUMMARY = 4000


class LegalDocument(ApiModel):
    case_id: str
    victim: str
    doc_type: str                 # FREEZE_NOTICE / CASE_DIARY / FIR
    bank: str | None
    bank_name: str | None
    output_id: int                # its case_outputs row (GET /vault/artifacts)
    version: int
    file_name: str
    sha256: str                   # of `html`, as stored
    validated: bool
    generator: str
    generated_at: str
    fingerprint: str              # trace fingerprint
    dataset_sha256: str
    profile_id: str
    html: str                     # printable A4 page; the browser's Save as PDF makes the PDF


class NoticesResponse(ApiModel):
    case_id: str
    victim: str
    count: int
    message: str | None           # set when the trace has no account to freeze
    notices: list[LegalDocument]  # one per bank


class LlmStatus(ApiModel):
    status: str                   # validated / unreachable (...) / timed out ... / rejected by validation
    seconds: float
    problems: list[str]


class DiaryEntry(ApiModel):
    ts: str
    text: str


class DiarySummary(ApiModel):
    case_id: str
    victim: str
    generator: str                # LLM+VALIDATED, or TEMPLATE_FALLBACK: asked, answer not used
    llm: LlmStatus
    summary: str | None           # AI text; null unless it passed validation
    entries: list[DiaryEntry]
    document: LegalDocument | None    # the diary with the AI narrative, stored as the next version


class FirComplainant(ApiModel):
    name: str = Field(min_length=1, max_length=MAX_TEXT)
    address: str | None = Field(None, max_length=MAX_TEXT)
    phone: str | None = Field(None, max_length=MAX_TEXT)
    email: str | None = Field(None, max_length=MAX_TEXT)


class FirRequest(ApiModel):
    case_id: str
    victim: str
    complainant: FirComplainant
    offence_summary: str = Field(min_length=1, max_length=MAX_OFFENCE_SUMMARY)
    sections_of_law: str | None = Field(None, max_length=MAX_TEXT)
    police_station: str | None = Field(None, max_length=MAX_TEXT)
    officer: str | None = Field(None, max_length=MAX_TEXT)      # default: the case's officer
