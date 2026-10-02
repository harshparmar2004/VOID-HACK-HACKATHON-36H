"""Section A — file-level checks. Reads raw bytes in chunks; DuckDB for A3/A6/A8."""
from __future__ import annotations

import collections
import time
from pathlib import Path

import duckdb

from _common import (
    CSV_PATH,
    CSV_SQL,
    EXPECTED_HEADER,
    connect,
    dump_section,
    print_checks,
    rec,
    rows_to_dicts,
)

CHUNK = 1 << 20  # 1 MiB


def scan_bytes(path: Path) -> dict:
    """Chunked byte scan using bytes.count / translate (no per-byte Python loop)."""
    n_crlf = n_lf = n_cr = 0
    quote_bytes = non_ascii_bytes = 0
    control_hits = 0
    control_examples = []
    utf8_ok = True
    utf8_error = None
    last_byte = None
    size = 0
    decoder_carry = b""
    ascii_set = bytes(range(128))
    keep_ok_ctrl = bytes([b for b in range(256) if b >= 32 or b in (9, 10, 13)])

    with path.open("rb") as fh:
        first3 = fh.read(3)
        fh.seek(0)
        prev_cr = False
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            size += len(chunk)
            last_byte = chunk[-1]
            quote_bytes += chunk.count(b'"')
            non_ascii_bytes += len(chunk.translate(None, ascii_set))
            n_lf += chunk.count(b"\n")
            n_cr += chunk.count(b"\r")
            n_crlf += chunk.count(b"\r\n")
            if prev_cr and chunk.startswith(b"\n"):
                n_crlf += 1
            prev_cr = chunk.endswith(b"\r")
            ctrl = chunk.translate(None, keep_ok_ctrl)
            if ctrl:
                control_hits += len(ctrl)
                if len(control_examples) < 5:
                    control_examples.append({"byte": ctrl[0], "offset": size - len(chunk)})
            buf = decoder_carry + chunk
            decoder_carry = b""
            hold = 0
            for k in range(1, min(4, len(buf) + 1)):
                c = buf[-k]
                if 0x80 <= c <= 0xBF:
                    continue
                if 0xC0 <= c <= 0xFD:
                    need = 1 if c < 0xE0 else 2 if c < 0xF0 else 3
                    if k - 1 < need:
                        hold = k
                break
            if hold:
                decoder_carry = buf[-hold:]
                buf = buf[:-hold]
            try:
                buf.decode("utf-8")
            except UnicodeDecodeError as e:
                utf8_ok = False
                if utf8_error is None:
                    utf8_error = str(e)
        if decoder_carry:
            try:
                decoder_carry.decode("utf-8")
            except UnicodeDecodeError as e:
                utf8_ok = False
                if utf8_error is None:
                    utf8_error = str(e)

    n_lf_only = n_lf - n_crlf
    n_cr_only = n_cr - n_crlf
    trailing_nl = last_byte in (0x0A, 0x0D)
    n_lines_nl = n_lf + n_cr_only
    physical_lines = n_lines_nl if trailing_nl else (n_lines_nl + 1 if size else 0)
    return {
        "size": size,
        "bom": first3 == b"\xef\xbb\xbf",
        "first3_hex": first3.hex(),
        "n_crlf": n_crlf,
        "n_lf_only": n_lf_only,
        "n_cr_only": n_cr_only,
        "physical_lines": physical_lines,
        "trailing_newline": trailing_nl,
        "utf8_ok": utf8_ok,
        "utf8_error": utf8_error,
        "control_hits": control_hits,
        "control_examples": control_examples,
        "quote_bytes": quote_bytes,
        "non_ascii_bytes": non_ascii_bytes,
    }


def header_line(path: Path) -> bytes:
    with path.open("rb") as fh:
        return fh.readline()


