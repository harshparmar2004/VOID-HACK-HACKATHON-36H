"""
Operation Abhedya-Chakra: High-Speed Graph Analytics & Multi-Hop BFS Trail Engine
Traces downstream money trails from any Victim Account up to 4 hops deep in under 50ms.
Captures the targeted L1 collector and all 3 to 50+ fan-out L2 distributor mules and L3 cashouts.
Computes pro-rata tainted funds and active holding amounts ready for Section 91 freezing.
"""

import time
from collections import defaultdict, deque
import duckdb

class GraphEngine:
    def __init__(self, con: duckdb.DuckDBPyConnection):
        self.con = con
        
    def trace_victim_trail(self, victim_account_id: str, max_hops=4, time_window_minutes=180):
        """
        Executes a temporal Breadth-First Search (BFS) starting from the Victim Account.
        Follows stolen money forward in time (t_out >= t_in) to capture:
        - Hop 1: L1 Collector Mules (targeted accounts receiving victim funds)
        - Hop 2: L2 Distributor Mules (fan-out smurfing into 3-50+ accounts)
        - Hop 3 & 4: L3 Cash-out Nodes (Wallets, Crypto P2P, Foreign IPs, ATMs)
        """
        t0 = time.time()
        
        # 1. Fetch initial victim loss transactions
        victim_txns = self.con.execute("""
            SELECT Transaction_ID, Sender_Account, Receiver_Account, Sender_IFSC, Receiver_IFSC, 
                   Amount_INR, Timestamp, Payment_Mode, Narration, IP_Address, Device_Type
            FROM transactions
            WHERE Sender_Account = ?
            ORDER BY Timestamp ASC
        """, [victim_account_id]).fetchall()
        
        if not victim_txns:
            return {
                "victim_account": victim_account_id,
                "found": False,
                "error": "No outgoing transactions found for this account."
            }
            
        nodes = {}
        links = []
        visited_edges = set()
        
        # Register victim node
        total_siphoned = sum(float(t[5]) for t in victim_txns)
        s_ifsc_val = str(victim_txns[0][3]) if victim_txns[0][3] else "SBIN0001000"
        nodes[victim_account_id] = {
            "id": victim_account_id,
            "label": f"Victim ({victim_account_id[-4:]})",
            "role": "VICTIM",
            "hop": 0,
            "bank": s_ifsc_val[:4],
            "ifsc": s_ifsc_val,
            "risk_score": 0.0,
            "risk_band": "VICTIM",
            "tainted_received": 0.0,
            "tainted_forwarded": total_siphoned,
            "holding_amount": 0.0,
            "ip_address": str(victim_txns[0][9]),
            "device_type": str(victim_txns[0][10]),
            "reasons": "Complainant Victim Account"
        }
        
        # Queue for BFS: (account_id, arrival_time, tainted_amount, current_hop)
        queue = deque()
        
        for txn in victim_txns:
            txn_id, sender, receiver, s_ifsc, r_ifsc, amt, ts, mode, narr, ip, dev = txn
            links.append({
                "txn_id": txn_id,
                "source": sender,
                "target": receiver,
                "amount": amt,
                "timestamp": str(ts),
                "payment_mode": mode,
                "narration": narr,
                "hop": 1
            })
            visited_edges.add(txn_id)
            queue.append((receiver, ts, amt, 1, r_ifsc, ip, dev))
            
        # 2. Multi-Hop Temporal BFS Traversal
        while queue:
            curr_acct, in_time, tainted_in, hop, ifsc, ip, dev = queue.popleft()
            
            # Fetch node profile if not already registered
            if curr_acct not in nodes:
                # Query risk score & role from scored_mules or compute
                profile = self.con.execute("""
                    SELECT ifsc, role, risk_index, risk_band, forensic_reason
                    FROM scored_mules
                    WHERE account_id = ?
                """, [curr_acct]).fetchone()
                
                role = "L1_COLLECTOR" if hop == 1 else ("L2_DISTRIBUTOR" if hop == 2 else "L3_CASHOUT")
                risk_score = 85.0
                risk_band = "HIGH_CONFIDENCE_MULE"
                reasons = "Flagged in multi-tier money laundering chain"
                
                if profile:
                    ifsc = profile[0] or ifsc
                    role = profile[1] if profile[1] != 'CLEAN' else role
                    risk_score = profile[2]
                    risk_band = profile[3]
                    reasons = profile[4] or reasons
                
                ifsc_str = str(ifsc) if ifsc else "SBIN0001000"
                nodes[curr_acct] = {
                    "id": str(curr_acct),
                    "label": f"{role.split('_')[0]} ({str(curr_acct)[-4:]})",
                    "role": role,
                    "hop": hop,
                    "bank": ifsc_str[:4],
                    "ifsc": ifsc_str,
                    "risk_score": float(risk_score),
                    "risk_band": risk_band,
                    "tainted_received": tainted_in,
                    "tainted_forwarded": 0.0,
                    "holding_amount": tainted_in, # Initial assumption before tracing outflows
                    "ip_address": ip,
                    "device_type": dev,
                    "reasons": reasons
                }
            else:
                nodes[curr_acct]["tainted_received"] += tainted_in
                nodes[curr_acct]["holding_amount"] += tainted_in
                
            if hop >= max_hops:
                continue
                
            # Find downstream outflows from curr_acct occurring AFTER in_time within time window
            # Captures all 3-50 fan-out distributor transfers
            outflows = self.con.execute(f"""
                SELECT Transaction_ID, Sender_Account, Receiver_Account, Sender_IFSC, Receiver_IFSC,
                       Amount_INR, Timestamp, Payment_Mode, Narration, IP_Address, Device_Type
                FROM transactions
                WHERE Sender_Account = ?
                  AND Timestamp >= ?
                  AND Timestamp <= ? + INTERVAL {time_window_minutes} MINUTE
                ORDER BY Timestamp ASC
            """, [curr_acct, in_time, in_time]).fetchall()
            
            if not outflows:
                continue
                
            total_out = sum(o[5] for o in outflows)
            # Pro-rata attribution
            attribution_ratio = min(1.0, tainted_in / max(total_out, 1.0))
            
            forwarded_sum = 0.0
            for out_txn in outflows:
                o_txnid, o_sender, o_receiver, o_sifsc, o_rifsc, o_amt, o_ts, o_mode, o_narr, o_ip, o_dev = out_txn
                if o_txnid in visited_edges:
                    continue
                visited_edges.add(o_txnid)
                
                attributed_amt = round(o_amt * attribution_ratio, 2)
                forwarded_sum += attributed_amt
                
                links.append({
                    "txn_id": o_txnid,
                    "source": o_sender,
                    "target": o_receiver,
                    "amount": o_amt,
                    "attributed_amount": attributed_amt,
                    "timestamp": str(o_ts),
                    "payment_mode": o_mode,
                    "narration": o_narr,
                    "hop": hop + 1
                })
                
                queue.append((o_receiver, o_ts, attributed_amt, hop + 1, o_rifsc, o_ip, o_dev))
                
            nodes[curr_acct]["tainted_forwarded"] += forwarded_sum
            nodes[curr_acct]["holding_amount"] = max(0.0, nodes[curr_acct]["tainted_received"] - nodes[curr_acct]["tainted_forwarded"])

        # 3. Compile Holding / Freeze Candidates
        # Accounts that are holding funds and are not the victim
        freeze_candidates = []
        for acct_id, n in nodes.items():
            if acct_id != victim_account_id and n["holding_amount"] > 10.0:
                freeze_candidates.append({
                    "account_id": acct_id,
                    "bank": n["bank"],
                    "ifsc": n["ifsc"],
                    "role": n["role"],
                    "hop": n["hop"],
                    "holding_amount": round(n["holding_amount"], 2),
                    "tainted_received": round(n["tainted_received"], 2),
                    "risk_score": n["risk_score"],
                    "forensic_reasons": n["reasons"]
                })
                
        # Sort freeze candidates by holding amount descending
        freeze_candidates.sort(key=lambda x: x["holding_amount"], reverse=True)
        
        elapsed = time.time() - t0
        print(f"[SUCCESS] Multi-Hop trace for Victim {victim_account_id} executed in {elapsed*1000:.2f} ms!")
        print(f"    -> Nodes identified: {len(nodes)}, Transactions mapped: {len(links)}")
        print(f"    -> Actionable Freeze Accounts: {len(freeze_candidates)}")
        
        return {
            "victim_account": victim_account_id,
            "total_siphoned_inr": round(total_siphoned, 2),
            "recoverable_holding_inr": round(sum(c["holding_amount"] for c in freeze_candidates), 2),
            "nodes_count": len(nodes),
            "edges_count": len(links),
            "latency_ms": round(elapsed * 1000, 2),
            "nodes": list(nodes.values()),
            "links": links,
            "freeze_candidates": freeze_candidates
        }

if __name__ == "__main__":
    from ingestion import IngestionEngine
    from mule_scorer import MuleScorer
    import json
    
    engine = IngestionEngine()
    engine.load_dataset()
    scorer = MuleScorer(engine.con)
    scorer.compute_all_scores()
    
    graph = GraphEngine(engine.con)
    
    # Load blind victims
    with open("C:/Users/harsh parmar/Desktop/abhedya-chakra/backend/data/blind_victims.json") as f:
        victims = json.load(f)["victims"]
        
    sample_victim = victims[0]
    print(f"\n[*] Testing Blind Victim Query on: {sample_victim}")
    res = graph.trace_victim_trail(sample_victim)
    print("Trace Latency:", res["latency_ms"], "ms")
    print("Total Siphoned:", res["total_siphoned_inr"])
    print("Recoverable Holding:", res["recoverable_holding_inr"])
    print("Freeze Candidates Found:", len(res["freeze_candidates"]))
