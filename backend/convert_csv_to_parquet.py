import os
import time
import duckdb

csv_path = "E:/VOID-HACK-HACKATHON-36H-main/VoidHacks8_MuleAccount_2M_Transactions.csv"
parquet_path = "E:/VOID-HACK-HACKATHON-36H-main/backend/data/transactions_2m.parquet"

print(f"[*] Converting 2M CSV {csv_path} -> {parquet_path} ...")
t0 = time.time()
con = duckdb.connect()
con.execute(f"""
    COPY (
        SELECT * FROM read_csv_auto('{csv_path}', header=True)
    ) TO '{parquet_path}' (FORMAT PARQUET, COMPRESSION ZSTD);
""")
dur = time.time() - t0
print(f"[+] Conversion completed in {dur:.2f} seconds!")
print(f"[+] Output Parquet size: {os.path.getsize(parquet_path) / (1024*1024):.2f} MB")
