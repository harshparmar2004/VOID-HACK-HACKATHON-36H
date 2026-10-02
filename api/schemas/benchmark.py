from __future__ import annotations

from datetime import datetime

from pydantic import Field

from api.schemas import ApiModel
from api.schemas.scanner import ScannerSummary

MAX_JURY_VICTIMS = 1000           # request size limit, not an engine rule
DEFAULT_JURY_VICTIMS = 20


class IngestionTiming(ApiModel):
    load_id: int
    rows_loaded: int
    load_seconds: float           # as recorded by the ingest run; not re-measured
    rows_per_second: float | None  # rows_loaded / load_seconds
    loaded_at: datetime | None


class GraphTiming(ApiModel):
    build_seconds: float          # as recorded in the graph manifest; not re-measured
    built_at: datetime | None
    rows: int
    accounts: int
    current: bool                 # built from the latest ingest


class TraceSample(ApiModel):
    traces: int                   # measured live, in this request
    total_ms: float
    median_ms: float
    min_ms: float
    max_ms: float
    accounts_median: float        # accounts reached per trace


class BenchmarkResponse(ScannerSummary):
    """The scanner summary plus measured timings. The summary's benchmark fields
    (elapsed_seconds, speedup_factor, ...) stay null: no speed-up is claimed."""
    ingestion: IngestionTiming
    graph: GraphTiming | None     # null when the graph arrays are not built
    trace_sample: TraceSample


class JuryRequest(ApiModel):
    n: int = Field(DEFAULT_JURY_VICTIMS, ge=1, le=MAX_JURY_VICTIMS)
    seed: int | None = None       # same seed -> same victims


class JuryResult(ApiModel):
    victim_account: str
    correct: bool                 # trace = structural chain (accounts and transfers)
    latency_ms: float
    nodes_identified: int         # accounts the trace found
    accounts_expected: int        # accounts on the structural chain
    transfers_found: int
    transfers_expected: int
    accounts_only_in_trace: int
    accounts_only_in_chain: int
    siphoned_amount: float        # rupees the victim paid
    roles_breakdown: dict[str, int]
    freeze_targets: int


class JurySummary(ApiModel):
    victims_traced: int
    correct: int
    incorrect: int
    avg_blind_query_latency_ms: float
    median_latency_ms: float
    max_latency_ms: float
    chain_build_ms: float         # the SQL chain the traces are checked against
    detection_metrics: None = None  # precision / recall need ground truth: not used


class JuryResponse(ApiModel):
    status: str
    profile_id: str
    method: str
    n_requested: int
    seed: int | None
    jury_criteria_summary: JurySummary
    query_results: list[JuryResult]
