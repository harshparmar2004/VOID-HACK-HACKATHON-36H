"""Shared helpers for TRAP_CHECKLIST audits.

Never opens data\\case.duckdb. Never prints more than ~50 rows.
CSV is read once into %TEMP% Parquet (all_varchar), then queried in-memory.
"""
from __future__ import annotations

import json
import os
import struct
import time
import zlib
from datetime import datetime
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "VoidHacks8_MuleAccount_2M_Transactions.csv"
AUDITS_DIR = Path(__file__).resolve().parent
REPORTS_DIR = ROOT / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"
TEMP_DIR = Path(os.environ["TEMP"])
SRC_PARQUET = TEMP_DIR / "abhedya_src.parquet"
T_PARQUET = TEMP_DIR / "abhedya_t.parquet"

CSV_SQL = CSV_PATH.as_posix()
SRC_SQL = SRC_PARQUET.as_posix()
T_SQL = T_PARQUET.as_posix()

MEMORY_LIMIT = "3GB"

EXPECTED_HEADER = [
    "Transaction_ID",
    "Sender_Account",
    "Receiver_Account",
    "Sender_IFSC",
    "Receiver_IFSC",
    "Amount",
    "Timestamp",
    "Payment_Mode",
    "Narration",
    "IP_Address",
    "Device_Type",
]

HEADLESS = ("Web_Emulator", "Linux_Script")
PAY_BANKS = ("PYTM", "AIRP", "IPOS")


def _new_con() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()  # in-memory; never case.duckdb
    con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
    con.execute("SET preserve_insertion_order=true")
    return con


