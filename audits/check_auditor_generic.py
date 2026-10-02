"""Fail if auditor\\ holds a literal taken from this dataset, or can switch a signal on.

    .venv\\Scripts\\python.exe audits\\check_auditor_generic.py --db data\\case.duckdb

1. Reads the dataset's own values from the database (read-only): category
   labels, narration words, row and category counts, duplicate counts, the IP
   prefixes of flagged rows, account-number and amount bounds, funnel sizes.
2. Scans every .py and .json file under auditor\\ (code, SQL, comments, rules)
   for a number or a word equal to one of them.
3. Checks the auditor stays read-only and that do_not_use is off-only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]

# Not derivable from the data: the activity cut-off named in CLAUDE.md (FORBIDDEN).
RULE_NUMBERS = {50: "the 50-transaction cut-off"}

CATEGORY_SQL = {
    "tx.mode": "SELECT mode, count(*) FROM tx GROUP BY 1",
    "tx.device": "SELECT device, count(*) FROM tx GROUP BY 1",
    "accounts.bank": "SELECT bank, count(*) FROM accounts GROUP BY 1",
    "accounts.ifsc prefix": "SELECT regexp_extract(ifsc, '^[A-Za-z]+'), count(*) FROM accounts GROUP BY 1",
    "narration prefix": "SELECT regexp_extract(narration, '^[A-Za-z]+'), count(*) FROM tx GROUP BY 1",
}
WORD_SQL = {
    "narration word": "SELECT DISTINCT unnest(regexp_extract_all(narration, '[A-Za-z][A-Za-z0-9]*')) FROM tx",
    "source file name": "SELECT DISTINCT unnest(regexp_extract_all(file_name, '[A-Za-z][A-Za-z0-9]*')) FROM ingest_meta",
}
NUMBER_SQL = {
    "tx rows": "SELECT count(*) FROM tx",
    "account rows": "SELECT count(*) FROM accounts",
    "distinct tx_id": "SELECT count(DISTINCT tx_id) FROM tx",
    "surplus tx_id rows": "SELECT count(*) - count(DISTINCT tx_id) FROM tx",
    "duplicated tx_id values": "SELECT count(*) FROM (SELECT tx_id FROM tx GROUP BY 1 HAVING count(*) > 1)",
    "rows with a duplicated tx_id": "SELECT count(*) FROM tx WHERE is_dup_tx_id",
    "headless rows": "SELECT count(*) FROM tx WHERE is_headless",
    "foreign-IP rows": "SELECT count(*) FROM tx WHERE is_foreign_ip",
    "IP prefix of flagged rows": "SELECT DISTINCT TRY_CAST(split_part(ip, '.', 1) AS BIGINT) FROM tx WHERE is_foreign_ip",
    "narration shape count": (
        "SELECT count(*) FROM tx GROUP BY regexp_replace(regexp_replace(narration, "
        "'[A-Za-z]+', 'A', 'g'), '[0-9]+', '9', 'g')"),
    "amount bound (paise)": "SELECT unnest([min(amount_paise), max(amount_paise)]) FROM tx",
    "amount bound (rupees)": "SELECT unnest([min(amount_paise) // 100, max(amount_paise) // 100]) FROM tx",
    "account-number bound": (
        "SELECT unnest([min(n), max(n)]) FROM (SELECT bank, TRY_CAST(regexp_extract(acct_no, '[0-9]+') AS BIGINT) AS n "
        "FROM accounts) GROUP BY bank"),
    "send-only accounts": "SELECT count(*) FROM features WHERE is_send_only",
    "receive-only accounts": "SELECT count(*) FROM features WHERE is_receive_only",
    "flagged accounts": (
        "SELECT count(*) FROM scores s JOIN scoring_profiles p ON p.profile_id = s.profile_id "
        "WHERE p.is_active AND s.is_flagged"),
    "accounts per role": (
        "SELECT count(*) FROM scores s JOIN scoring_profiles p ON p.profile_id = s.profile_id "
        "WHERE p.is_active AND s.role IS NOT NULL GROUP BY s.role"),
}

WRITE_WORDS = ("INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "COPY", "ATTACH", "EXPORT", "INSTALL")
OFF_KEYS = {"finding", "kind", "name", "test", "evidence"}
NUMBER = re.compile(r"(?<![A-Za-z_0-9.])\d+(?:\.\d+)*(?![A-Za-z_0-9])")
WORD = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
MIN_PART = 3


def dataset_values(db_path: str) -> tuple[dict[float, str], dict[str, str], list[str]]:
    """(numbers -> where from, words -> where from, sources skipped)."""
    numbers: dict[float, str] = dict(RULE_NUMBERS)
    words: dict[str, str] = {}
    skipped = []

    def add_word(w, src):
        if not w:
            return
        words.setdefault(str(w), src)
        for part in str(w).split("_"):
            if len(part) >= MIN_PART:
                words.setdefault(part, src)

    def add_number(n, src):
        if n is not None and float(n) > 1:
            numbers.setdefault(float(n), src)

    con = duckdb.connect(db_path, read_only=True)
    try:
        for src, sql in CATEGORY_SQL.items():
            try:
                for value, n in con.execute(sql).fetchall():
                    add_word(value, src)
                    add_number(n, f"row count of a {src} value")
            except duckdb.Error:
                skipped.append(src)
        for src, sql in WORD_SQL.items():
            try:
                for (value,) in con.execute(sql).fetchall():
                    add_word(value, src)
            except duckdb.Error:
                skipped.append(src)
        for src, sql in NUMBER_SQL.items():
            try:
                for (n,) in con.execute(sql).fetchall():
                    add_number(n, src)
            except duckdb.Error:
                skipped.append(src)
    finally:
        con.close()
    return numbers, words, skipped


def literal_numbers(token: str) -> list[float]:
    """12 -> [12]; 12.25 -> [12.25, 12]; 10.20.30.40 (address-like) -> each part."""
    parts = token.split(".")
    if len(parts) == 1:
        return [float(token)]
    if len(parts) == 2:
        return [float(token), float(parts[0])]
    return [float(p) for p in parts]


def scan(folder: Path, numbers: dict, words: dict) -> list[str]:
    hits = []
    for path in sorted(p for p in folder.rglob("*") if p.suffix in (".py", ".json") and "__pycache__" not in p.parts):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            where = f"{path.relative_to(folder.parent)}:{lineno}"
            for m in NUMBER.finditer(line):
                for value in literal_numbers(m.group()):
                    if value in numbers:
                        hits.append(f"{where}: number {m.group()} = {numbers[value]}")
            for m in WORD.finditer(line):
                for token in {m.group(), *m.group().split("_")}:
                    if token in words:
                        hits.append(f"{where}: word '{token}' = {words[token]}")
    return hits


def read_only_problems(folder: Path) -> list[str]:
    out = []
    for path in sorted(folder.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(folder.parent)
        for m in re.finditer(r"duckdb\.connect\((.*)$", text, re.M):
            if "read_only=True" not in m.group(1):
                out.append(f"{rel}: duckdb.connect without read_only=True")
        for word in WRITE_WORDS:
            if re.search(rf"\b{word}\b", text):
                out.append(f"{rel}: SQL write keyword {word}")
        if re.search(r"^\s*(from|import)\s+(engine|api)\b", text, re.M):
            out.append(f"{rel}: imports engine or api code")
    return out


def off_only_problems(audit_path: Path) -> list[str]:
    if not audit_path.is_file():
        return [f"{audit_path} not found (run auditor\\run_audit.py first)"]
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    entries = audit.get("do_not_use", {}).get("entries")
    if entries is None:
        return ["audit.json has no do_not_use.entries"]
    out = []
    listed = {e.get("finding") for e in entries}
    for e in entries:
        if set(e) != OFF_KEYS:
            out.append(f"do_not_use entry for {e.get('finding')} has keys {sorted(set(e) ^ OFF_KEYS)} off the off-only schema")
        if e.get("kind") not in ("field", "pattern"):
            out.append(f"do_not_use entry for {e.get('finding')} has kind {e.get('kind')!r}")
    for f in audit["findings"]:
        if (f["verdict"] == "ARTEFACT") != (f["id"] in listed):
            out.append(f"{f['id']}: verdict {f['verdict']} does not match its do_not_use entries")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True, help="path to case.duckdb (opened read-only)")
    ap.add_argument("--path", default=str(ROOT / "auditor"), help="folder to scan")
    ap.add_argument("--audit", default=str(ROOT / "reports" / "json" / "audit.json"))
    a = ap.parse_args()
    t0 = time.perf_counter()
    numbers, words, skipped = dataset_values(a.db)
    folder = Path(a.path).resolve()
    checks = [
        ("dataset literals in " + folder.name, scan(folder, numbers, words)),
        ("read-only auditor", read_only_problems(folder)),
        ("do_not_use is off-only", off_only_problems(Path(a.audit))),
    ]
    print(f"runtime {time.perf_counter() - t0:.2f}s  dataset values: {len(numbers)} numbers, {len(words)} words"
          + (f"  (not available: {', '.join(skipped)})" if skipped else ""))
    failed = 0
    for name, problems in checks:
        print(f"{'FAIL' if problems else 'PASS':<5} {name}: {len(problems)} problem(s)")
        for p in problems[:40]:
            print(f"      {p}")
        failed += bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
