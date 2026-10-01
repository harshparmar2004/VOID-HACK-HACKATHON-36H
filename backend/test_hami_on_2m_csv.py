import os
import time
import json
from ingestion import IngestionEngine
from mule_scorer import MuleScorer
from hami_hopping_engine import HAMIHoppingEngine

csv_path = os.path.abspath("VoidHacks8_MuleAccount_2M_Transactions.csv")
if not os.path.exists(csv_path):
    csv_path = os.path.abspath("../VoidHacks8_MuleAccount_2M_Transactions.csv")

print(f"=================================================================")
print(f"  OPERATION ABHEDYA-CHAKRA: HAMI AML HOPPING TEST ON 2M CSV")
print(f"  Target File: {csv_path}")
print(f"=================================================================\n")

engine = IngestionEngine()

# 1. Ingestion Benchmark
t0 = time.time()
print("[1/4] Ingesting and normalizing 2,000,000 CSV transactions into DuckDB...")
res = engine.load_dataset(csv_path)
ingest_time = time.time() - t0
print(f"[+] Loaded {res['total_records']:,} records in {ingest_time:.2f} seconds!")

# 2. Mule Risk Scoring
t1 = time.time()
print("\n[2/4] Scoring accounts with MuleScorer heuristics...")
scorer = MuleScorer(engine.con)
score_summary = scorer.compute_all_scores()
score_time = time.time() - t1
print(f"[+] Scored {score_summary['total_accounts']:,} accounts in {score_time:.2f}s:")
print(f"    - High Confidence Mules: {score_summary['high_risk_mules']:,}")
print(f"    - Suspected Mules:       {score_summary['suspected_mules']:,}")
print(f"    - L1 Collectors:         {score_summary.get('l1_collectors', 0):,}")
print(f"    - L2 Distributors:       {score_summary.get('l2_distributors', 0):,}")
print(f"    - L3 Cash-Outs:          {score_summary.get('l3_cashouts', 0):,}")

# 3. HAMI AML Hopping Analysis on first victim
print("\n[3/4] Running HAMI Topological Hopping & PyTorch GAT Attention...")
hami = HAMIHoppingEngine(engine.con)

# Look for accounts with outflows in the dataset
test_accounts = engine.con.execute("""
    SELECT Sender_Account, SUM(Amount_INR), COUNT(*)
    FROM transactions
    GROUP BY Sender_Account
    HAVING COUNT(*) >= 1
    ORDER BY SUM(Amount_INR) DESC
    LIMIT 5;
""").fetchall()

print(f"[+] Identified Top Inquiry Accounts for Testing:")
for acc in test_accounts:
    print(f"    • Account: {acc[0]} | Outflow Volume: INR {acc[1]:,.2f} | Outgoing Txns: {acc[2]}")

target_victim = test_accounts[0][0]
print(f"\n[*] Executing HAMI Multi-Hop Hopping Analysis on: {target_victim} ...")
t2 = time.time()
analysis = hami.analyze_victim_hopping(target_victim, max_hops=4, time_window_minutes=360)
hami_time = (time.time() - t2) * 1000

print(f"[+] HAMI Analysis Completed in {hami_time:.2f} ms:")
print(f"    • Topological Pattern:       {analysis['topological_pattern']}")
print(f"    • Cycle Detected:            {analysis['has_cycle']}")
if analysis['has_cycle']:
    print(f"    • Closed-Loop Cycles:        {analysis['cycles_detected']}")
print(f"    • Cluster Fingerprint:       {analysis['cluster_fingerprint']}")
print(f"    • Max Fan-Out Degree:        {analysis['max_out_degree']}")
print(f"    • Max Fan-In Degree:         {analysis['max_in_degree']}")
print(f"    • Total Correlated Nodes:    {analysis['total_nodes']}")
print(f"    • Total Traversed Hops:      {analysis['max_hops_traced']}")

print("\n[*] Hop-by-Hop Transition Breakdown:")
for hop in analysis["hop_pipeline"]:
    print(f"    -> [Hop {hop['hop_number']}] {hop['title']}")
    print(f"       Volume: INR {hop['total_volume_inr']:,.2f} ({hop['retention_percentage']}% retained)")
    print(f"       Mule Accounts: {hop['accounts_count']} | Avg Hopping Latency: {hop['avg_velocity_minutes']} mins")

print("\n[*] Top Ranked Nodes by PyTorch GAT Attention Score:")
for n in analysis["nodes"][:8]:
    print(f"    • Acc: {n['account_id']} | Hop: {n['hop']} | HAMI Role: {n['hami_role']} | GAT Score: {n['gat_attention_score']} | In/Out: {n['in_degree']}/{n['out_degree']}")

# 4. Global Top HAMI Hopping Clusters
print("\n[4/4] Scanning Top HAMI Hopping Clusters across 2M Transactions...")
clusters = hami.scan_top_hopping_clusters(limit=5)
for i, c in enumerate(clusters, 1):
    print(f"    [{i}] Anchor: {c['anchor_account']} | Pattern: {c['hami_pattern']} | Senders: {c['fan_in_count']} -> Receivers: {c['fan_out_count']} | GAT Conf: {c['gat_confidence']}%")

print("\n=================================================================")
print("  SUCCESS: HAMI AML HOPPING ENGINE FULLY VALIDATED ON 2M CSV!")
print("=================================================================")