def ensure_parquet() -> dict:
    """Build TEMP parquet files from the CSV if missing. Returns build stats."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    AUDITS_DIR.mkdir(parents=True, exist_ok=True)
    stats = {"built": False, "src_parquet": str(SRC_PARQUET), "t_parquet": str(T_PARQUET)}
    if SRC_PARQUET.is_file() and T_PARQUET.is_file() and SRC_PARQUET.stat().st_size > 0:
        stats["src_bytes"] = SRC_PARQUET.stat().st_size
        stats["t_bytes"] = T_PARQUET.stat().st_size
        return stats

    t0 = time.perf_counter()
    con = _new_con()
    try:
        con.execute(
            f"""
            CREATE TABLE src AS
            SELECT
                CAST(row_number() OVER () AS BIGINT) AS file_row_number,
                *
            FROM read_csv(
                '{CSV_SQL}',
                all_varchar = true,
                header = true
            )
            """
        )
        n = con.execute("SELECT count(*) FROM src").fetchone()[0]
        con.execute(f"COPY src TO '{SRC_SQL}' (FORMAT PARQUET)")
        con.execute(
            """
            CREATE TABLE t AS
            SELECT
                CAST(file_row_number AS BIGINT) AS file_row_number,
                row_number() OVER (ORDER BY file_row_number) AS row_n,
                "Transaction_ID"   AS tx_id,
                "Sender_Account"   AS src_acct,
                "Receiver_Account" AS dst_acct,
                "Sender_IFSC"      AS src_ifsc,
                "Receiver_IFSC"    AS dst_ifsc,
                "Amount"           AS amount_raw,
                TRY_CAST("Amount" AS DOUBLE) AS amount,
                TRY_CAST(round(TRY_CAST("Amount" AS DOUBLE) * 100) AS BIGINT) AS amount_paise,
                "Timestamp"        AS ts_raw,
                TRY_STRPTIME("Timestamp", '%Y-%m-%d %H:%M:%S') AS ts,
                "Payment_Mode"     AS mode,
                "Narration"        AS narration,
                "IP_Address"       AS ip,
                "Device_Type"      AS device,
                (starts_with("IP_Address", '185.')
                 OR starts_with("IP_Address", '194.')) AS is_foreign,
                ("Device_Type" IN ('Web_Emulator', 'Linux_Script')) AS is_headless,
                split_part("Narration", '/', 1) AS narr_rail,
                split_part("Narration", '/', 2) AS narr_cat,
                split_part("Narration", '/', 3) AS narr_detail,
                substr("Sender_Account", 1, 4)   AS src_bank,
                substr("Receiver_Account", 1, 4) AS dst_bank,
                substr("Sender_IFSC", 1, 4)      AS src_ifsc_bank,
                substr("Receiver_IFSC", 1, 4)    AS dst_ifsc_bank,
                TRY_CAST(split_part("IP_Address", '.', 1) AS INTEGER) AS ip_o1,
                TRY_CAST(split_part("IP_Address", '.', 2) AS INTEGER) AS ip_o2,
                TRY_CAST(split_part("IP_Address", '.', 3) AS INTEGER) AS ip_o3,
                TRY_CAST(split_part("IP_Address", '.', 4) AS INTEGER) AS ip_o4
            FROM src
            """
        )
        con.execute(f"COPY t TO '{T_SQL}' (FORMAT PARQUET)")
        stats.update(
            {
                "built": True,
                "rows": n,
                "seconds": round(time.perf_counter() - t0, 3),
                "src_bytes": SRC_PARQUET.stat().st_size,
                "t_bytes": T_PARQUET.stat().st_size,
            }
        )
    finally:
        con.close()
    return stats


def connect(typed: bool = True) -> duckdb.DuckDBPyConnection:
    """In-memory DuckDB with `src` (all varchar) and optionally `t` (typed)."""
    ensure_parquet()
    con = _new_con()
    con.execute(f"CREATE TABLE src AS SELECT * FROM read_parquet('{SRC_SQL}')")
    if typed:
        con.execute(f"CREATE TABLE t AS SELECT * FROM read_parquet('{T_SQL}')")
    return con


def jsonable(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat(sep=" ", timespec="seconds")
        except TypeError:
            return v.isoformat()
    return str(v)


def rows_to_dicts(con, sql: str, limit: int = 5) -> list[dict]:
    res = con.execute(sql)
    cols = [c[0] for c in res.description]
    out = []
    for tup in res.fetchall()[:limit]:
        d = {c: jsonable(v) for c, v in zip(cols, tup)}
        if "narration" in d and isinstance(d["narration"], str) and len(d["narration"]) > 80:
            d["narration"] = d["narration"][:80] + "…"
        out.append(d)
    return out


def rec(check_id: str, result: str, count, examples, verdict: str, handling: str, extra=None) -> dict:
    return {
        "id": check_id,
        "result": result,
        "count": count,
        "examples": examples[:5] if examples else [],
        "verdict": verdict,
        "handling": handling,
        "extra": extra or {},
    }


def dump_section(section: str, checks: list[dict], runtime_s: float, extra=None) -> Path:
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "section": section,
        "written_at": datetime.now().isoformat(timespec="seconds"),
        "duckdb_version": duckdb.__version__,
        "runtime_s": round(runtime_s, 3),
        "checks": checks,
        "extra": extra or {},
    }
    path = AUDITS_DIR / f"out_{section}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def print_checks(checks: list[dict]) -> None:
    print(f"{'ID':<6} {'VERDICT':<14} {'COUNT':>12}  FINDING")
    for c in checks:
        finding = c["result"].replace("\n", " ")
        if len(finding) > 90:
            finding = finding[:87] + "..."
        print(f"{c['id']:<6} {c['verdict']:<14} {str(c['count']):>12}  {finding}")


# --- tiny PNG bar chart (stdlib only; matplotlib is not in .venv) -------------

_FONT = {
    " ": [0, 0, 0, 0, 0],
    "0": [14, 17, 17, 17, 14],
    "1": [4, 12, 4, 4, 14],
    "2": [14, 1, 14, 16, 31],
    "3": [30, 1, 14, 1, 30],
    "4": [18, 18, 31, 2, 2],
    "5": [31, 16, 30, 1, 30],
    "6": [14, 16, 30, 17, 14],
    "7": [31, 1, 2, 4, 4],
    "8": [14, 17, 14, 17, 14],
    "9": [14, 17, 15, 1, 14],
    "A": [14, 17, 31, 17, 17],
    "B": [30, 17, 30, 17, 30],
    "C": [14, 17, 16, 17, 14],
    "D": [30, 17, 17, 17, 30],
    "E": [31, 16, 30, 16, 31],
    "F": [31, 16, 30, 16, 16],
    "G": [14, 16, 19, 17, 14],
    "H": [17, 17, 31, 17, 17],
    "I": [14, 4, 4, 4, 14],
    "J": [1, 1, 1, 17, 14],
    "K": [17, 18, 28, 18, 17],
    "L": [16, 16, 16, 16, 31],
    "M": [17, 27, 21, 17, 17],
    "N": [17, 25, 21, 19, 17],
    "O": [14, 17, 17, 17, 14],
    "P": [30, 17, 30, 16, 16],
    "Q": [14, 17, 17, 21, 15],
    "R": [30, 17, 30, 18, 17],
    "S": [15, 16, 14, 1, 30],
    "T": [31, 4, 4, 4, 4],
    "U": [17, 17, 17, 17, 14],
    "V": [17, 17, 17, 10, 4],
    "W": [17, 17, 21, 21, 10],
    "X": [17, 10, 4, 10, 17],
    "Y": [17, 10, 4, 4, 4],
    "Z": [31, 2, 4, 8, 31],
    "-": [0, 0, 14, 0, 0],
    ".": [0, 0, 0, 0, 4],
    "_": [0, 0, 0, 0, 31],
    "/": [1, 2, 4, 8, 16],
    "%": [19, 2, 4, 8, 25],
    ":": [0, 4, 0, 4, 0],
    ",": [0, 0, 0, 4, 8],
    "+": [0, 4, 14, 4, 0],
    "=": [0, 14, 0, 14, 0],
    "(": [4, 8, 8, 8, 4],
    ")": [8, 4, 4, 4, 8],
}


def _write_png(path: Path, w: int, h: int, rgb: bytearray) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + bytes(rgb[y * w * 3 : (y + 1) * w * 3]) for y in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def _put_text(rgb: bytearray, w: int, h: int, x: int, y: int, text: str, color=(20, 20, 20), scale=2):
    r, g, b = color
    for i, ch in enumerate(text.upper()):
        glyph = _FONT.get(ch, _FONT[" "])
        for gy, bits in enumerate(glyph):
            for gx in range(5):
                if bits & (16 >> gx):
                    for dy in range(scale):
                        for dx in range(scale):
                            px = x + (i * 6 + gx) * scale + dx
                            py = y + gy * scale + dy
                            if 0 <= px < w and 0 <= py < h:
                                o = (py * w + px) * 3
                                rgb[o : o + 3] = bytes((r, g, b))


def bar_png(filename: str, title: str, labels: list[str], values: list[float]) -> str:
    """Draw a simple labelled bar chart PNG. Returns path relative to reports/."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    w, h = 1000, 420
    rgb = bytearray(b"\xff" * (w * h * 3))
    # background already white
    _put_text(rgb, w, h, 12, 10, title[:70], (20, 40, 80), scale=2)
    if not values:
        _write_png(FIGURES_DIR / filename, w, h, rgb)
        return f"reports/figures/{filename}"
    mx = max(values) if max(values) > 0 else 1
    left, right, top, bottom = 50, 980, 50, 360
    n = len(values)
    bw = max(2, int((right - left) / n) - 4)
    for i, (lab, val) in enumerate(zip(labels, values)):
        x0 = left + i * (right - left) / n + 2
        bh = int((val / mx) * (bottom - top))
        y0 = bottom - bh
        for y in range(max(0, int(y0)), bottom):
            for x in range(int(x0), min(right, int(x0) + bw)):
                o = (y * w + x) * 3
                rgb[o : o + 3] = bytes((40, 90, 160))
        lab_s = str(lab)[:8]
        _put_text(rgb, w, h, int(x0), bottom + 8, lab_s, (40, 40, 40), scale=1)
    _write_png(FIGURES_DIR / filename, w, h, rgb)
    return f"reports/figures/{filename}"


if __name__ == "__main__":
    print("ensure_parquet", ensure_parquet())
    con = connect()
    try:
        print("duckdb", duckdb.__version__)
        print("src", con.execute("SELECT count(*) FROM src").fetchone()[0])
        print("t", con.execute("SELECT count(*) FROM t").fetchone()[0])
        print(con.execute("SELECT * FROM t LIMIT 1").fetchdf())
    finally:
        con.close()
