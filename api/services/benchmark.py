"""Measured numbers only: stored build times and live trace timings. No trace logic here."""
from __future__ import annotations

import random
import statistics
import time

from fastapi import HTTPException

from api.deps import Profile, db_path
from api.repositories import benchmark as repo
from api.repositories import status as status_repo
from api.schemas.benchmark import (
    BenchmarkResponse, GraphTiming, IngestionTiming, JuryResponse, JuryResult, JurySummary,
    TraceSample)
from api.services import rupees
from api.services import scanner as scanner_service
from api.services.trace import _LOCK, engine

import graph  # noqa: E402  (engine\graph.py; api.services.trace put engine\ on sys.path)

TRACE_SAMPLE = 20                 # traces timed by the benchmark (sample size, not an engine rule)
MS = 1000.0
METHOD = ("Each victim is traced by the engine and compared with a chain built from the "
          "transactions alone (who paid whom, inside the profile's forwarding windows). "
          "correct = same accounts and same transfers. No ground truth is used.")


def _sample(con, profile_id: str, n: int, seed: int | None) -> list[tuple[int, str]]:
    pool = repo.victims(con, profile_id)
    if not pool:
        raise HTTPException(503, "no VICTIM accounts for the active profile")
    return random.Random(seed).sample(pool, min(n, len(pool)))


def _timed_traces(acct_nos: list[str]) -> list[tuple[dict, float]]:
    """(engine result, seconds) per victim; the context is loaded before timing starts."""
    db = db_path()
    out = []
    with _LOCK:
        try:
            engine.get_context(db)
            for v in acct_nos:
                t0 = time.perf_counter()
                r = engine.trace_victim(v, db)
                out.append((r, time.perf_counter() - t0))
        except SystemExit as e:      # the engine's "not built yet" messages
            raise HTTPException(503, f"trace engine is not available: {e}") from e
    return out


def run_benchmark(con, profile: Profile) -> BenchmarkResponse:
    ing = status_repo.latest_ingest(con)
    if ing is None:
        raise HTTPException(503, "ingest_meta is empty")
    manifest = graph.read_manifest(graph.graph_dir(db_path()))
    traced = _timed_traces([no for _, no in _sample(con, profile.profile_id, TRACE_SAMPLE, None)])
    ms = [s * MS for _, s in traced]
    seconds = ing["load_seconds"]
    return BenchmarkResponse(
        **scanner_service.summary(con, profile.profile_id).model_dump(),
        ingestion=IngestionTiming(
            load_id=ing["load_id"], rows_loaded=ing["rows_loaded"], load_seconds=seconds,
            rows_per_second=round(ing["rows_loaded"] / seconds, 1) if seconds else None,
            loaded_at=ing["loaded_at"]),
        graph=None if manifest is None else GraphTiming(
            build_seconds=manifest["build_seconds"], built_at=manifest.get("built_at"),
            rows=manifest["rows"], accounts=manifest["accounts"],
            current=manifest.get("load_id") == ing["load_id"]),
        trace_sample=TraceSample(
            traces=len(ms), total_ms=round(sum(ms), 3), median_ms=round(statistics.median(ms), 3),
            min_ms=round(min(ms), 3), max_ms=round(max(ms), 3),
            accounts_median=statistics.median(
                len(r.get("accounts", [])) for r, _ in traced)))


def blind_test(con, profile: Profile, n: int, seed: int | None) -> JuryResponse:
    picked = _sample(con, profile.profile_id, n, seed)
    t0 = time.perf_counter()
    rows = repo.chain(con, profile.definition, [acct_id for acct_id, _ in picked])
    chain_ms = (time.perf_counter() - t0) * MS
    want_accts: dict[str, set] = {no: set() for _, no in picked}
    want_tx: dict[str, set] = {no: set() for _, no in picked}
    for victim, acct, tx_key in rows:
        want_accts[victim].add(acct)
        want_tx[victim].add(tx_key)

    results = []
    for (_, victim), (r, seconds) in zip(picked, _timed_traces([no for _, no in picked])):
        found = bool(r.get("found"))
        accounts = r.get("accounts", []) if found else []
        got_accts = {a["acct_no"] for a in accounts}
        got_tx = {t["tx_key"] for t in r.get("transfers", [])} if found else set()
        results.append(JuryResult(
            victim_account=victim,
            correct=found and got_accts == want_accts[victim] and got_tx == want_tx[victim],
            latency_ms=round(seconds * MS, 3),
            nodes_identified=len(got_accts), accounts_expected=len(want_accts[victim]),
            transfers_found=len(got_tx), transfers_expected=len(want_tx[victim]),
            accounts_only_in_trace=len(got_accts - want_accts[victim]),
            accounts_only_in_chain=len(want_accts[victim] - got_accts),
            siphoned_amount=rupees(r["summary"]["tainted_total"]) if found else 0.0,
            roles_breakdown=r["summary"]["accounts_by_role"] if found else {},
            freeze_targets=len(r["freeze_candidates"]) if found else 0))
    ms = [x.latency_ms for x in results]
    correct = sum(x.correct for x in results)
    return JuryResponse(
        status="success", profile_id=profile.profile_id, method=METHOD, n_requested=n, seed=seed,
        jury_criteria_summary=JurySummary(
            victims_traced=len(results), correct=correct, incorrect=len(results) - correct,
            avg_blind_query_latency_ms=round(statistics.fmean(ms), 3),
            median_latency_ms=round(statistics.median(ms), 3), max_latency_ms=max(ms),
            chain_build_ms=round(chain_ms, 1)),
        query_results=results)
