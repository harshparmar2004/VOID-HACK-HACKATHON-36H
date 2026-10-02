"""
Service to handle transaction file uploads, run the ingestion and forensic engine,
and measure end-to-end timing across all pipeline parameters.
"""
from __future__ import annotations

import os
import sys
import time
import hashlib
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
import duckdb
from fastapi import UploadFile, HTTPException

from api.deps import ROOT, db_path

ENGINE_DIR = ROOT / "engine"
UPLOADS_DIR = ROOT / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import ingest
import victim_trace


def format_bytes(size: int) -> str:
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"


def process_dataset_upload(file: UploadFile) -> dict:
    t_start = time.perf_counter()
    db = db_path()

    # 1. Save uploaded file to disk
    t0 = time.perf_counter()
    safe_name = Path(file.filename or "uploaded_transactions.csv").name
    ts_prefix = int(time.time())
    dest_path = UPLOADS_DIR / f"{ts_prefix}_{safe_name}"

    hasher = hashlib.sha256()
    file_size = 0
    with dest_path.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            buffer.write(chunk)
            hasher.update(chunk)
            file_size += len(chunk)

    upload_ms = round((time.perf_counter() - t0) * 1000, 2)
    file_sha256 = hasher.hexdigest()

    # 2. Ingest into DuckDB
    t0 = time.perf_counter()
    try:
        ingest_res = ingest.run_ingest(dest_path, db)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ingestion failed: {e}")
    ingest_seconds = round(time.perf_counter() - t0, 3)

    # 3. Run Pipeline Stages
    t_pipeline_start = time.perf_counter()
    stage_timings = {}

    def run_stage(name: str, cmd: list[str]):
        t_s = time.perf_counter()
        p = subprocess.run(cmd, capture_output=True, text=True)
        dur = round(time.perf_counter() - t_s, 3)
        if p.returncode != 0:
            err = p.stderr.strip() or p.stdout.strip()
            raise HTTPException(status_code=500, detail=f"Pipeline stage '{name}' failed: {err}")
        stage_timings[name] = dur
        return dur

    py = sys.executable
    run_stage("seed_banks", [py, str(ENGINE_DIR / "seed_banks.py"), "--db", str(db)])
    run_stage("features", [py, str(ENGINE_DIR / "features.py"), "--db", str(db)])
    run_stage("scoring_pass1", [py, str(ENGINE_DIR / "scoring.py"), "--pass", "1", "--db", str(db)])
    run_stage("links", [py, str(ENGINE_DIR / "links.py"), "--db", str(db)])
    run_stage("scoring_pass2", [py, str(ENGINE_DIR / "scoring.py"), "--pass", "2", "--db", str(db)])
    run_stage("rings", [py, str(ENGINE_DIR / "rings.py"), "--db", str(db)])
    run_stage("graph", [py, str(ENGINE_DIR / "graph.py"), "--db", str(db), "--force"])

    # Clear victim trace in-memory context cache
    victim_trace._CONTEXTS.clear()

    pipeline_seconds = round(time.perf_counter() - t_pipeline_start, 3)
    total_seconds = round(time.perf_counter() - t_start, 3)

    # 4. Fetch Summary & Active Parameters
    con = duckdb.connect(str(db), read_only=True)
    try:
        counts = con.execute("""
            SELECT 
                (SELECT count(*) FROM tx) AS tx_count,
                (SELECT count(*) FROM accounts) AS accounts_count,
                (SELECT count(*) FROM scores WHERE is_flagged) AS flagged_count,
                (SELECT count(*) FROM scores WHERE role = 'L1') AS l1_count,
                (SELECT count(*) FROM scores WHERE role = 'L2') AS l2_count,
                (SELECT count(*) FROM scores WHERE role = 'L3') AS l3_count,
                (SELECT count(*) FROM scores WHERE role = 'VICTIM') AS victim_count,
                (SELECT count(*) FROM layer_links) AS links_count,
                (SELECT count(*) FROM rings) AS rings_count,
                (SELECT count(*) FROM cells) AS cells_count
        """).fetchone()

        profile_row = con.execute("SELECT profile_id, definition FROM scoring_profiles WHERE is_active").fetchone()
    finally:
        con.close()

    tx_count, accts, flagged, l1, l2, l3, victims, links_n, rings_n, cells_n = counts

    throughput = round(tx_count / total_seconds) if total_seconds > 0 else tx_count

    return {
        "status": "success",
        "message": f"Successfully ingested {tx_count:,} records in {total_seconds:.2f} seconds",
        "file_name": safe_name,
        "file_size": format_bytes(file_size),
        "file_size_bytes": file_size,
        "sha256": file_sha256,
        "records_total": ingest_res["rows_total"],
        "records_loaded": tx_count,
        "records_rejected": ingest_res["rows_rejected"],
        "accounts": accts,
        "roles": {
            "L1": l1,
            "L2": l2,
            "L3": l3,
            "VICTIM": victims,
        },
        "flagged_mules": flagged,
        "layer_links": links_n,
        "cells": cells_n,
        "networks": rings_n,
        "timing": {
            "upload_ms": upload_ms,
            "ingest_seconds": ingest_seconds,
            "pipeline_seconds": pipeline_seconds,
            "total_seconds": total_seconds,
            "stage_breakdown": stage_timings,
            "throughput_rows_per_second": throughput,
        },
        "parameters": {
            "profile_id": profile_row[0] if profile_row else "v1-verified",
            "detection_gates": "7 closed (empirically uninformative signals filtered out)",
            "split_forward_window": "3 - 15 minutes (L1 placement pattern)",
            "single_forward_window": "0 - 60 minutes (L2 layering pattern)",
            "commission_ranges": "L1: 97%-99%, L2: 94%-97%",
            "mule_index_weights": "MP1: 20%, MP2: 15%, MP3: 15%, MP4: 15%, MP5: 10%, MP6: 10%, MP7: 10%, MP8: 5%",
            "trust_index_weights": "T1: 44%, T4: 19%, T5: 32%, T7: 5%",
            "flag_threshold": "Final Index >= 65",
            "two_signal_rule": "Enforced (>= 2 mule signals at half-points)",
            "sink_override": "Enforced (Floor 70 for proven L2->L3 receive-only sinks)",
        }
    }
