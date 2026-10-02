"""
audits/check_diary.py -- checks Step 8c: the case diary (legal\\diary.py)
against the evidence (PROJECT_CONTEXT.md Sections 15 and 4.5).

Read-only: nothing is written to data\\cases.db or to disk.

For one victim (--victim) two diaries are built in memory:
    A  the normal path: local Ollama is asked; whatever generator results
       (LLM+VALIDATED, or TEMPLATE_FALLBACK if Ollama is down, slow or wrong)
    B  the template path, model not asked (TEMPLATE)
and both pages are run through the validator, which must find nothing.

Then the validator itself is tested -- it must REJECT:
    pages       a wrong amount, an unknown account, an unknown tx_id, a wrong
                timestamp, a wrong hash, a token left on the page, the DRAFT
                label removed (each on a copy of A and of B)
    narratives  (the token form) a wrong amount token, an unknown account
                token, a figure written outside a token, a token of another
                line, a role neither account has, a transfer left out, a
                transfer told twice; a summary of 2 or of 6 sentences, with a
                number in words, with a transaction token, with the noun
                written again after a count token, or with a layer's count
                said of another layer
    counts      every count token stands for a phrase with the right noun
                form ("1 account", "5 accounts", "1 transfer")

Also checked:
    prompt      the text and schema sent to the model hold no real account
                number, IFSC, tx_id, timestamp or amount of the case, and no
                transfer (TXN token); the answer length is capped
    all victims the template diary of EVERY send-only account validates

Usage:  .venv\\Scripts\\python.exe audits\\check_diary.py [--victim SBIN10000294] [--db PATH]
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "legal"))

import victim_trace  # noqa: E402
import diary  # noqa: E402
from evidence import build_evidence, load_legal_config  # noqa: E402
from notices import rupees  # noqa: E402

CASE_ID = "AUDIT-CASE-8C"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(ok), detail))


def unknown_account(ev: dict) -> str:
    """An account-shaped string that is not in this case: a known one, digits reversed until new."""
    known = {ev["victim"]["acct_no"], *(a["acct_no"] for a in ev["accounts"])}
    base = ev["accounts"][0]["acct_no"]
    return next(c for c in (base[:4] + f"{(int(base[4:]) + k) % 10**8:08d}" for k in range(1, 10**4))
                if c not in known)


def page_tampers(page: str, ev: dict) -> dict[str, str]:
    t = ev["transfers"][-1]
    amounts = {x for tr in ev["transfers"] for x in (tr["amount_paise"], tr["tainted_paise"])}
    amounts |= set(ev["totals"].values())
    amounts |= {a[k] for a in ev["accounts"] for k in
                ("tainted_in_paise", "tainted_out_paise", "untraced_out_paise", "holding_paise")}
    wrong_paise = next(t["amount_paise"] + k for k in range(1, 10**4) if t["amount_paise"] + k not in amounts)
    wrong_ts = t["ts"][:-2] + f"{(int(t['ts'][-2:]) + 1) % 60:02d}"
    wrong_tx = t["tx_id"][:-1] + str((int(t["tx_id"][-1]) + 1) % 10)
    known_tx = {x["tx_id"] for x in ev["transfers"]}
    known_ts = {x["ts"] for x in ev["transfers"]}
    assert wrong_tx not in known_tx and wrong_ts not in known_ts
    return {
        "wrong amount": page.replace(rupees(t["amount_paise"]), rupees(wrong_paise)),
        "unknown account": page.replace(t["to"], unknown_account(ev)),
        "unknown account added": page.replace("</h1>", f"</h1><p>{unknown_account(ev)}</p>", 1),
        "unknown tx_id": page.replace(t["tx_id"], wrong_tx),
        "wrong timestamp": page.replace(t["ts"], wrong_ts),
        "wrong hash": page.replace(ev["fingerprint"], "0" * 64),
        "token left on the page": page.replace("</h1>", "</h1><p>ACC_1</p>", 1),
        "DRAFT label removed": page.replace(ev["legal"]["draft_label"], ""),
    }


def narrative_tampers(tokens: dict) -> dict[str, dict]:
    good = diary.template_narrative(tokens)
    first, last = tokens["transfers"][0], tokens["transfers"][-1]
    other_amount = next(t["amount"] for t in tokens["transfers"] if t["amount"] != last["amount"])
    other_account = next(t["to_account"] for t in tokens["transfers"]
                         if t["to_account"] not in (last["from_account"], last["to_account"]))
    other_role = next((r for r in tokens["role_labels"] + ["VICTIM"]
                       if r not in (last["from_role"], last["to_role"], diary.NO_ROLE)), None)

    def edit(fn) -> dict:
        n = copy.deepcopy(good)
        fn(n)
        return n

    out = {
        "wrong amount token": edit(lambda n: n["entries"][-1].update(
            amount=other_amount, sentence=n["entries"][-1]["sentence"].replace(last["amount"], other_amount))),
        "unknown account token": edit(lambda n: n["entries"][-1].update(
            to_account="ACC_999", sentence=n["entries"][-1]["sentence"].replace(last["to_account"], "ACC_999"))),
        "figure outside a token": edit(lambda n: n["entries"][-1].update(
            sentence=n["entries"][-1]["sentence"] + " The sum was 50000 rupees.")),
        "token of another line": edit(lambda n: n["entries"][-1].update(
            sentence=n["entries"][-1]["sentence"] + f" It then went to {other_account}.")),
        "transfer left out": edit(lambda n: n["entries"].pop()),
        "transfer told twice": edit(lambda n: n["entries"].append(copy.deepcopy(n["entries"][0]))),
        "figure in the summary": edit(lambda n: n.update(summary=n["summary"] + " In all 11 accounts took part.")),
        "a summary of 2 sentences": edit(lambda n: n.update(summary=" ".join(n["summary"].split(". ")[:2]))),
        "a summary of 6 sentences": edit(lambda n: n.update(summary=n["summary"] + " It was so." * 3)),
        "a number in words in the summary": edit(lambda n: n.update(
            summary=n["summary"].replace(tokens["transfer_count"], "fourteen"))),
        "a transaction token in the summary": edit(lambda n: n.update(
            summary=n["summary"].replace("These transfers", f"These transfers, such as {last['txn']},"))),
    }
    if len(tokens["layers"]) > 1:
        a, b = tokens["layers"][0], tokens["layers"][1]
        out["a layer's count said of another layer"] = edit(lambda n: n.update(
            summary=n["summary"] + f" Layer {a['role']} had {b['accounts']}."))
    out["the noun written again after a count token"] = edit(lambda n: n.update(
        summary=n["summary"].replace(tokens["transfer_count"], tokens["transfer_count"] + " transfers")))
    if other_role:
        out["role neither account has"] = edit(lambda n: n["entries"][-1].update(
            sentence=n["entries"][-1]["sentence"] + f" The receiver is {other_role}."))
    assert first["txn"] != last["txn"]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Check the case diary and its validator.")
    ap.add_argument("--victim", default="SBIN10000294", help="victim account for the two diaries")
    ap.add_argument("--db", type=Path, default=victim_trace.DEFAULT_DB, help="DuckDB file to read")
    args = ap.parse_args()

    t0 = time.perf_counter()
    ev = build_evidence(args.victim, CASE_ID, db=args.db)
    tokens = diary.tokenise(ev)

    # The two outputs.
    runs = {"A (Ollama asked)": diary.build_diary(ev, use_llm=True),
            "B (template only)": diary.build_diary(ev, use_llm=False)}
    check("B is TEMPLATE (model not asked)", runs["B (template only)"]["generator"] == diary.GENERATOR_TEMPLATE)
    check("a page stored under another label than it prints is rejected", bool(diary.validate_html(
        runs["B (template only)"]["html"], {**ev, "generator": diary.GENERATOR_FALLBACK})))
    for name, r in runs.items():
        ev_r = {**ev, "generator": r["generator"]}
        problems = diary.validate_html(r["html"], ev_r)
        check(f"{name}: validator passes the page", not problems, "; ".join(problems[:3]))
        for what, page in page_tampers(r["html"], ev_r).items():
            check(f"{name}: page with {what} is rejected", bool(diary.validate_html(page, ev_r)))

    # The narrative validator.
    check("template narrative is accepted", not diary.validate_narrative(diary.template_narrative(tokens), tokens))
    for what, narrative in narrative_tampers(tokens).items():
        check(f"narrative with {what} is rejected", bool(diary.validate_narrative(narrative, tokens)))
    check("a model summary that leaves a layer out is rejected",
          bool(diary.validate_narrative(diary.template_narrative(tokens), tokens, complete=True)))

    # Nothing real in what the model is sent.
    sent = diary.SYSTEM_PROMPT + diary.build_prompt(tokens) + json.dumps(diary.build_schema(tokens))
    real = {ev["victim"]["acct_no"], ev["victim"]["ifsc"]}
    real |= {a[k] for a in ev["accounts"] for k in ("acct_no", "ifsc")}
    for t in ev["transfers"]:
        real |= {t["tx_id"], t["ts"], t["ts"][:10], t["ts"][11:], str(t["amount_paise"]),
                 rupees(t["amount_paise"]), rupees(t["amount_paise"])[1:]}
    leaked = sorted(v for v in real if v in sent)
    check("prompt and schema hold no real value", not leaked, str(leaked[:3]))
    check("prompt holds no transfer", "TXN_" not in sent)
    phrases = {c["token"]: tokens["values"][c["token"]] for c in tokens["counts"]}
    wanted = {tokens["transfer_count"]: (len(ev["transfers"]), "transfer"),
              tokens["freeze"]["accounts"]: (len(ev["freeze_candidates"]), "account"),
              **{l["accounts"]: (len(x["accounts"]), "account")
                 for l, x in zip(tokens["layers"], diary._layers(ev))}}
    check("count tokens stand for number + noun in the right form",
          phrases == {t: f"{n} {noun}{'' if n == 1 else 's'}" for t, (n, noun) in wanted.items()},
          str(phrases))
    check("answer length is capped (llm.num_predict)",
          0 < int(load_legal_config()["llm"].get("num_predict", 0)) <= 400)

    # Every victim's template diary validates.
    con = duckdb.connect(str(args.db), read_only=True)
    try:
        victims = [r[0] for r in con.execute(
            "SELECT a.acct_no FROM accounts a "
            "WHERE a.acct_id IN (SELECT src FROM tx) AND a.acct_id NOT IN (SELECT dst FROM tx) "
            "ORDER BY a.acct_no").fetchall()]
    finally:
        con.close()
    bad = []
    for v in victims:
        try:
            diary.build_diary(build_evidence(v, CASE_ID, db=args.db), use_llm=False)
        except Exception as e:  # noqa: BLE001 -- any failure is a finding
            bad.append(f"{v}: {e}")
    check(f"template diary validates for all {len(victims)} send-only accounts", not bad, "; ".join(bad[:2]))

    failed = [r for r in RESULTS if not r[1]]
    print(f"runtime {time.perf_counter() - t0:.2f} s   victim {args.victim}   "
          f"{len(ev['transfers'])} transfers, {len(ev['accounts'])} accounts")
    print(f"model {load_legal_config()['llm']['model']}")
    print(f"{'RUN':<20} {'GENERATOR':<18} {'LLM':<28} {'LLM TIME':>9}  PAGE")
    for name, r in runs.items():
        ok = not diary.validate_html(r["html"], {**ev, "generator": r["generator"]})
        print(f"{name:<20} {r['generator']:<18} {r['llm']['status'][:28]:<28} {r['llm']['seconds']:>7.1f} s  "
              f"{'valid' if ok else 'INVALID'}")
    for p in runs["A (Ollama asked)"]["llm"]["problems"][:5]:
        print(f"  model answer rejected: {p}")
    print(f"tampered pages rejected       "
          f"{sum(1 for n, ok, _ in RESULTS if 'page with' in n and ok)}/{sum(1 for n, _, _ in RESULTS if 'page with' in n)}")
    print(f"tampered narratives rejected  "
          f"{sum(1 for n, ok, _ in RESULTS if 'narrative with' in n and ok)}/{sum(1 for n, _, _ in RESULTS if 'narrative with' in n)}")
    print(f"template diaries, all victims {len(victims) - len(bad)}/{len(victims)}")
    print(f"checks {len(RESULTS)}   failed {len(failed)}")
    for name, _, detail in failed:
        print(f"FAIL  {name}  {detail}")
    if failed:
        raise SystemExit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
