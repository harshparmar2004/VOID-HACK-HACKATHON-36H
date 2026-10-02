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
        
    def trace_victim_trail(
        self, 
        victim_account_id: str, 
        max_hops=4, 
        time_window_minutes=180,
        min_amount=0.0,
        bank_filter=None,
        keyword=None,
        custom_rules=None
    ):
        """
        Executes a temporal Breadth-First Search (BFS) starting from the Victim Account.
        Follows stolen money forward in time (t_out >= t_in) with customizable investigation filters:
        - min_amount: Minimum transaction volume threshold (e.g. ₹50k, ₹1Lakh, ₹2-3 Cr Whales)
        - bank_filter: Target specific bank IFSC prefixes (e.g. PYTM, IPOS, AXIS, SBIN)
        - keyword: Suspicious narration tags (e.g. CRYPTO, P2P, TASK, DIGITAL ARREST)
        - max_hops: Custom depth (1-5 hops)
        - time_window_minutes: Velocity window for rapid dispersion
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
            txn_id = txn[0]
            sender = txn[1]
            receiver = txn[2]
            s_ifsc = txn[3]
            r_ifsc = txn[4]
            amt = txn[5]
            ts = txn[6]
            mode = txn[7]
            narr = txn[8]
            ip = txn[9] if len(txn) > 9 else "103.118.12.1"
            dev = txn[10] if len(txn) > 10 else "Android"
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
            # Apply user-specified forensic parameter filters (min_amount, bank_filter, keyword)
            outflow_sql = f"""
                SELECT Transaction_ID, Sender_Account, Receiver_Account, Sender_IFSC, Receiver_IFSC,
                       Amount_INR, Timestamp, Payment_Mode, Narration, IP_Address, Device_Type
                FROM transactions
                WHERE Sender_Account = ?
                  AND Timestamp >= ?
                  AND Timestamp <= ? + INTERVAL {time_window_minutes} MINUTE
            """
            outflow_params = [curr_acct, in_time, in_time]
            
            if min_amount and float(min_amount) > 0:
                outflow_sql += " AND Amount_INR >= ?"
                outflow_params.append(float(min_amount))
                
            if bank_filter and bank_filter != "ALL":
                outflow_sql += " AND Receiver_IFSC LIKE ?"
                outflow_params.append(f"{bank_filter}%")
                
            if keyword and str(keyword).strip():
                outflow_sql += " AND LOWER(Narration) LIKE ?"
                outflow_params.append(f"%{str(keyword).strip().lower()}%")
                
            if custom_rules and isinstance(custom_rules, list):
                for rule in custom_rules:
                    if not isinstance(rule, dict) or not rule.get("enabled", True):
                        continue
                    field = rule.get("field", "")
                    op = rule.get("operator", "eq")
                    val = rule.get("value", "")
                    if val is None or str(val).strip() == "":
                        continue
                        
                    if field == "Amount_INR":
                        try:
                            num_val = float(val)
                            if op in [">", "gt"]:
                                outflow_sql += " AND Amount_INR > ?"
                                outflow_params.append(num_val)
                            elif op in [">=", "gte"]:
                                outflow_sql += " AND Amount_INR >= ?"
                                outflow_params.append(num_val)
                            elif op in ["<", "lt"]:
                                outflow_sql += " AND Amount_INR < ?"
                                outflow_params.append(num_val)
                            elif op in ["<=", "lte"]:
                                outflow_sql += " AND Amount_INR <= ?"
                                outflow_params.append(num_val)
                            elif op in ["==", "eq"]:
                                outflow_sql += " AND Amount_INR = ?"
                                outflow_params.append(num_val)
                        except (ValueError, TypeError):
                            pass
                    elif field in ["Receiver_IFSC", "Sender_IFSC"]:
                        if op == "starts_with":
                            outflow_sql += f" AND {field} LIKE ?"
                            outflow_params.append(f"{val}%")
                        elif op == "contains":
                            outflow_sql += f" AND {field} LIKE ?"
                            outflow_params.append(f"%{val}%")
                        else:
                            outflow_sql += f" AND {field} = ?"
                            outflow_params.append(str(val))
                    elif field == "Narration":
                        if op in ["contains", "regex"]:
                            outflow_sql += " AND LOWER(Narration) LIKE ?"
                            outflow_params.append(f"%{str(val).lower()}%")
                        else:
                            outflow_sql += " AND LOWER(Narration) = ?"
                            outflow_params.append(str(val).lower())
                    elif field == "IP_Address":
                        if op in ["starts_with", "in_subnet"]:
                            outflow_sql += " AND IP_Address LIKE ?"
                            outflow_params.append(f"{val}%")
                        else:
                            outflow_sql += " AND IP_Address = ?"
                            outflow_params.append(str(val))
                    elif field == "Device_Type":
                        outflow_sql += " AND LOWER(Device_Type) LIKE ?"
                        outflow_params.append(f"%{str(val).lower()}%")
                    elif field == "Payment_Mode":
                        outflow_sql += " AND UPPER(Payment_Mode) = ?"
                        outflow_params.append(str(val).upper())
                
            outflow_sql += " ORDER BY Timestamp ASC;"
            outflows = self.con.execute(outflow_sql, outflow_params).fetchall()
            
            if not outflows:
                continue
                
            total_out = sum(o[5] for o in outflows)
            # Pro-rata attribution
            attribution_ratio = min(1.0, tainted_in / max(total_out, 1.0))
            
            forwarded_sum = 0.0
            for out_txn in outflows:
                o_txnid = out_txn[0]
                o_sender = out_txn[1]
                o_receiver = out_txn[2]
                o_sifsc = out_txn[3]
                o_rifsc = out_txn[4]
                o_amt = out_txn[5]
                o_ts = out_txn[6]
                o_mode = out_txn[7]
                o_narr = out_txn[8]
                o_ip = out_txn[9] if len(out_txn) > 9 else "103.118.12.1"
                o_dev = out_txn[10] if len(out_txn) > 10 else "Android"
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
            "freeze_candidates": freeze_candidates,
            "filters_applied": {
                "max_hops": max_hops,
                "time_window_minutes": time_window_minutes,
                "min_amount": min_amount,
                "bank_filter": bank_filter,
                "keyword": keyword,
                "custom_rules_count": len(custom_rules) if custom_rules else 0
            }
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
