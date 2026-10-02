"""
legal/diary.py -- the case diary: one printable A4 HTML page for a victim's
trace (PROJECT_CONTEXT.md Sections 15 and 4.5).

    build_diary(evidence, use_llm=True) -> {html, generator, llm, narrative, problems}
    write_diary(evidence, out_dir, use_llm=True)
    warm_model() -> {status, seconds}    load the model ahead of the first summary

The tables (total siphoned, layer-wise accounts with timestamps and amounts,
accounts recommended for freezing) are always filled by code from the evidence
object (legal\\evidence.py). The one-line entry of each transfer is written by
code too. Only the summary above those entries (3 to 5 sentences) may come
from the local model, and it never sees or writes a real value:

  1. TOKENISE   every account, amount, transaction, time and count of the
                trace gets a token (ACC_n, AMT_n, TXN_n, TIME_n, and for a
                count ACCOUNTS_n / TRANSFERS_n). The
                prompt holds tokens and role labels only. The evidence object
                carries no narration text, so none can enter a prompt.
  2. ASK        local Ollama (legal\\config.yaml: llm) for the summary alone.
                The prompt holds the totals, the layer counts and the timings,
                not the transfers; the answer length is capped
                (llm.num_predict). Loopback only.
  3. VALIDATE   the summary: 3 to 5 sentences, only the tokens it was given,
                a count only in a sentence that names what it counts, and no
                digit, currency sign or other figure outside a token. A count
                token stands for a phrase built by code ("1 account",
                "5 accounts", "1 transfer"): the model never picks the form,
                and may not put the noun after the token again.
                Every entry must name one transfer and carry exactly that
                transfer's time, accounts and amount; each transfer exactly
                once; a sentence may use only its own entry's tokens.
     SUBSTITUTE code swaps the tokens for the real values.
     VALIDATE   the finished page is read back as plain text: every account
                number, IFSC, amount, tx_id, timestamp and hash on it must be
                in the evidence, and nothing required may be missing.
  4. FALL BACK  Ollama down, timed out, wrong answer, or either validation
                failing -> the same page with template sentences (generator
                TEMPLATE_FALLBACK). The template narrative goes through the
                same two validations; if it fails, no document is written.

Generator labels: LLM+VALIDATED when the model's answer was used,
TEMPLATE_FALLBACK only after the model was asked and its answer was not used,
TEMPLATE when the model was not asked (use_llm=False).

Layers are the roles the trace read from `scores`, never the hop. The case
store (data\\cases.db) is not written here.

Usage:  .venv\\Scripts\\python.exe legal\\diary.py --victim SBIN10000294 --case TEST-1 --out %TEMP%\\diary
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

LEGAL_DIR = Path(__file__).resolve().parent
DIARY_TEMPLATE = "case_diary.html.j2"
if str(LEGAL_DIR) not in sys.path:
    sys.path.insert(0, str(LEGAL_DIR))

from evidence import GENERATOR_TEMPLATE, EvidenceError, build_evidence, load_legal_config  # noqa: E402
from notices import (  # noqa: E402
    ACCT_RE, AMOUNT_RE, HEX_RE, IFSC_RE, OUTSIDE_RE, TS_RE, _environment, _file_part,
    label_problems, rupees, visible_text)

GENERATOR_LLM = "LLM+VALIDATED"
GENERATOR_FALLBACK = "TEMPLATE_FALLBACK"
LOOPBACK = ("127.0.0.1", "localhost", "::1")
NO_ROLE = "no role assigned"

TOKEN_RE = re.compile(r"\b(ACC|AMT|TXN|TIME|ACCOUNTS|TRANSFERS)_\d+\b")
FIGURE_RE = re.compile(r"\d|\u20b9|\brs\b|\binr\b|\brupee", re.I)
# A count written out in words is a figure no token stands behind.
# The noun a count token already carries, written again after it.
COUNT_NOUN_RE = r"\W*(accounts?|transfers?|transactions?)\b"
NUMBER_WORD_RE = re.compile(
    r"\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen|twenty|thirty|forty|"
    r"fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|crores?|dozen|couple)\b", re.I)
MAX_SENTENCE = 400
MAX_SUMMARY = 700
SUMMARY_SENTENCES = (3, 5)
SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")
# Used when legal\config.yaml: llm does not set them.
DEFAULT_NUM_PREDICT = 200
DEFAULT_KEEP_ALIVE = "30m"


class DiaryError(Exception):
    """No valid diary could be built; nothing may be written."""


# --- 1. tokens ----------------------------------------------------------------

def tokenise(evidence: dict) -> dict:
    """Token maps for one case. Tokens are numbered in order of first use."""
    acc: dict[str, str] = {}
    amt: dict[int, str] = {}
    tim: dict[str, str] = {}
    counts: list[dict] = []        # one token per count, so equal counts stay apart

    def tok(table: dict, prefix: str, value):
        return table.setdefault(value, f"{prefix}_{len(table) + 1}")

    victim = evidence["victim"]
    tok(acc, "ACC", victim["acct_no"])
    tok(amt, "AMT", victim["paid_paise"])
    roles = {victim["acct_no"]: "VICTIM", **{a["acct_no"]: a["role"] for a in evidence["accounts"]}}
    transfers = []
    for i, t in enumerate(evidence["transfers"], start=1):
        transfers.append({
            "txn": f"TXN_{i}", "time": tok(tim, "TIME", t["ts"]),
            "from_account": tok(acc, "ACC", t["from"]), "to_account": tok(acc, "ACC", t["to"]),
            "amount": tok(amt, "AMT", t["amount_paise"]),
            "from_role": roles[t["from"]] or NO_ROLE, "to_role": roles[t["to"]] or NO_ROLE,
        })
    if not transfers:
        raise DiaryError("the trace has no transfer")

    def count(n: int, noun: str, near: list[str]) -> str:
        """A token for a count, named after its noun (ACCOUNTS_2). It stands for the
        number with the noun in the right form ("1 account", "5 accounts"); one of
        the `near` words, if any, must share its sentence."""
        counts.append({"token": f"{noun.upper()}S_{len(counts) + 1}", "near": near,
                       "phrase": f"{n} {noun}" if n == 1 else f"{n} {noun}s"})
        return counts[-1]["token"]

    transfer_count = count(len(transfers), "transfer", [])
    layers = [{"role": l["role"], "accounts": count(len(l["accounts"]), "account", [l["role"]])}
              for l in _layers(evidence)]
    freeze = {"accounts": count(len(evidence["freeze_candidates"]), "account", ["freez", "frozen"]),
              "holding": tok(amt, "AMT", evidence["totals"]["freeze_holding_total_paise"])}
    values = {**{v: k for k, v in acc.items()},
              **{v: rupees(k) for k, v in amt.items()},
              **{v: k for k, v in tim.items()},
              **{c["token"]: c["phrase"] for c in counts},
              **{t["txn"]: e["tx_id"] for t, e in zip(transfers, evidence["transfers"])}}
    return {
        "victim": acc[victim["acct_no"]], "total": amt[victim["paid_paise"]],
        "first_time": transfers[0]["time"], "last_time": transfers[-1]["time"],
        "transfers": transfers, "values": values,
        "transfer_count": transfer_count, "layers": layers, "freeze": freeze, "counts": counts,
        "role_labels": sorted({r for t in transfers for r in (t["from_role"], t["to_role"])}),
    }


def substitute(text: str, tokens: dict) -> str:
    return TOKEN_RE.sub(lambda m: tokens["values"][m.group(0)], text)


# --- 2. the local model -------------------------------------------------------

SYSTEM_PROMPT = (
    "You write the opening summary of a police case diary for a bank-fraud investigation. "
    "In the facts you are given, every account number, amount, time and count has been "
    "replaced by a token such as ACC_1, AMT_2, TIME_4, ACCOUNTS_3 or TRANSFERS_1. Copy tokens "
    "exactly as given.\n"
    "An ACCOUNTS or TRANSFERS token already is the number and its noun (it will read 'N accounts' "
    "or 'N transfers'): use it as the noun itself and never write the word account(s) or "
    "transfer(s) after it.\n"
    "Write 3 to 5 short, plain, factual English sentences in the past tense, one per item of "
    "`sentences`, in this order:\n"
    "1. The complainant's account paid the total amount between the time of the first transfer "
    "and the time of the last transfer.\n"
    "2. The money was traced onward, for example: 'The money was traced onward through TRANSFERS_x.'\n"
    "3. Every layer listed in the facts, none left out, each beside its own token, for example: "
    "'The money reached ACCOUNTS_x in layer NAME, ACCOUNTS_y in layer NAME and ACCOUNTS_z in "
    "layer NAME.'\n"
    "4. Freezing, for example: 'Freezing is recommended for ACCOUNTS_x, which hold AMT_y.'\n"
    "Rules:\n"
    "- Every count and amount must be written as its token, in a sentence that names what it counts.\n"
    "- Never write a digit, a number in words (such as 'three'), a currency sign, a date, a "
    "person's or bank's name, or a section of law.\n"
    "- Add no fact, opinion or conclusion that is not in the facts.")


def build_prompt(tokens: dict) -> str:
    """The facts the summary needs: totals, layer counts, timings. No transfer line."""
    lines = [f"Complainant's account: {tokens['victim']}",
             f"Total amount paid: {tokens['total']}",
             f"Time of first transfer: {tokens['first_time']}",
             f"Time of last transfer: {tokens['last_time']}",
             f"Transfers traced: {tokens['transfer_count']}"]
    lines += [f"Accounts in layer {l['role']}: {l['accounts']}" for l in tokens["layers"]]
    lines += [f"Accounts recommended for freezing: {tokens['freeze']['accounts']}",
              f"Amount held in those accounts: {tokens['freeze']['holding']}"]
    return "\n".join(lines)


def build_schema(tokens: dict) -> dict:
    low, high = SUMMARY_SENTENCES
    return {"type": "object", "additionalProperties": False, "required": ["sentences"],
            "properties": {"sentences": {"type": "array", "minItems": low, "maxItems": high,
                                         "items": {"type": "string"}}}}


def _post(llm: dict, route: str, body: dict) -> dict:
    host = urlparse(llm["url"]).hostname
    if host not in LOOPBACK:
        raise DiaryError(f"llm.url must be a loopback address, not {host!r}")
    req = urllib.request.Request(llm["url"].rstrip("/") + route, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=float(llm["timeout_seconds"])) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ask_ollama(tokens: dict, llm: dict) -> dict:
    """One request to the local model -> {"summary": text}. Raises on anything
    but the JSON asked for."""
    answer = _post(llm, "/api/chat", {
        "model": llm["model"], "stream": False, "format": build_schema(tokens),
        "keep_alive": llm.get("keep_alive", DEFAULT_KEEP_ALIVE),
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": build_prompt(tokens)}],
        "options": {"temperature": 0, "seed": 0,
                    "num_predict": int(llm.get("num_predict", DEFAULT_NUM_PREDICT))},
    })
    sentences = json.loads(answer["message"]["content"])["sentences"]
    return {"summary": " ".join(x.strip() for x in sentences)}


def warm_model(llm: dict | None = None) -> dict:
    """Load the model and keep it loaded (llm.keep_alive), so the first summary
    has no cold start. Never raises: a model that cannot be warmed is asked later
    as usual, and the diary falls back to the template if it still fails."""
    t0 = time.perf_counter()
    try:
        llm = llm or load_legal_config()["llm"]
        _post(llm, "/api/generate", {"model": llm["model"],
                                     "keep_alive": llm.get("keep_alive", DEFAULT_KEEP_ALIVE)})
        status = f"loaded {llm['model']}"
    except (DiaryError, EvidenceError, OSError, ValueError, KeyError, TypeError) as e:
        status = f"not loaded ({getattr(e, 'reason', e)})"
    return {"status": status, "seconds": time.perf_counter() - t0}


# --- 3. narrative: template, validation ---------------------------------------

def template_narrative(tokens: dict) -> dict:
    """The fallback narrative, in the same token form the model must return."""
    return {
        "summary": (f"The complainant's account {tokens['victim']} paid {tokens['total']} between "
                    f"{tokens['first_time']} and {tokens['last_time']}. The money was traced onward "
                    f"through {tokens['transfer_count']}. These transfers are set out "
                    f"below in the order in which they took place."),
        "entries": [{**{k: t[k] for k in ("txn", "time", "from_account", "to_account", "amount")},
                     "sentence": (f"{t['amount']} was transferred from account {t['from_account']} "
                                  f"({t['from_role']}) to account {t['to_account']} ({t['to_role']}) "
                                  f"by transaction {t['txn']}.")}
                    for t in tokens["transfers"]],
    }


def _text_problems(text, allowed: set, required: set, roles: set, all_roles: list, limit: int) -> list[str]:
    if not isinstance(text, str) or not text.strip():
        return ["empty text"]
    if len(text) > limit:
        return [f"text longer than {limit} characters"]
    out = []
    used = {m.group(0) for m in TOKEN_RE.finditer(text)}
    if used - allowed:
        out.append(f"uses tokens of another line: {sorted(used - allowed)}")
    if required - used:
        out.append(f"does not mention {sorted(required - used)}")
    rest = TOKEN_RE.sub(" ", text)
    for label in sorted(all_roles, key=len, reverse=True):
        pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(label)}(?![A-Za-z0-9_])")
        if pattern.search(rest) and label not in roles:
            out.append(f"gives a role ({label}) that neither account has")
        rest = pattern.sub(" ", rest)
    if FIGURE_RE.search(rest):
        out.append("contains a figure outside a token")
    return out


def _summary_problems(text, tokens: dict, all_roles: list, complete: bool) -> list[str]:
    """The summary may use the tokens of the prompt only, in 3 to 5 sentences; a
    count may stand only in a sentence that names what it counts. `complete`:
    every count must be told (a layer left out would understate the trace)."""
    allowed = {tokens["victim"], tokens["total"], tokens["first_time"], tokens["last_time"],
               tokens["freeze"]["holding"], *(c["token"] for c in tokens["counts"])}
    required = {tokens["victim"], tokens["total"], *(c["token"] for c in tokens["counts"] if complete)}
    out = _text_problems(text, allowed, required,
                         set(all_roles) | {NO_ROLE}, all_roles, MAX_SUMMARY)
    if not isinstance(text, str) or not text.strip():
        return out
    if NUMBER_WORD_RE.search(text):
        out.append(f"contains a number in words ({NUMBER_WORD_RE.search(text).group(0)})")
    sentences = [x for x in SENTENCE_END_RE.split(text.strip()) if x]
    low, high = SUMMARY_SENTENCES
    if not low <= len(sentences) <= high:
        out.append(f"{len(sentences)} sentences, not {low} to {high}")
    for c in tokens["counts"]:
        if re.search(rf"\b{c['token']}\b{COUNT_NOUN_RE}", text, re.I):
            out.append(f"{c['token']} is followed by the noun it already carries")
        if not c["near"]:
            continue
        here = [x for x in sentences if re.search(rf"\b{c['token']}\b", x)]
        near = re.compile("|".join(rf"(?<![A-Za-z0-9_]){re.escape(w)}" for w in c["near"]), re.I)
        if any(not near.search(TOKEN_RE.sub(" ", x)) for x in here):
            out.append(f"{c['token']} is not said of {' / '.join(c['near'])}")
    return out


def validate_narrative(narrative, tokens: dict, complete: bool = False) -> list[str]:
    """Problems in a tokenised narrative; empty when it may be substituted.
    `complete` is asked of the model's summary: it must tell every count."""
    if not isinstance(narrative, dict) or not isinstance(narrative.get("entries"), list):
        return ["not an object with a list of entries"]
    by_txn = {t["txn"]: t for t in tokens["transfers"]}
    all_roles = [r for r in tokens["role_labels"] if r != NO_ROLE] + ["VICTIM"]
    problems = [f"summary: {p}" for p in _summary_problems(
        narrative.get("summary"), tokens, all_roles, complete)]
    seen: list[str] = []
    for i, e in enumerate(narrative["entries"], start=1):
        t = by_txn.get(e.get("txn")) if isinstance(e, dict) else None
        if t is None:
            problems.append(f"entry {i}: unknown transaction {e.get('txn') if isinstance(e, dict) else e!r}")
            continue
        seen.append(t["txn"])
        wrong = [k for k in ("time", "from_account", "to_account", "amount") if e.get(k) != t[k]]
        if wrong:
            problems.append(f"entry {i} ({t['txn']}): {', '.join(wrong)} not that transfer's")
        fields = {t[k] for k in ("txn", "time", "from_account", "to_account", "amount")}
        problems += [f"entry {i} ({t['txn']}): {p}" for p in _text_problems(
            e.get("sentence"), fields, {t["from_account"], t["to_account"], t["amount"]},
            {t["from_role"], t["to_role"]}, all_roles, MAX_SENTENCE)]
    if sorted(seen) != sorted(by_txn):
        missing = sorted(set(by_txn) - set(seen))
        repeated = sorted({x for x in seen if seen.count(x) > 1})
        problems.append(f"transfers not covered exactly once (missing {missing}, repeated {repeated})")
    return problems


