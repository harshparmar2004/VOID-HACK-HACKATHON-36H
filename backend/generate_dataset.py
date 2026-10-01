"""
Operation Abhedya-Chakra: High-Throughput Synthetic Banking Dataset Generator
Generates 2,000,000 transactions across ~25,000 accounts with 1,500 injected ground-truth mules
(Layer 1 Collectors, Layer 2 Distributors with 3-50 fan-outs, Layer 3 Cash-Outs)
and 23,500 regular accounts across a 15-day window.
"""

import os
import sys
import time
import random
import duckdb
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
PARQUET_FILE = os.path.join(DATA_DIR, "transactions_2m.parquet")
CSV_SAMPLE = os.path.join(DATA_DIR, "transactions_sample.csv")
GROUND_TRUTH_FILE = os.path.join(DATA_DIR, "ground_truth_mules.json")
VICTIMS_FILE = os.path.join(DATA_DIR, "blind_victims.json")

BANKS = [
    ("SBIN", "State Bank of India"),
    ("HDFC", "HDFC Bank"),
    ("ICIC", "ICICI Bank"),
    ("PUNB", "Punjab National Bank"),
    ("UTIB", "Axis Bank"),
    ("BARB", "Bank of Baroda"),
    ("CNRB", "Canara Bank"),
    ("UBIN", "Union Bank of India"),
    ("IOBA", "Indian Overseas Bank"),
    ("KKBK", "Kotak Mahindra Bank")
]

PAYMENT_MODES = ["UPI", "IMPS", "NEFT", "RTGS"]
NORMAL_DEVICES = ["Android", "iOS", "Windows_Browser"]
MULE_DEVICES = ["Web_Emulator", "Linux_Script"]

NORMAL_NARRATIONS = [
    "UPI-Salary-Credited", "Bill-Payment-Utility", "IMPS-Rent-Transfer", 
    "UPI-Groceries-Kirana", "NEFT-Vendor-Settlement", "UPI-Dining-Payment",
    "Self-Transfer-Savings", "UPI-Recharge-Mobile", "E-Commerce-Purchase"
]

SCAM_NARRATIONS = [
    "P2P-USDT-Settlement", "Task-Bonus-Refund", "Fast-Settlement-Pool",
    "Crypto-Binance-Transfer", "Telegram-Task-Commission", "Express-Payout-Gateway"
]

def make_acct(num):
    return f"{num:012d}"

def make_ifsc(bank_prefix, branch_num):
    return f"{bank_prefix}{branch_num:07d}"

