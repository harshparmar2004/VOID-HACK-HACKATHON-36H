"""
audits/check_api.py -- checks the Step 6 batch B1 API against the database.

Read-only. Uses FastAPI's TestClient (no server, no network).

Checked:
  * every response is HTTP 200, carries the timing header and passes its schema
    (the Pydantic models reject unknown fields);
  * counts match SQL run here, independently of the API's repositories
    (e.g. /mules?role_filter=L2 against count(*) of scores with that role);
  * filters (role, min_risk, min_amount, bank, limit) match the same filter in SQL;
  * errors are clean JSON (404, 422) and CORS answers the UI origin;
  * data\\case.duckdb is unchanged after the run (size and modified time) and
    no .wal file appeared.

Filter values (a risk cut, a bank, an amount) are taken from the data, not
hard-coded. Run:  .venv\\Scripts\\python.exe audits\\check_api.py [--samples]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import duckdb
from pydantic import TypeAdapter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from api.deps import db_path  # noqa: E402
from api.main import app  # noqa: E402
from api.middleware import ALLOWED_ORIGINS, TIMING_HEADER  # noqa: E402
from api.schemas.entities import EntitiesResponse  # noqa: E402
from api.schemas.mules import MuleItem  # noqa: E402
from api.schemas.status import StatusResponse  # noqa: E402
from api.schemas.victims import VictimItem  # noqa: E402

SCHEMAS = {
    "/api/status": TypeAdapter(StatusResponse),
    "/api/victims": TypeAdapter(list[VictimItem]),
    "/api/detected-victims": TypeAdapter(list[VictimItem]),
    "/api/mules": TypeAdapter(list[MuleItem]),
    "/api/entities": TypeAdapter(EntitiesResponse),
}

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))


def same(name: str, got, want) -> None:
    check(name, got == want, f"api {got} / db {want}")


def file_state(path: Path) -> tuple[int, int]:
    st = path.stat()
    return st.st_size, st.st_mtime_ns


def expected(db: Path) -> dict:
    """Everything the API should agree with, from SQL written here."""
    con = duckdb.connect(str(db), read_only=True)
    try:
        one = lambda sql, p=None: con.execute(sql, p or []).fetchone()[0]  # noqa: E731
        pid = one("SELECT profile_id FROM scoring_profiles WHERE is_active")
        e = {"profile_id": pid}
        e["ingest"] = con.execute(
            "SELECT rows_loaded, rows_total, load_seconds, file_sha256 FROM ingest_meta "
            "ORDER BY load_id DESC LIMIT 1").fetchone()
        e["accounts"] = one("SELECT count(*) FROM accounts")
        e["flagged"] = one("SELECT count(*) FROM scores WHERE profile_id = ? AND is_flagged", [pid])
        e["freeze"] = one(
            "SELECT count(*) FROM scores WHERE profile_id = ? AND freeze_recommended", [pid])
        e["roles"] = dict(con.execute(
            "SELECT role, count(*) FROM scores WHERE profile_id = ? AND role IS NOT NULL "
            "GROUP BY role", [pid]).fetchall())
        e["flagged_roles"] = dict(con.execute(
            "SELECT role, count(*) FROM scores WHERE profile_id = ? AND is_flagged "
            "AND role IS NOT NULL GROUP BY role", [pid]).fetchall())
        e["cells"] = one("SELECT count(*) FROM cells WHERE profile_id = ?", [pid])
        e["foreign"] = one("SELECT count(*) FROM tx WHERE is_foreign_ip")
        e["receivers"] = one("SELECT count(DISTINCT dst) FROM tx")
        e["holding_paise"] = one(
            "SELECT sum(holding_paise) FROM scores WHERE profile_id = ? AND is_flagged", [pid])
        e["victim_paid_paise"] = one(
            "SELECT sum(amount_paise) FROM layer_links WHERE profile_id = ? "
            "AND link_type = 'VICTIM_L1'", [pid])
        # Filter values taken from the data.
        e["risk_cut"] = one(
            "SELECT median(final_index) FROM scores WHERE profile_id = ? AND is_flagged", [pid])
        e["n_risk"] = one(
            "SELECT count(*) FROM scores WHERE profile_id = ? AND is_flagged "
            "AND final_index >= ?", [pid, e["risk_cut"]])
        e["bank"], e["n_bank_mules"] = con.execute(
            "SELECT a.bank, count(*) FROM scores s JOIN accounts a USING (acct_id) "
            "WHERE s.profile_id = ? AND s.is_flagged GROUP BY a.bank "
            "ORDER BY count(*) DESC, a.bank LIMIT 1", [pid]).fetchone()
        e["n_bank_accounts"] = one("SELECT count(*) FROM accounts WHERE bank = ?", [e["bank"]])
        e["amount_cut_paise"] = one(
            "SELECT CAST(median(tot) AS BIGINT) FROM (SELECT sum(t.amount_paise) AS tot "
            "FROM tx t JOIN scores s ON s.acct_id = t.dst "
            "WHERE s.profile_id = ? AND s.is_flagged GROUP BY t.dst)", [pid])
        e["n_amount"] = one(
            "SELECT count(*) FROM (SELECT sum(t.amount_paise) AS tot "
            "FROM tx t JOIN scores s ON s.acct_id = t.dst "
            "WHERE s.profile_id = ? AND s.is_flagged GROUP BY t.dst) WHERE tot >= ?",
            [pid, e["amount_cut_paise"]])
        return e
    finally:
        con.close()


def get(client: TestClient, path: str, **params):
    """GET, then the checks every response must pass. Returns the JSON body."""
    label = path + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")
    r = client.get(path, params=params)
    check(f"{label}  200", r.status_code == 200, f"HTTP {r.status_code}")
    check(f"{label}  timing header", TIMING_HEADER in r.headers)
    body = r.json()
    if r.status_code == 200:
        try:
            SCHEMAS[path].validate_python(body, strict=False)
            check(f"{label}  schema", True)
        except Exception as ex:  # report, do not stop the audit
            check(f"{label}  schema", False, str(ex)[:300])
    return body


def trim(body):
    """One item per list and at most 2 reasons, for the report."""
    if isinstance(body, list):
        return [trim(body[0])] if body else []
    if isinstance(body, dict):
        return {k: (v[:2] if k in ("reasons", "forensic_reasons") else
                    (v[:160] if k == "forensic_reason" else
                     trim(v) if isinstance(v, (list, dict)) and k in ("entities", "bank_stats") else v))
                for k, v in body.items()}
    return body


def main() -> None:
    t0 = time.perf_counter()
    db = db_path()
    before = file_state(db)
    wal = db.with_name(db.name + ".wal")
    wal_before = wal.exists()
    e = expected(db)
    samples = {}

    with TestClient(app) as client:
        # /status
        s = get(client, "/api/status")
        samples["/api/status"] = s
        same("status records_loaded", s["records_loaded"], e["ingest"][0])
        same("status records_parsed", s["records_parsed"], e["ingest"][1])
        same("status ingestion_seconds", s["ingestion_seconds"], e["ingest"][2])
        same("status hash", s["hash"], e["ingest"][3])
        same("status accounts", s["accounts"], e["accounts"])
        same("status flagged", s["flagged"], e["flagged"])
        same("status high_risk_mules", s["high_risk_mules"], e["flagged"])
        same("status freeze_recommended", s["freeze_recommended"], e["freeze"])
        same("status roles", s["roles"], e["roles"])
        same("status victims", s["victims"], e["roles"].get("VICTIM", 0))
        same("status cells", s["cells"], e["cells"])
        same("status foreign_ip_txns", s["foreign_ip_txns"], e["foreign"])
        same("status unique_receivers", s["unique_receivers"], e["receivers"])
        same("status profile_id", s["profile_id"], e["profile_id"])

        # /victims, /detected-victims
        v = get(client, "/api/victims")
        dv = get(client, "/api/detected-victims")
        samples["/api/victims"] = v
        samples["/api/detected-victims"] = dv
        same("victims count", len(v), e["roles"].get("VICTIM", 0))
        check("detected-victims = victims", v == dv)
        same("victims amount total (paise)",
             round(sum(x["amount"] or 0 for x in v) * 100), e["victim_paid_paise"])
        check("victims accounts unique", len({x["account"] for x in v}) == len(v))

        # /mules
        m = get(client, "/api/mules", limit=100000)
        samples["/api/mules"] = m
        same("mules count", len(m), e["flagged"])
        check("mules accounts unique", len({x["account"] for x in m}) == len(m))
        same("mules holding total (paise)",
             round(sum(x["holding_amount"] or 0 for x in m) * 100), e["holding_paise"])
        check("mules in - out = holding", all(
            x["holding_amount"] is None or
            round((x["total_incoming_amt"] - x["total_outgoing_amt"]) * 100)
            == round(x["holding_amount"] * 100) for x in m))
        check("mules sorted by final_index desc",
              [x["final_index"] for x in m] == sorted((x["final_index"] for x in m), reverse=True))
        for role, n in sorted(e["flagged_roles"].items()):
            got = get(client, "/api/mules", limit=100000, role_filter=role)
            same(f"mules role_filter={role}", len(got), n)
            check(f"mules role_filter={role} only that role", all(x["role"] == role for x in got))
        ui_label = get(client, "/api/mules", limit=100000, role_filter="L2_DISTRIBUTOR")
        same("mules role_filter=L2_DISTRIBUTOR (UI label)", len(ui_label),
             e["flagged_roles"].get("L2", 0))
        same("mules role_filter=L4_TERMINAL (no such role)",
             len(get(client, "/api/mules", role_filter="L4_TERMINAL")), 0)
        same("mules min_risk", len(get(client, "/api/mules", limit=100000,
                                       min_risk=e["risk_cut"])), e["n_risk"])
        same("mules bank_filter", len(get(client, "/api/mules", limit=100000,
                                          bank_filter=e["bank"])), e["n_bank_mules"])
        same("mules min_amount", len(get(client, "/api/mules", limit=100000,
                                         min_amount=e["amount_cut_paise"] / 100)), e["n_amount"])
        same("mules limit", len(get(client, "/api/mules", limit=7)), min(7, e["flagged"]))
        same("mules default = UI call (limit 2000)", len(get(client, "/api/mules", limit=2000)),
             min(2000, e["flagged"]))

        # /entities
        en = get(client, "/api/entities")
        samples["/api/entities"] = en
        same("entities total_accounts", en["total_accounts"], e["accounts"])
        same("entities matched (no filter)", en["matched"], e["accounts"])
        same("entities returned (default limit 500)", en["returned"], min(500, e["accounts"]))
        same("entities bank_stats sum", sum(b["count"] for b in en["bank_stats"]), e["accounts"])
        eb = get(client, "/api/entities", limit=100000, bank_filter=e["bank"])
        same("entities bank_filter matched", eb["matched"], e["n_bank_accounts"])
        same("entities bank_filter returned", len(eb["entities"]), e["n_bank_accounts"])
        check("entities bank_filter only that bank",
              all(x["bank"] == e["bank"] for x in eb["entities"]))
        ea = get(client, "/api/entities", limit=100000)
        same("entities all returned", len(ea["entities"]), e["accounts"])
        same("entities flagged", sum(1 for x in ea["entities"] if x["is_flagged"]), e["flagged"])

        # errors and CORS
        r = client.get("/api/nope")
        check("404 clean JSON", r.status_code == 404 and r.json().get("status") == 404
              and "detail" in r.json(), r.text[:120])
        r = client.get("/api/mules", params={"limit": 0})
        check("422 clean JSON", r.status_code == 422 and "errors" in r.json(), r.text[:120])
        origin = ALLOWED_ORIGINS[0]
        r = client.get("/api/status", headers={"Origin": origin})
        check("CORS allows the UI origin",
              r.headers.get("access-control-allow-origin") == origin)
        r = client.get("/api/status", headers={"Origin": "http://example.invalid"})
        check("CORS refuses another origin", "access-control-allow-origin" not in r.headers)
        writes = sorted(f"{m_} {r_.path}" for r_ in app.routes
                        for m_ in getattr(r_, "methods", ()) or ()
                        if m_ not in ("GET", "HEAD", "OPTIONS"))
        check("no write routes", not writes, ", ".join(writes))

    after = file_state(db)
    check("database size unchanged", before[0] == after[0], f"{before[0]} -> {after[0]}")
    check("database modified time unchanged", before[1] == after[1], f"{before[1]} -> {after[1]}")
    check("no .wal file created", wal.exists() == wal_before)

    failed = [r for r in results if not r[1]]
    print(f"runtime {time.perf_counter() - t0:.2f} s   database {db.name} "
          f"({after[0]:,} bytes)   profile {e['profile_id']}")
    print(f"checks {len(results)}   passed {len(results) - len(failed)}   failed {len(failed)}")
    print(f"counts: accounts {e['accounts']}, flagged {e['flagged']}, "
          f"roles {dict(sorted(e['roles'].items()))}, cells {e['cells']}")
    for name, _, detail in failed:
        print(f"FAIL  {name}  {detail}")
    if "--samples" in sys.argv:
        for path, body in samples.items():
            print(f"\n{path}\n{json.dumps(trim(body), indent=1)[:1800]}")
    print("PASSED" if not failed else "FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