def _narrative_values(narrative: dict, tokens: dict, evidence: dict) -> dict:
    """Tokens out, real values in; entries in the order of the trace."""
    order = {t["txn"]: i for i, t in enumerate(tokens["transfers"])}
    return {
        "summary": substitute(narrative["summary"], tokens),
        "entries": [{"ts": evidence["transfers"][order[e["txn"]]]["ts"],
                     "text": substitute(e["sentence"], tokens)}
                    for e in sorted(narrative["entries"], key=lambda e: order[e["txn"]])],
    }


# --- 3b. the finished page ----------------------------------------------------

def evidence_problems(text: str, evidence: dict, doc: str = "diary") -> list[str]:
    """Every account, IFSC, tx_id, timestamp, amount and hash in a page's visible
    text against the whole trace (the diary and the FIR annexure show all of it)."""
    problems: list[str] = []

    def only(what: str, found: set, allowed: set, required: set) -> None:
        if found - allowed:
            problems.append(f"{what} not in the evidence: {sorted(found - allowed)[:3]}")
        if required - found:
            problems.append(f"{what} missing from the {doc}: {sorted(required - found)[:3]}")

    accounts = {evidence["victim"]["acct_no"], *(a["acct_no"] for a in evidence["accounts"])}
    only("account", set(ACCT_RE.findall(text)), accounts, accounts)
    ifsc = {evidence["victim"]["ifsc"], *(a["ifsc"] for a in evidence["accounts"])}
    only("IFSC", set(IFSC_RE.findall(text)), ifsc, {a["ifsc"] for a in evidence["accounts"]})

    tx_ids = {t["tx_id"] for t in evidence["transfers"]}
    words = set(re.findall(r"[A-Za-z0-9_-]+", text))
    shapes = {re.sub(r"\d", "9", t) for t in tx_ids}
    look_alike = {w for w in words if re.sub(r"\d", "9", w) in shapes}
    only("tx_id", look_alike - set(ACCT_RE.findall(text)) - set(IFSC_RE.findall(text)) | (words & tx_ids),
         tx_ids, tx_ids)

    stamps = {t["ts"] for t in evidence["transfers"]}
    only("timestamp", set(TS_RE.findall(text)),
         stamps | {evidence["trace"]["first_ts"], evidence["trace"]["last_ts"], evidence["generated_at"][:19]},
         stamps)

    paise = {int(w.replace(",", "")) * 100 + int(f) for w, f in AMOUNT_RE.findall(text)}
    allowed = set(evidence["totals"].values())
    required = {evidence["totals"]["paid_paise"], evidence["totals"]["freeze_holding_total_paise"]}
    for t in evidence["transfers"]:
        allowed |= {t["amount_paise"], t["tainted_paise"]}
        required |= {t["amount_paise"]}
    for a in evidence["accounts"]:
        allowed |= {a["tainted_in_paise"], a["tainted_out_paise"], a["untraced_out_paise"], a["holding_paise"]}
    required |= {c["holding_paise"] for c in evidence["freeze_candidates"]}
    only("amount (paise)", paise, allowed, required)
    if text.count("\u20b9") != len(AMOUNT_RE.findall(text)):
        problems.append("a rupee sign is not followed by a readable amount")

    hashes = {evidence["fingerprint"], evidence["dataset"]["sha256"]}
    only("hash", set(HEX_RE.findall(text)), hashes, hashes)
    if TOKEN_RE.search(text):
        problems.append(f"token left on the page: {TOKEN_RE.search(text).group(0)}")
    return problems