def generate_benchmark_dataset(total_records=2_000_000, num_accounts=25_000, num_mules=1500):
    print(f"[*] Starting dataset generation: {total_records:,} records across {num_accounts:,} accounts...")
    t0 = time.time()
    
    start_time = datetime(2026, 10, 1, 9, 0, 0)
    
    # 1. Segregate Accounts
    victim_accounts = [make_acct(i) for i in range(100_000_000_001, 100_000_000_001 + 100)]
    mule_accounts = [make_acct(i) for i in range(200_000_000_001, 200_000_000_001 + num_mules)]
    regular_accounts = [make_acct(i) for i in range(300_000_000_001, 300_000_000_001 + (num_accounts - num_mules - 100))]
    
    # Divide mules into rings: each ring has ~1-3 L1, ~10-40 L2, ~10-30 L3
    # 1500 mules -> ~40 rings
    rings = []
    idx = 0
    mules_per_ring = 35
    num_rings = num_mules // mules_per_ring
    
    ground_truth = {}
    
    for r in range(num_rings):
        ring_mules = mule_accounts[idx : idx + mules_per_ring]
        idx += mules_per_ring
        if not ring_mules:
            break
        
        l1_count = random.randint(1, 3)
        l2_count = random.randint(10, 20)
        
        l1_nodes = ring_mules[:l1_count]
        l2_nodes = ring_mules[l1_count : l1_count + l2_count]
        l3_nodes = ring_mules[l1_count + l2_count :]
        
        for n in l1_nodes:
            ground_truth[n] = {"role": "L1", "ring_id": r + 1, "is_mule": True}
        for n in l2_nodes:
            ground_truth[n] = {"role": "L2", "ring_id": r + 1, "is_mule": True}
        for n in l3_nodes:
            ground_truth[n] = {"role": "L3", "ring_id": r + 1, "is_mule": True}
            
        rings.append({
            "ring_id": r + 1,
            "L1": l1_nodes,
            "L2": l2_nodes,
            "L3": l3_nodes
        })
    
    # Save ground truth & victim list
    import json
    with open(GROUND_TRUTH_FILE, "w") as f:
        json.dump(ground_truth, f, indent=2)
        
    blind_victims = victim_accounts[:20]
    with open(VICTIMS_FILE, "w") as f:
        json.dump({"victims": blind_victims}, f, indent=2)
        
    print(f"[+] Ground truth configured for {len(ground_truth)} mules across {len(rings)} syndicate rings.")
    print(f"[+] Injected {len(blind_victims)} benchmark victim accounts.")

    # We will use DuckDB to synthesize and store the data at maximum speed
    con = duckdb.connect()
    con.execute("PRAGMA threads=8;")
    con.execute("PRAGMA memory_limit='4GB';")
    
    # Create Table Schema matching exact 11 columns
    con.execute("""
    CREATE TABLE transactions (
        Transaction_ID VARCHAR,
        Sender_Account VARCHAR,
        Receiver_Account VARCHAR,
        Sender_IFSC VARCHAR,
        Receiver_IFSC VARCHAR,
        Amount DOUBLE,
        Timestamp TIMESTAMP,
        Payment_Mode VARCHAR,
        Narration VARCHAR,
        IP_Address VARCHAR,
        Device_Type VARCHAR
    );
    """)

    # 2. Inject Syndicate Fraud Transactions (The Money Trail)
    print("[*] Generating targeted syndicate fraud trails (Victim -> L1 -> 50 L2s -> L3)...")
    syndicate_rows = []
    txn_counter = 1000000
    
    for r_idx, ring in enumerate(rings):
        # Pick 1 or 2 victims
        v_sub = victim_accounts[(r_idx * 2) % len(victim_accounts) : (r_idx * 2) % len(victim_accounts) + 2]
        
        for victim in v_sub:
            base_dt = start_time + timedelta(days=random.randint(1, 12), hours=random.randint(9, 18), minutes=random.randint(0, 50))
            stolen_amt = random.randint(250_000, 1_500_000) # 2.5 Lakh to 15 Lakh
            
            # Hop 1: Victim -> L1
            l1_target = random.choice(ring["L1"])
            txn_counter += 1
            l1_time = base_dt
            syndicate_rows.append((
                f"TXN{txn_counter}",
                victim,
                l1_target,
                make_ifsc(random.choice(BANKS)[0], random.randint(100, 999)),
                make_ifsc(random.choice(BANKS)[0], random.randint(100, 999)),
                float(stolen_amt),
                l1_time.strftime("%Y-%m-%d %H:%M:%S"),
                random.choice(["IMPS", "NEFT", "RTGS"]),
                "URGENT-TRANSFER-DIGITAL-ARREST",
                f"103.{random.randint(10,250)}.{random.randint(1,254)}.{random.randint(1,254)}",
                "Android"
            ))
            
            # Hop 2: L1 -> L2s (High velocity: dispersed within 3 to 15 minutes!)
            # Fan-out smurfing into 3-50 accounts
            l2_targets = ring["L2"]
            if not l2_targets:
                continue
            
            pass_through_ratio = random.uniform(0.92, 0.98) # >= 90% passed
            dispersed_total = stolen_amt * pass_through_ratio
            slice_amt = round(dispersed_total / len(l2_targets), 2)
            
            l2_time_base = l1_time + timedelta(minutes=random.randint(3, 12))
            
            for l2 in l2_targets:
                txn_counter += 1
                l2_txn_time = l2_time_base + timedelta(seconds=random.randint(10, 180))
                syndicate_rows.append((
                    f"TXN{txn_counter}",
                    l1_target,
                    l2,
                    make_ifsc(random.choice(BANKS)[0], random.randint(100, 999)),
                    make_ifsc(random.choice(BANKS)[0], random.randint(100, 999)),
                    float(slice_amt),
                    l2_txn_time.strftime("%Y-%m-%d %H:%M:%S"),
                    random.choice(["IMPS", "UPI"]),
                    random.choice(SCAM_NARRATIONS),
                    f"185.{random.randint(10,250)}.{random.randint(1,254)}.{random.randint(1,254)}", # Foreign Proxy!
                    random.choice(MULE_DEVICES) # Headless device!
                ))
                
                # Hop 3: L2 -> L3 (Terminal Cash-out: Wallets, P2P Crypto, ATM)
                if ring["L3"]:
                    l3_target = random.choice(ring["L3"])
                    l3_pass_ratio = random.uniform(0.85, 0.95)
                    l3_amt = round(slice_amt * l3_pass_ratio, 2)
                    l3_txn_time = l2_txn_time + timedelta(minutes=random.randint(5, 30))
                    txn_counter += 1
                    syndicate_rows.append((
                        f"TXN{txn_counter}",
                        l2,
                        l3_target,
                        make_ifsc(random.choice(BANKS)[0], random.randint(100, 999)),
                        make_ifsc(random.choice(BANKS)[0], random.randint(100, 999)),
                        float(l3_amt),
                        l3_txn_time.strftime("%Y-%m-%d %H:%M:%S"),
                        "UPI",
                        "P2P-BINANCE-USDT-BUY",
                        f"194.{random.randint(10,250)}.{random.randint(1,254)}.{random.randint(1,254)}", # Foreign Proxy!
                        "Linux_Script"
                    ))
                    
    print(f"[+] Injected {len(syndicate_rows):,} direct syndicate transactions.")
    
    # Insert syndicate rows into DuckDB
    con.executemany("""
    INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, syndicate_rows)

    # 3. Fast Batch Generation for Remaining Background Transactions to reach 2,000,000 rows
    remaining = total_records - len(syndicate_rows)
    print(f"[*] Generating {remaining:,} legitimate background transactions using DuckDB vector engine...")
    
    con.execute(f"""
    INSERT INTO transactions
    SELECT
        'TXN' || (2000000 + i) AS Transaction_ID,
        LPAD(CAST(300000000001 + (i % 23000) AS VARCHAR), 12, '0') AS Sender_Account,
        LPAD(CAST(300000000001 + ((i * 7 + 13) % 23000) AS VARCHAR), 12, '0') AS Receiver_Account,
        CASE (i % 10)
            WHEN 0 THEN 'SBIN0001420' WHEN 1 THEN 'HDFC0004521' WHEN 2 THEN 'ICIC0008912'
            WHEN 3 THEN 'PUNB0006734' WHEN 4 THEN 'UTIB0002341' WHEN 5 THEN 'BARB0001129'
            WHEN 6 THEN 'CNRB0009823' WHEN 7 THEN 'UBIN0003412' WHEN 8 THEN 'IOBA0001189'
            ELSE 'KKBK0007712'
        END AS Sender_IFSC,
        CASE ((i * 3) % 10)
            WHEN 0 THEN 'SBIN0009910' WHEN 1 THEN 'HDFC0001123' WHEN 2 THEN 'ICIC0003344'
            WHEN 3 THEN 'PUNB0007812' WHEN 4 THEN 'UTIB0009988' WHEN 5 THEN 'BARB0004455'
            WHEN 6 THEN 'CNRB0002233' WHEN 7 THEN 'UBIN0005566' WHEN 8 THEN 'IOBA0007788'
            ELSE 'KKBK0004411'
        END AS Receiver_IFSC,
        ROUND(100.0 + (RANDOM() * 45000.0), 2) AS Amount,
        TIMESTAMP '2026-10-01 00:00:00' + INTERVAL (CAST(RANDOM() * 1296000 AS INTEGER)) SECOND AS Timestamp,
        CASE (i % 4)
            WHEN 0 THEN 'UPI' WHEN 1 THEN 'IMPS' WHEN 2 THEN 'NEFT' ELSE 'RTGS'
        END AS Payment_Mode,
        CASE (i % 9)
            WHEN 0 THEN 'UPI-Salary-Credited' WHEN 1 THEN 'Bill-Payment-Utility'
            WHEN 2 THEN 'IMPS-Rent-Transfer'  WHEN 3 THEN 'UPI-Groceries-Kirana'
            WHEN 4 THEN 'NEFT-Vendor-Settlement' WHEN 5 THEN 'UPI-Dining-Payment'
            WHEN 6 THEN 'Self-Transfer-Savings'  WHEN 7 THEN 'UPI-Recharge-Mobile'
            ELSE 'E-Commerce-Purchase'
        END AS Narration,
        '103.' || CAST(10 + (i % 240) AS VARCHAR) || '.' || CAST(1 + ((i * 5) % 254) AS VARCHAR) || '.' || CAST(1 + ((i * 11) % 254) AS VARCHAR) AS IP_Address,
        CASE (i % 3)
            WHEN 0 THEN 'Android' WHEN 1 THEN 'iOS' ELSE 'Windows_Browser'
        END AS Device_Type
    FROM range({remaining}) t(i);
    """)
    
    total_count = con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    print(f"[+] Total rows in database: {total_count:,}")
    
    # Export to Parquet and CSV Sample
    print(f"[*] Exporting dataset to Parquet: {PARQUET_FILE} ...")
    con.execute(f"COPY transactions TO '{PARQUET_FILE}' (FORMAT PARQUET, COMPRESSION ZSTD);")
    
    print(f"[*] Exporting 5,000-row sample to CSV: {CSV_SAMPLE} ...")
    con.execute(f"COPY (SELECT * FROM transactions LIMIT 5000) TO '{CSV_SAMPLE}' (HEADER, DELIMITER ',');")
    
    elapsed = time.time() - t0
    file_size_mb = os.path.getsize(PARQUET_FILE) / (1024 * 1024)
    print(f"\n[SUCCESS] Generated {total_count:,} records in {elapsed:.2f} seconds!")
    print(f"[+] Parquet File Size: {file_size_mb:.2f} MB")
    print(f"[+] Blind Victims saved to: {VICTIMS_FILE}")
    print(f"[+] Ground Truth Mules saved to: {GROUND_TRUTH_FILE}")

if __name__ == "__main__":
    count = 2_000_000
    if len(sys.argv) > 1:
        count = int(sys.argv[1])
    generate_benchmark_dataset(total_records=count)
