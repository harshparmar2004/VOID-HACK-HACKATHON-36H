import os
import time
import duckdb

CSV_PATH = os.path.abspath("VoidHacks8_MuleAccount_2M_Transactions.csv")
if not os.path.exists(CSV_PATH):
    CSV_PATH = os.path.abspath("../VoidHacks8_MuleAccount_2M_Transactions.csv")

print(f"[*] Testing CSV path: {CSV_PATH}")
con = duckdb.connect()

t0 = time.time()
print("[*] Sniffing CSV schema and counting rows with DuckDB...")
row_count = con.execute(f"SELECT COUNT(*) FROM read_csv_auto('{CSV_PATH.replace(chr(92), '/')}', header=True);").fetchone()[0]
dur = time.time() - t0
print(f"[+] Total rows in CSV: {row_count:,} (Read in {dur:.2f}s)")

sample = con.execute(f"SELECT * FROM read_csv_auto('{CSV_PATH.replace(chr(92), '/')}', header=True) LIMIT 5;").fetchall()
cols = [d[0] for d in con.description]
print("\n[+] Columns:", cols)
for s in sample:
    print("Row:", s)

print("\n[*] Extracting top victim complainant candidates (accounts with outgoing money and scam narrations):")
victims = con.execute(f"""
    SELECT Sender_Account, COUNT(Transaction_ID) as txns, ROUND(SUM(Amount), 2) as volume,
           MIN(Timestamp) as first_ts, MAX(Timestamp) as last_ts
    FROM read_csv_auto('{CSV_PATH.replace(chr(92), '/')}', header=True)
    WHERE Sender_Account LIKE '%100000%' OR Narration LIKE '%REFUND%' OR Narration LIKE '%TASK%'
    GROUP BY Sender_Account
    HAVING volume > 100000
    ORDER BY volume DESC
    LIMIT 10;
""").fetchall()

for v in victims:
    print(f"  • Victim: {v[0]} | Txns: {v[1]} | Siphoned: INR {v[2]:,.2f} | Time: {v[3]} to {v[4]}")