def validate_html(page: str, evidence: dict) -> list[str]:
    """Problems on a rendered diary, read as plain text against the evidence."""
    text = visible_text(page)
    problems = evidence_problems(text, evidence) + label_problems(text, evidence)
    for name, needle in (("draft label", evidence["legal"]["draft_label"]),
                         ("case-diary legal reference", evidence["legal"]["case_diary"]),
                         ("case id", evidence["case_id"]), ("profile id", evidence["profile_id"]),
                         ("section: total siphoned", "Total siphoned"),
                         ("section: layer-wise accounts", "Layer-wise accounts"),
                         ("section: accounts recommended for freezing", "Accounts recommended for freezing")):
        if needle not in text:
            problems.append(f"{name} is not on the diary")
    if OUTSIDE_RE.search(page):
        problems.append("the page loads an outside resource")
    return problems


def _layers(evidence: dict) -> list[dict]:
    """Accounts grouped by the role read from scores, in the order the money
    first reached each role in this trace. The hop is never used."""
    by_acct = {a["acct_no"]: a for a in evidence["accounts"]}
    layers: dict[str, dict] = {}
    for t in evidence["transfers"]:                       # oldest first
        label = by_acct[t["to"]]["role"] or NO_ROLE
        layer = layers.setdefault(label, {"role": label, "accounts": [], "receipts": []})
        layer["receipts"].append(t)
        if by_acct[t["to"]] not in layer["accounts"]:
            layer["accounts"].append(by_acct[t["to"]])
    return list(layers.values())


