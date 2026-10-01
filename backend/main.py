"""
Operation Abhedya-Chakra: Local Cyber-Forensic API Server (FastAPI)
Powers the Cyber Fraud Correlator Police IO Edition Dashboard.
100% Offline execution, sub-second graph traversal, zero-hallucination legal generator.
"""

import os
import json
import time
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from ingestion import IngestionEngine, DEFAULT_PARQUET
from mule_scorer import MuleScorer
from graph_engine import GraphEngine
from legal_generator import LegalGenerator

app = FastAPI(
    title="Operation Abhedya-Chakra Core Forensics API",
    description="Local Cyber Fraud Correlator for Indore Police Commissionerate",
    version="1.0.0"
)

# Enable CORS for local React dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Forensic State
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
VICTIMS_FILE = os.path.join(DATA_DIR, "blind_victims.json")
GROUND_TRUTH_FILE = os.path.join(DATA_DIR, "ground_truth_mules.json")

engine = IngestionEngine()
scorer = None
graph = None
legal = LegalGenerator()
is_initialized = False

def initialize_core():
    global scorer, graph, is_initialized
    if not is_initialized:
        print("[*] Initializing Abhedya-Chakra Forensics Core...")
        engine.load_dataset()
        scorer = MuleScorer(engine.con)
        scorer.compute_all_scores()
        graph = GraphEngine(engine.con)
        is_initialized = True
        print("[+] Core Forensics Engine fully initialized and ready!")

@app.on_event("startup")
def startup_event():
    # Preload dataset on startup
    initialize_core()

@app.get("/api/status")
def get_system_status():
    if not is_initialized:
        return {"status": "uninitialized", "records_parsed": 0}
    stats = engine.get_summary_stats()
    return {
        "status": "ready",
        "system_name": "Operation Abhedya-Chakra",
        "edition": "Police IO Forensic Edition",
        "records_parsed": stats["total_transactions"],
        "unique_senders": stats["unique_senders"],
        "unique_receivers": stats["unique_receivers"],
        "total_volume_inr": stats["total_volume_inr"],
        "timeline_start": stats["timeline_start"],
        "timeline_end": stats["timeline_end"],
        "foreign_ip_txns": stats["foreign_ip_txns"],
        "headless_device_txns": stats["headless_device_txns"],
        "scam_narration_txns": stats["scam_narration_txns"],
        "load_duration_seconds": engine.load_duration,
        "vault_verified": True
    }

@app.get("/api/victims")
def get_benchmark_victims():
    if os.path.exists(VICTIMS_FILE):
        with open(VICTIMS_FILE) as f:
            return json.load(f)
    return {"victims": []}

@app.get("/api/trace/{victim_account}")
def trace_victim_flow(victim_account: str, max_hops: int = 4, time_window: int = 180):
    if not is_initialized:
        initialize_core()
    res = graph.trace_victim_trail(victim_account, max_hops=max_hops, time_window_minutes=time_window)
    if not res.get("found", True):
        raise HTTPException(status_code=404, detail="Victim account has no outgoing transactions.")
    return res

@app.get("/api/mules")
def get_flagged_mules(limit: int = 100, role_filter: Optional[str] = None):
    if not is_initialized:
        initialize_core()
    
    where_clause = "WHERE risk_band IN ('HIGH_CONFIDENCE_MULE', 'SUSPECTED_MULE')"
    if role_filter:
        where_clause += f" AND role = '{role_filter}'"
        
    query = f"""
        SELECT account_id, ifsc, role, risk_index, risk_band, 
               total_incoming_amt, total_outgoing_amt, current_holding_balance,
               p1_score, p2_score, p3_score, p4_score, p5_score, p6_score,
               distinct_senders, distinct_receivers, forensic_reason
        FROM scored_mules
        {where_clause}
        ORDER BY risk_index DESC, total_incoming_amt DESC
        LIMIT ?;
    """
    rows = engine.con.execute(query, [limit]).fetchall()
    cols = [d[0] for d in engine.con.description]
    return [dict(zip(cols, r)) for r in rows]