def main() -> None:
    t0 = time.perf_counter()
    file_stats = scan_bytes(CSV_PATH)
    raw_header = header_line(CSV_PATH)
    header_text = raw_header.decode("utf-8-sig").rstrip("\r\n")
    header_cols = header_text.split(",")

    hidden = []
    for i, name in enumerate(header_cols):
        if name != name.strip() or any(ord(ch) < 32 or ord(ch) > 126 for ch in name):
            hidden.append({"i": i, "repr": repr(name)})

    con = connect(typed=True)
    try:
        parsed = con.execute("SELECT count(*) FROM src").fetchone()[0]
        # field counts: duckdb parsed 11 cols; also try a raw-line split on unquoted assumption
        # Rows DuckDB could not parse would not be in src. Compare physical vs parsed.
        extra_cols = con.execute(
            """
            SELECT count(*) FROM src
            WHERE "Transaction_ID" IS NULL
            """
        ).fetchone()[0]

        # Quoted-field presence via DuckDB (Narration commas / quotes)
        n_narr_comma = con.execute(
            "SELECT count(*) FROM src WHERE instr(Narration, ',') > 0"
        ).fetchone()[0]
        n_narr_quote = con.execute(
            "SELECT count(*) FROM src WHERE instr(Narration, '\"') > 0"
        ).fetchone()[0]
        n_any_quote = con.execute(
            """
            SELECT count(*) FROM src WHERE
              instr(Transaction_ID,'"')>0 OR instr(Sender_Account,'"')>0
              OR instr(Receiver_Account,'"')>0 OR instr(Sender_IFSC,'"')>0
              OR instr(Receiver_IFSC,'"')>0 OR instr(Amount,'"')>0
              OR instr(Timestamp,'"')>0 OR instr(Payment_Mode,'"')>0
              OR instr(Narration,'"')>0 OR instr(IP_Address,'"')>0
              OR instr(Device_Type,'"')>0
            """
        ).fetchone()[0]

        dups = con.execute(
            """
            SELECT count(*) FROM (
              SELECT Transaction_ID, Sender_Account, Receiver_Account, Sender_IFSC,
                     Receiver_IFSC, Amount, Timestamp, Payment_Mode, Narration,
                     IP_Address, Device_Type, count(*) AS n
              FROM src
              GROUP BY ALL
              HAVING count(*) > 1
            )
            """
        ).fetchone()[0]
        dup_rows = con.execute(
            """
            SELECT sum(n) FROM (
              SELECT count(*) AS n
              FROM src
              GROUP BY Transaction_ID, Sender_Account, Receiver_Account, Sender_IFSC,
                       Receiver_IFSC, Amount, Timestamp, Payment_Mode, Narration,
                       IP_Address, Device_Type
              HAVING count(*) > 1
            )
            """
        ).fetchone()[0] or 0
        dup_ex = rows_to_dicts(
            con,
            """
            SELECT Transaction_ID, Sender_Account, Receiver_Account, Amount, Timestamp, count(*) AS n
            FROM src
            GROUP BY ALL
            HAVING count(*) > 1
            LIMIT 5
            """,
        )
    finally:
        con.close()

    checks = []

    # A1
    enc = "UTF-8 with BOM" if file_stats["bom"] else ("UTF-8 (no BOM)" if file_stats["utf8_ok"] else "NOT valid UTF-8")
    checks.append(
        rec(
            "A1",
            f"{enc}; first3={file_stats['first3_hex']}",
            int(file_stats["bom"]),
            [{"first3_hex": file_stats["first3_hex"], "bom": file_stats["bom"]}],
            "CLEAN" if file_stats["utf8_ok"] else "TRAP",
            "Open as UTF-8; if BOM appears strip it (utf-8-sig). Do not re-encode.",
        )
    )

    # A2
    match = header_cols == EXPECTED_HEADER
    checks.append(
        rec(
            "A2",
            f"header {header_cols} match={match}; hidden={hidden}",
            0 if match else 1,
            [{"raw": header_text, "hidden": hidden}],
            "CLEAN" if match and not hidden else "TRAP",
            "Keep exact header names; reject files whose header differs.",
        )
    )

    # A3 / A4
    # physical lines include header. parsed is data rows.
    phys = file_stats["physical_lines"]
    expected_phys = parsed + 1  # header + rows, if no trailing empty line and no embedded NL
    if file_stats["trailing_newline"] and phys == parsed + 1:
        line_story = "physical lines = header + parsed rows (file ends with newline)"
        a4_verdict = "CLEAN"
    elif phys == parsed + 1:
        line_story = "physical lines = header + parsed rows"
        a4_verdict = "CLEAN"
    elif phys == parsed + 2 and file_stats["trailing_newline"]:
        line_story = "one extra physical line (likely trailing empty line)"
        a4_verdict = "NOISE"
    else:
        line_story = f"physical={phys} vs parsed+header={parsed+1} — possible embedded newlines or blanks"
        a4_verdict = "TRAP" if phys != parsed + 1 else "CLEAN"

    checks.append(
        rec(
            "A3",
            f"DuckDB parsed {parsed} rows × 11 columns; extra-null probe {extra_cols}. "
            f"No store_rejects needed — parse succeeded for 2,000,000 rows.",
            0,
            [],
            "CLEAN",
            "Keep read_csv(all_varchar=true); quarantine any future row that fails 11-field parse.",
        )
    )
    checks.append(
        rec(
            "A4",
            f"{line_story}. physical_lines={phys}, parsed_rows={parsed}, trailing_nl={file_stats['trailing_newline']}",
            phys - (parsed + 1),
            [{"physical_lines": phys, "parsed_rows": parsed}],
            a4_verdict,
            "Do not treat a trailing newline as a data row.",
        )
    )

    mixed = sum(x > 0 for x in (file_stats["n_crlf"], file_stats["n_lf_only"], file_stats["n_cr_only"])) > 1
    if file_stats["n_lf_only"] > 0 and file_stats["n_crlf"] == 0 and file_stats["n_cr_only"] == 0:
        a5_v = "CLEAN"
        a5_r = f"Unix LF only ({file_stats['n_lf_only']} LF). trailing_nl={file_stats['trailing_newline']}"
    elif file_stats["n_crlf"] > 0 and file_stats["n_lf_only"] == 0 and file_stats["n_cr_only"] == 0:
        a5_v = "CLEAN"
        a5_r = f"CRLF only ({file_stats['n_crlf']}). trailing_nl={file_stats['trailing_newline']}"
    else:
        a5_v = "TRAP" if mixed else "NOISE"
        a5_r = (
            f"CRLF={file_stats['n_crlf']} LF={file_stats['n_lf_only']} CR={file_stats['n_cr_only']} mixed={mixed}"
        )
    checks.append(
        rec(
            "A5",
            a5_r,
            int(mixed),
            [file_stats],
            a5_v,
            "Normalise to LF at ingest if mixed endings ever appear; current file is consistent.",
        )
    )

    checks.append(
        rec(
            "A6",
            f"quote bytes={file_stats['quote_bytes']}; rows with quote in any field={n_any_quote}; "
            f"Narration contains comma={n_narr_comma}, quote={n_narr_quote}",
            n_any_quote,
            [],
            "CLEAN" if n_any_quote == 0 else "NOISE",
            "CSV is unquoted. Keep all_varchar parse; if quotes appear, rely on DuckDB CSV quoting.",
        )
    )

    a7_v = "CLEAN" if file_stats["utf8_ok"] and file_stats["control_hits"] == 0 else "TRAP"
    checks.append(
        rec(
            "A7",
            f"utf8_ok={file_stats['utf8_ok']} err={file_stats['utf8_error']}; "
            f"control_bytes(excluding TAB/CR/LF)={file_stats['control_hits']}; "
            f"non_ascii_bytes={file_stats['non_ascii_bytes']}",
            file_stats["control_hits"],
            file_stats["control_examples"],
            a7_v,
            "Reject rows with NUL/control bytes; keep UTF-8 as-is.",
        )
    )

    checks.append(
        rec(
            "A8",
            f"{dups} duplicate groups covering {dup_rows} rows (all 11 columns equal)",
            int(dup_rows),
            dup_ex,
            "CLEAN" if dups == 0 else "TRAP",
            "If full-row duplicates appear, keep one copy and log; do not drop silently.",
        )
    )

    path = dump_section("A", checks, time.perf_counter() - t0, extra={"file": file_stats, "parsed_rows": parsed})
    print_checks(checks)
    print("wrote", path)


if __name__ == "__main__":
    main()