def render(evidence: dict, narrative: dict) -> str:
    return _environment().get_template(DIARY_TEMPLATE).render(
        ev=evidence, narrative=narrative, layers=_layers(evidence))


# --- 4. build, with the fallback ----------------------------------------------

def _attempt(evidence: dict, tokens: dict, narrative, generator: str) -> tuple[str | None, list[str]]:
    problems = validate_narrative(narrative, tokens, complete=generator == GENERATOR_LLM)
    if problems:
        return None, problems
    ev = {**evidence, "generator": generator}
    page = render(ev, _narrative_values(narrative, tokens, evidence))
    problems = validate_html(page, ev)
    return (None if problems else page), problems


def build_diary(evidence: dict, use_llm: bool = True, llm_cfg: dict | None = None) -> dict:
    """llm_cfg replaces legal\\config.yaml: llm (used to time another model)."""
    tokens = tokenise(evidence)
    llm = {"status": "not asked", "seconds": 0.0, "problems": []}
    if use_llm:
        cfg = llm_cfg or load_legal_config()["llm"]
        t0 = time.perf_counter()
        try:
            # The model writes the summary; the entries stay the code's.
            answer = {**template_narrative(tokens), "summary": ask_ollama(tokens, cfg)["summary"]}
        except (TimeoutError, urllib.error.URLError, OSError) as e:
            reason = getattr(e, "reason", e)
            timed_out = isinstance(e, TimeoutError) or isinstance(reason, TimeoutError)
            llm["status"] = (f"timed out after {cfg['timeout_seconds']} s" if timed_out
                             else f"unreachable ({reason})")
        except (ValueError, KeyError, TypeError) as e:
            llm["status"] = f"answer was not the JSON asked for ({type(e).__name__})"
        else:
            page, problems = _attempt(evidence, tokens, answer, GENERATOR_LLM)
            llm["status"] = "validated" if page else "rejected by validation"
            llm["problems"] = problems
        llm["seconds"] = time.perf_counter() - t0
        if llm["status"] == "validated":
            return {"html": page, "generator": GENERATOR_LLM, "llm": llm, "problems": [],
                    "narrative": _narrative_values(answer, tokens, evidence)}

    generator = GENERATOR_FALLBACK if use_llm else GENERATOR_TEMPLATE
    page, problems = _attempt(evidence, tokens, template_narrative(tokens), generator)
    if page is None:
        raise DiaryError(f"the template diary failed validation: {problems}")
    return {"html": page, "generator": generator, "llm": llm, "problems": [],
            "narrative": _narrative_values(template_narrative(tokens), tokens, evidence)}