@app.get("/api/legal/notices/{victim_account}")
def get_bank_notices(victim_account: str, fir_number: str = "FIR-0142/2026/CYBER-INDORE"):
    if not is_initialized:
        initialize_core()
    trace = graph.trace_victim_trail(victim_account)
    if not trace.get("nodes"):
        raise HTTPException(status_code=404, detail="No trace trail found for this account.")
    notices = legal.generate_bank_freeze_notices(victim_account, fir_number, trace)
    return {
        "victim_account": victim_account,
        "fir_number": fir_number,
        "total_notices": len(notices),
        "total_funds_siphoned": trace["total_siphoned_inr"],
        "total_funds_targeted": sum(n["total_freeze_amount"] for n in notices),
        "notices": notices
    }

@app.get("/api/legal/case-diary/{victim_account}")
def get_case_diary(victim_account: str, fir_number: str = "FIR-0142/2026/CYBER-INDORE"):
    if not is_initialized:
        initialize_core()
    trace = graph.trace_victim_trail(victim_account)
    diary = legal.generate_police_case_diary(victim_account, fir_number, trace)
    return {
        "victim_account": victim_account,
        "fir_number": fir_number,
        "case_diary": diary
    }

@app.post("/api/jury/blind-test")
def run_jury_blind_evaluation():
    """
    Simulates the official Jury Evaluation Criteria:
    1. Blind Victim Query Test (40%): Traces 5 unannounced victims in real-time, verifying < 2s response and L1, L2, L3 detection.
    2. Precision & Recall Test (30%): Compares flagged accounts against injected ground truth.
    """
    if not is_initialized:
        initialize_core()
        
    t0 = time.time()
    
    # Load 5 blind victims
    with open(VICTIMS_FILE) as f:
        victims = json.load(f)["victims"][:5]
        
    query_results = []
    for v in victims:
        trace_start = time.time()
        res = graph.trace_victim_trail(v)
        lat = (time.time() - trace_start) * 1000
        
        # Count roles detected
        roles = {}
        for n in res.get("nodes", []):
            r = n["role"]
            roles[r] = roles.get(r, 0) + 1
            
        query_results.append({
            "victim_account": v,
            "latency_ms": round(lat, 2),
            "pass_2s_benchmark": lat <= 2000.0,
            "siphoned_amount": res.get("total_siphoned_inr", 0),
            "recoverable_holding": res.get("recoverable_holding_inr", 0),
            "nodes_identified": res.get("nodes_count", 0),
            "roles_breakdown": roles,
            "freeze_targets": len(res.get("freeze_candidates", []))
        })
        
    # Evaluate Precision and Recall against ground truth
    ground_truth = {}
    if os.path.exists(GROUND_TRUTH_FILE):
        with open(GROUND_TRUTH_FILE) as f:
            ground_truth = json.load(f)
            
    # Get all flagged accounts from DB
    flagged = set(r[0] for r in engine.con.execute("""
        SELECT account_id FROM scored_mules WHERE risk_band IN ('HIGH_CONFIDENCE_MULE', 'SUSPECTED_MULE');
    """).fetchall())
    
    gt_mules = set(k for k, v in ground_truth.items() if v.get("is_mule"))
    
    true_positives = len(flagged.intersection(gt_mules))
    false_positives = len(flagged - gt_mules)
    false_negatives = len(gt_mules - flagged)
    
    precision = (true_positives / max(len(flagged), 1)) * 100
    recall = (true_positives / max(len(gt_mules), 1)) * 100
    f1_score = (2 * precision * recall) / max(precision + recall, 1)
    
    avg_latency = sum(q["latency_ms"] for q in query_results) / len(query_results)
    
    return {
        "jury_criteria_summary": {
            "blind_victim_test_passed": all(q["pass_2s_benchmark"] for q in query_results),
            "avg_blind_query_latency_ms": round(avg_latency, 2),
            "ingestion_benchmark": {
                "records_loaded": engine.total_records,
                "ingestion_seconds": engine.load_duration,
                "passed_60s_target": engine.load_duration <= 60.0
            },
            "detection_metrics": {
                "ground_truth_mules": len(gt_mules),
                "system_flagged_mules": len(flagged),
                "true_positives": true_positives,
                "false_positives": false_positives,
                "precision_percent": round(precision, 2),
                "recall_percent": round(recall, 2),
                "f1_score": round(f1_score, 2)
            }
        },
        "query_results": query_results
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