def write_diary(evidence: dict, out_dir: Path, use_llm: bool = True) -> dict:
    result = build_diary(evidence, use_llm)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"case_diary_{_file_part(evidence['case_id'])}.html"
    data = result["html"].encode("utf-8")
    path.write_bytes(data)
    return {**result, "path": path, "sha256": hashlib.sha256(data).hexdigest()}


def main() -> None:
    ap = argparse.ArgumentParser(description="Write the case diary for a victim's trace.")
    ap.add_argument("--victim", required=True, help="victim account number")
    ap.add_argument("--case", required=True, help="case id")
    ap.add_argument("--fir", default=None, help="FIR number, if registered")
    ap.add_argument("--out", type=Path, required=True, help="folder to write the HTML file to")
    ap.add_argument("--db", type=Path, default=None, help="DuckDB file to read")
    ap.add_argument("--no-llm", action="store_true", help="template narrative only")
    args = ap.parse_args()

    t0 = time.perf_counter()
    try:
        ev = build_evidence(args.victim, args.case, args.fir, args.db)
        r = write_diary(ev, args.out, use_llm=not args.no_llm)
    except (EvidenceError, DiaryError) as e:
        raise SystemExit(f"diary: {e}")
    print(f"runtime {time.perf_counter() - t0:.2f} s   case {ev['case_id']}   victim {ev['victim']['acct_no']}")
    print(f"generator   {r['generator']}")
    print(f"LLM         {r['llm']['status']}   {r['llm']['seconds']:.1f} s")
    for p in r["llm"]["problems"][:10]:
        print(f"  rejected: {p}")
    print(f"validation  page passed ({len(ev['transfers'])} transfers, {len(ev['accounts'])} accounts, "
          f"{len(ev['freeze_candidates'])} to freeze)")
    print(f"file        {r['path']}")
    print(f"fingerprint {ev['fingerprint']}")


if __name__ == "__main__":
    main()
