"""
engine/victim_trace.py -- Step 5 of the Abhedya-Chakra pipeline: the victim trace.

    trace_victim(acct_no, db=None)       ->  plain dict (JSON-ready, for the API)
    trace_victims([acct_no, ...])        ->  one merged graph, taint per victim
    reverse_trace_cell(cell_id)          ->  the victims that paid a cell's L1
    reverse_trace_network(network_id)    ->  the victims of a whole network
    cell_summary(cell_id)                ->  victims, money, mules, freeze list

Follows a victim's money through the transaction graph (PROJECT_CONTEXT.md
Section 4.4) and says, for every account it reaches, how much of THIS victim's
money arrived, how much was passed on and how much is still held.

HOW A HOP IS FOLLOWED
  * layer_links first. If the account has proven layer links leaving inside its
    pass-through window after tainted money arrived, exactly those transfers
    are followed. The window is the one links.py proved the link in: the
    split-forward window for an L1 candidate, the single-forward window
    otherwise.
  * Fallback, only where no such link exists: outflows that leave AFTER the
    tainted money arrived, inside the profile's trace.fallback_window. Every
    such transfer to a flagged receiver is followed; then unflagged receivers,
    ranked by final_index and then amount, until trace.coverage_target of the
    remaining tainted amount is covered.
  * The victim's own payments are different (Section 4.4 step 0). With no
    layer link, payments to flagged receivers are followed. If there is none,
    only the payment(s) with the highest L1 edge score are followed, marked
    low confidence. Coverage is never filled from the victim's other payments;
    they are reported as payments_not_followed.
  * Stops at receive-only accounts and at trace.max_hops (default 4).
    trace.max_accounts caps a very connected account (result: truncated).

PRO-RATA TAINT (per account, per victim)
  Inside the window the account is a running pool. Every inflow adds to it --
  this victim's money as tainted, anyone else's as clean. Every outflow takes
  tainted and clean money out in the pool's current proportion, so when two
  victims' money mixes in one mule each onward transfer carries each victim's
  share, and a forward made out of order still carries the right share
  (Section 4.6). The pool starts empty at the first tainted arrival; no earlier
  balance is assumed.
      tainted_in   this victim's money that arrived
      tainted_out  the part carried on by the transfers the trace followed
      untraced_out the part that left on transfers the trace did not follow
      holding      tainted_in - tainted_out - untraced_out  (freeze priority)
  All amounts are integer paise.

OUTPUT (Section 4.4)
  per_hop            accounts, transfers, tainted amount moved, minutes since
                     the previous hop
  findings           {pattern, confidence, evidence, accounts, tx_keys, tx_ids,
                     hop_range}: RAPID_PASS_THROUGH, SCATTER, FUNNEL,
                     SCATTER_GATHER, CYCLE (only if present). Cut-offs come from
                     the profile; every number in an evidence sentence comes
                     from this trace. confidence is high when every transfer of
                     the pattern is a proven layer link, low when one was
                     chosen by the L1 edge score, medium otherwise.
  summary            totals, the reconciliation, and who / how / why / when
  freeze_candidates  freeze_recommended accounts still holding this victim's
                     money, largest first, with the transfers proving receipt
  fingerprint        SHA-256 of the trace's sorted tx_keys

WHAT IS NEVER DONE
  * role, final_index, band and reasons are READ from `scores`. `hop` is only
    the distance at which an account was first reached -- no role, score or
    window is ever derived from it (guardrail 11).
  * tx_key is a unique key and the fingerprint input, never an order or
    adjacency signal (Section 4.6). No ground-truth labels, IP prefixes or
    account-number ranges.
  * The per-account loops below run over the handful of transfers of ONE traced
    account, read as CSR slices -- never over the transaction table.

The CSR arrays (engine/graph.py) and the per-profile lookups are loaded once per
process and reused; they are reloaded when the database file changes.

Usage:
    .venv\\Scripts\\python.exe engine\\victim_trace.py --victim HDFC12345678
    .venv\\Scripts\\python.exe engine\\victim_trace.py --victim HDFC12345678 --json
    .venv\\Scripts\\python.exe engine\\victim_trace.py --victims HDFC12345678,SBIN12345678
    .venv\\Scripts\\python.exe engine\\victim_trace.py --cell 7
    .venv\\Scripts\\python.exe engine\\victim_trace.py --network 1
    .venv\\Scripts\\python.exe engine\\victim_trace.py --cell-summary 7
    .venv\\Scripts\\python.exe engine\\victim_trace.py --victim HDFC12345678 --db %TEMP%\\case_review.duckdb
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np

# Same directory as this script: shared helpers, never re-implemented.
import graph
from features import active_profile, sql_params

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"

MEMORY_LIMIT = "3GB"

NOT_FOUND = {"found": False, "message": "No transaction graph found"}

# Columns of `scores` shown for every traced account. ring_id is the network
# (the connected component); cells come from cell_members. band is a confidence
# label only -- the freeze decision is freeze_recommended.
DETAIL_SQL = (
    "SELECT s.acct_id, s.role, s.role_confirmed, s.final_index, s.mule_index, "
    "       s.trust_index, s.band, s.is_flagged, s.ring_id, s.reasons, "
    "       s.freeze_recommended, s.holding_paise, s.victim_score "
    "FROM scores s WHERE s.profile_id = ?")

_CONTEXTS: dict[tuple, "Context"] = {}


class Context:
    """Everything a trace needs, loaded once: graph arrays and profile lookups."""

    def __init__(self, db: Path):
        self.db = Path(db)
        if not self.db.is_file():
            raise SystemExit(f"database not found: {self.db} -- run engine\\ingest.py first")
        self.g = graph.load(self.db)

        con = duckdb.connect(str(self.db), read_only=True)
        try:
            con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
            self.profile_id, profile = active_profile(con)

            a = con.execute(
                "SELECT acct_id, acct_no, bank FROM accounts ORDER BY acct_id").fetchnumpy()
            self.n = len(a["acct_id"])
            if self.n != len(self.g["out_ptr"]) - 1:
                raise SystemExit("graph arrays do not match accounts -- run engine\\graph.py --force")
            self.acct_no = [str(x) for x in a["acct_no"]]
            self.bank = [None if x is None else str(x) for x in a["bank"]]
            self.id_of = {no: i for i, no in enumerate(self.acct_no)}

            f = con.execute(
                "SELECT acct_id, is_receive_only FROM features").fetchnumpy()
            self.receive_only = np.zeros(self.n, dtype=bool)
            self.receive_only[np.asarray(f["acct_id"])] = np.asarray(f["is_receive_only"], dtype=bool)

            s = con.execute(
                "SELECT acct_id, final_index, is_flagged FROM scores WHERE profile_id = ?",
                [self.profile_id]).fetchnumpy()
            if not len(s["acct_id"]):
                raise SystemExit(
                    f"no scores for profile {self.profile_id} -- run engine\\scoring.py first")
            # An account with no score ranks last in the fallback; it is never
            # given a default risk (guardrail 11).
            self.final = np.full(self.n, -1.0)
            self.final[np.asarray(s["acct_id"])] = np.asarray(s["final_index"], dtype=float)
            # Flag as scoring wrote it; an account with no score is not flagged.
            self.flagged = np.zeros(self.n, dtype=bool)
            self.flagged[np.asarray(s["acct_id"])] = np.ma.filled(s["is_flagged"], False).astype(bool)

            # Cells of each account (an account can be in several). Built by
            # rings.py, which must be rerun after every scoring run.
            if not con.execute(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema='main' AND table_name='cell_members'").fetchone()[0]:
                raise SystemExit("table cell_members is missing -- run engine\\apply_schema.py "
                                 "and engine\\rings.py first")
            self.cells: dict[int, list[int]] = dict(con.execute(
                "SELECT acct_id, list(cell_id ORDER BY cell_id) FROM cell_members "
                "WHERE profile_id = ? GROUP BY acct_id", [self.profile_id]).fetchall())
            if not self.cells:
                raise SystemExit(
                    f"no cells for profile {self.profile_id} -- run engine\\rings.py first")
            cell_cols = ("cell_id", "network_id", "l1_acct", "size", "victim_count",
                         "total_in_paise", "holding_paise", "first_ts", "last_ts",
                         "patterns", "fingerprint")
            self.cell_info: dict[int, dict] = {}
            for row in con.execute(
                    f"SELECT {', '.join(cell_cols)} FROM cells WHERE profile_id = ?",
                    [self.profile_id]).fetchall():
                c = dict(zip(cell_cols, row))
                c["first_ts"], c["last_ts"] = str(c["first_ts"]), str(c["last_ts"])
                self.cell_info[c["cell_id"]] = c
            self.cell_accts: dict[int, list[int]] = dict(con.execute(
                "SELECT cell_id, list(acct_id ORDER BY acct_id) FROM cell_members "
                "WHERE profile_id = ? GROUP BY cell_id", [self.profile_id]).fetchall())

            # Details are kept for the accounts that carry a role or a flag;
            # any other account a fallback reaches is looked up on demand.
            self.details: dict[int, dict] = {}
            self._add_details(con.execute(
                DETAIL_SQL + " AND (s.role IS NOT NULL OR s.is_flagged)",
                [self.profile_id]).fetchall())

            # Layer links: by tx_key, and the candidate role each sender was
            # proven under (it fixes the window its links are followed in).
            self.link: dict[int, tuple[str, str]] = {}
            self.sender_role: dict[int, str] = {}
            for tx_key, tx_id, from_acct, from_role, link_type in con.execute(
                    "SELECT tx_key, tx_id, from_acct, from_role, link_type FROM layer_links "
                    "WHERE profile_id = ?", [self.profile_id]).fetchall():
                self.link[tx_key] = (link_type, tx_id)
                self.sender_role[from_acct] = from_role
            self.link_keys = np.array(sorted(self.link), dtype=np.int64)
        finally:
            con.close()

        w = profile["windows"]
        tr = profile.get("trace") or {}
        split = w["split_forward_minutes"]
        self.split_window = (int(split["min"]) * 60, int(split["max"]) * 60)
        self.single_window = (0, int(w["single_forward_max_minutes"]) * 60)
        fb = w[tr.get("fallback_window", "single_forward_max_minutes")]
        self.fallback_window = ((int(fb["min"]) * 60, int(fb["max"]) * 60)
                                if isinstance(fb, dict) else (0, int(fb) * 60))
        self.max_hops = int(tr.get("max_hops", 4))
        self.coverage = float(tr.get("coverage_target", 0.90))
        self.max_accounts = int(tr.get("max_accounts", 500))

        # Findings cut-offs: the same profile values scoring and rings use.
        try:
            cond = profile["final"]["override"]["conditions"]
            pat = profile["rings"]["patterns"]
            self.forward_share_min = float(cond["forwarded_share_min"])
            self.split_min = int(next(
                c["split_count"]["min"] for c in cond["any_of"] if "split_count" in c))
            self.scatter_min = int(pat["scatter_gather_min_branches"])
            self.funnel_min = int(pat["funnel_min_mule_senders"])
        except (KeyError, StopIteration) as e:
            raise SystemExit(f"profile is missing a findings cut-off ({e!r}) -- "
                             "reseed from engine\\config.yaml")
        # "Rapid" = inside the longest pass-through window of the profile.
        self.rapid_window = max(self.split_window[1], self.single_window[1])
        self.max_evidence = int(tr.get("max_evidence_sentences", 10))

        # L1 edge score (Section 4.4 step 0): weights and the two reused
        # cut-off rules. Read here, checked only when a trace needs them.
        self.edge = tr.get("l1_edge_score")
        rules = {p["id"]: p["rule"] for p in profile["mule_index"]["parameters"]
                 + profile["mule_index"].get("zero_weight_parameters", [])}
        self.edge_rules = {k: rules.get((self.edge or {}).get(k))
                           for k in ("burst_fan_in_rule", "amount_anomaly_rule")}
        self.cashout_list = sql_params(profile)["cashout_list"]
        self._pop_median: float | None = None

    def _add_details(self, rows: list) -> None:
        for (acct_id, role, confirmed, final, mule, trust, band, flagged,
             ring_id, reasons, freeze, account_holding, victim) in rows:
            self.details[acct_id] = {
                "role": role, "role_confirmed": confirmed,
                "final_index": None if final is None else round(final, 2),
                "victim_score": None if victim is None else round(victim, 2),
                "mule_index": None if mule is None else round(mule, 2),
                "trust_index": None if trust is None else round(trust, 2),
                "band": band, "is_flagged": flagged, "network_id": ring_id,
                "freeze_recommended": bool(freeze), "account_holding": account_holding,
                "reasons": list(reasons or []),
            }

    def ensure_details(self, acct_ids: list[int], tx_keys: list[int]) -> dict[int, str]:
        """Look up what is not cached: scores of unroled accounts and the
        original Transaction_ID of fallback transfers. Returns {tx_key: tx_id}."""
        missing = [a for a in acct_ids if a not in self.details]
        if not missing and not tx_keys:
            return {}
        con = duckdb.connect(str(self.db), read_only=True)
        try:
            if missing:
                self._add_details(con.execute(
                    DETAIL_SQL + " AND s.acct_id IN (SELECT unnest(?))",
                    [self.profile_id, missing]).fetchall())
            if not tx_keys:
                return {}
            return dict(con.execute(
                "SELECT tx_key, tx_id FROM tx WHERE tx_key IN (SELECT unnest(?))",
                [tx_keys]).fetchall())
        finally:
            con.close()

    def edge_facts(self, tx_keys: list[int], receivers: list[int]):
        """What the L1 edge score reads from the database for one victim's
        payments: the layering-edge payments (the same combo features.sql
        counts for MP3), the receivers' burst_fan_in as stored in `features`,
        and the population median amount."""
        con = duckdb.connect(str(self.db), read_only=True)
        try:
            layering = {r[0] for r in con.execute(
                "SELECT tx_key FROM tx WHERE tx_key IN (SELECT unnest(?)) "
                "AND is_headless AND is_foreign_ip "
                "AND split_part(split_part(narration, '/', 2), '#', 1) "
                f"IN ({self.cashout_list})", [tx_keys]).fetchall()}
            burst = dict(con.execute(
                "SELECT acct_id, burst_fan_in FROM features "
                "WHERE acct_id IN (SELECT unnest(?))", [receivers]).fetchall())
            if self._pop_median is None:
                self._pop_median = float(con.execute(
                    "SELECT median(amount_paise) FROM tx").fetchone()[0])
        finally:
            con.close()
        return layering, burst, self._pop_median

    def out_slice(self, a: int):
        lo, hi = self.g["out_ptr"][a], self.g["out_ptr"][a + 1]
        return (self.g["out_dst"][lo:hi], self.g["out_tx"][lo:hi],
                self.g["out_ts"][lo:hi], self.g["out_amt"][lo:hi])

    def in_slice(self, a: int):
        lo, hi = self.g["in_ptr"][a], self.g["in_ptr"][a + 1]
        return self.g["in_tx"][lo:hi], self.g["in_ts"][lo:hi], self.g["in_amt"][lo:hi]


def get_context(db: Path | str | None = None) -> Context:
    """The cached Context for a database, reloaded when the file changes."""
    path = Path(db) if db else DEFAULT_DB
    if not path.is_file():
        raise SystemExit(f"database not found: {path} -- run engine\\ingest.py first")
    key = (str(path.resolve()), path.stat().st_mtime_ns)
    if key not in _CONTEXTS:
        _CONTEXTS.clear()                 # one database at a time; drop the stale one
        _CONTEXTS[key] = Context(path)
    return _CONTEXTS[key]


def _in_window(ts: np.ndarray, arrivals: np.ndarray, window: tuple[int, int]) -> np.ndarray:
    """True where a transfer leaves inside the window after ANY tainted arrival."""
    lag = ts[:, None] - arrivals[None, :]
    return ((lag >= window[0]) & (lag <= window[1])).any(axis=1)


def _fallback_choice(ctx: Context, dst, amt, candidates: np.ndarray,
                     tainted: float) -> np.ndarray:
    """Fallback choice: every candidate transfer to a flagged receiver, then
    unflagged receivers by final_index (then amount) until the followed amount
    covers trace.coverage_target of the tainted money the flagged receivers did
    not take. Returns a mask over the outflow slice."""
    chosen = candidates & ctx.flagged[dst]
    idx = np.flatnonzero(candidates & ~chosen)
    target = ctx.coverage * (tainted - float(amt[chosen].sum()))
    if not len(idx) or target <= 0:
        return chosen
    # lexsort: last key is the primary one. Descending risk, then descending
    # amount; equal rows are interchangeable, so no tx_key is consulted.
    order = idx[np.lexsort((-amt[idx], -ctx.final[dst[idx]]))]
    covered = np.cumsum(amt[order])
    n_take = int(np.searchsorted(covered, target, side="left")) + 1
    chosen[order[:n_take]] = True
    return chosen


def _threshold(value, rule: dict | None) -> float:
    """threshold_desc as scoring reads it: 1 at full_at, 0.5 at half_at. A NULL
    value or a null cut-off is not applicable: 0 points."""
    if value is None or not rule or rule.get("full_at") is None or rule.get("half_at") is None:
        return 0.0
    return 1.0 if value >= rule["full_at"] else 0.5 if value >= rule["half_at"] else 0.0


def _l1_edge_scores(ctx: Context, source: int) -> np.ndarray:
    """L1 edge score of each of the victim's payments (Section 4.4 step 0),
    0-100, weights from trace.l1_edge_score. The loops run over this one
    account's payments and the handful of transfers each receiver sent on."""
    if not ctx.edge or not ctx.edge.get("weights"):
        raise SystemExit("profile has no trace.l1_edge_score block -- reseed from "
                         "engine\\config.yaml")
    w = ctx.edge["weights"]
    dst, o_tx, o_ts, o_amt = ctx.out_slice(source)
    layering, burst, pop_median = ctx.edge_facts(o_tx.tolist(), sorted(set(dst.tolist())))
    scores = np.zeros(len(dst))
    for k in range(len(dst)):
        r, ts, amount = int(dst[k]), int(o_ts[k]), int(o_amt[k])
        r_dst, _, r_ts, r_amt = ctx.out_slice(r)
        sent_on = _in_window(r_ts, np.array([ts]), ctx.fallback_window)
        forwarded = float(r_amt[sent_on].sum())
        onward = min(1.0, forwarded / amount) if amount else 0.0
        # Downstream L2 pattern: the forwarded money moved on once more.
        again = 0.0
        for j in np.flatnonzero(sent_on):
            n_ts = ctx.out_slice(int(r_dst[j]))[2]
            if len(n_ts) and _in_window(n_ts, np.array([int(r_ts[j])]), ctx.single_window).any():
                again += float(r_amt[j])
        downstream = again / forwarded if forwarded else 0.0
        first_time = not (o_ts[dst == r] < ts).any()
        anomaly = _threshold(amount / pop_median if pop_median else None,
                             ctx.edge_rules["amount_anomaly_rule"])
        parts = {
            "onward_forwarding": onward,
            "burst_fan_in": _threshold(burst.get(r), ctx.edge_rules["burst_fan_in_rule"]),
            "first_time_payee_amount_anomaly": anomaly if first_time else 0.0,
            "downstream_l2_pattern": downstream,
            "narration_device": 1.0 if int(o_tx[k]) in layering else 0.0,
        }
        scores[k] = sum(float(w[name]) * parts[name] for name in parts)
    return np.round(scores, 2)


def _expand(ctx: Context, acct: int, batch: list[tuple[int, float, int]]):
    """Follow one account's onward transfers for a batch of tainted arrivals.

    batch: [(ts, tainted_paise, tx_key)] -- this victim's money arriving here.
    Returns (followed, untraced, via) where followed is
    [(dst, tx_key, ts, amount, tainted)] and untraced is the tainted money that
    left on transfers the trace did not follow.
    """
    dst, o_tx, o_ts, o_amt = ctx.out_slice(acct)
    if not len(o_ts):
        return [], 0.0, None
    arrivals = np.array([b[0] for b in batch], dtype=np.int64)
    tainted_in = sum(b[1] for b in batch)

    # 1. Layer links leaving inside the sender's proven window.
    via, follow, window = None, None, None
    role = ctx.sender_role.get(acct)
    if role is not None:
        window = ctx.split_window if role == "L1" else ctx.single_window
        linked = np.isin(o_tx, ctx.link_keys) & _in_window(o_ts, arrivals, window)
        if linked.any():
            via, follow = "layer_link", linked
    # 2. Fallback, only where no link exists: time and amount rules.
    if follow is None:
        window = ctx.fallback_window
        candidates = _in_window(o_ts, arrivals, window)
        if not candidates.any():
            return [], 0.0, None
        via = "fallback"
        follow = _fallback_choice(ctx, dst, o_amt, candidates, tainted_in)

    # 3. Pro-rata pool over the window: every inflow and outflow of the account
    #    between the first tainted arrival and the end of the last window.
    t0, t1 = int(arrivals.min()), int(arrivals.max()) + window[1]
    i_tx, i_ts, i_amt = ctx.in_slice(acct)
    taint_of = {b[2]: b[1] for b in batch}
    events = []       # (ts, kind, amount, index): inflows (0) before outflows (1)
    lo, hi = np.searchsorted(i_ts, t0, "left"), np.searchsorted(i_ts, t1, "right")
    for k in range(lo, hi):
        events.append((int(i_ts[k]), 0, int(i_amt[k]), k))
    lo, hi = np.searchsorted(o_ts, t0, "left"), np.searchsorted(o_ts, t1, "right")
    for k in range(lo, hi):
        events.append((int(o_ts[k]), 1, int(o_amt[k]), k))
    events.sort(key=lambda e: e[:3])

    pool = pool_tainted = untraced = 0.0
    followed = []
    for ts, kind, amount, k in events:
        if kind == 0:
            pool += amount
            pool_tainted += taint_of.get(int(i_tx[k]), 0.0)
            continue
        paid = min(amount, pool)             # nothing is paid out of an empty pool
        if paid <= 0:
            continue
        carried = paid * pool_tainted / pool
        pool -= paid
        pool_tainted -= carried
        if follow[k] and carried >= 0.5:     # at least one paisa of this victim's money
            followed.append((int(dst[k]), int(o_tx[k]), ts, amount, carried))
        else:
            untraced += carried
    return followed, untraced, via


def _iso(ts_sec: int) -> str:
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc).replace(tzinfo=None).isoformat(sep=" ")


def _rupees(paise: float) -> str:
    return f"Rs {paise / 100:,.2f}"


def _minutes(seconds: float) -> float:
    return round(seconds / 60, 1)


def _on_cycle(transfers: list[dict]) -> set[int]:
    """Accounts on a directed cycle of the trace's own transfers."""
    nxt: dict[int, set[int]] = {}
    for t in transfers:
        nxt.setdefault(t["from"], set()).add(t["to"])

    def reach(start: int) -> set[int]:
        seen, stack = set(), list(nxt.get(start, ()))
        while stack:
            a = stack.pop()
            if a not in seen:
                seen.add(a)
                stack.extend(nxt.get(a, ()))
        return seen

    return {a for a in nxt if a in reach(a)}


def _findings(ctx: Context, source: int, nodes: dict[int, dict], transfers: list[dict],
              tx_id_of) -> list[dict]:
    """Patterns in THIS trace (Section 4.4). Every number in an evidence
    sentence is computed from the trace's own accounts and transfers; the
    cut-offs come from the profile. Loops run over the trace's transfers only.
    """
    ins: dict[int, list[dict]] = {}
    outs: dict[int, list[dict]] = {}
    for t in transfers:
        outs.setdefault(t["from"], []).append(t)
        ins.setdefault(t["to"], []).append(t)
    name = ctx.acct_no
    cap = ctx.max_evidence

    def finding(pattern: str, lines: list[str], accts: set[int], used: list[dict]) -> dict:
        used = sorted({t["tx_key"]: t for t in used}.values(), key=lambda t: t["tx_key"])
        proven = all(t["via"] == "layer_link" for t in used)
        guessed = any(t.get("edge_score") is not None for t in used)
        extra = [f"and {len(lines) - cap} more."] if len(lines) > cap else []
        return {
            "pattern": pattern,
            # high = every transfer is a proven layer link; medium = at least
            # one was followed by the fallback rules (time and amount only);
            # low = one was chosen by the L1 edge score.
            "confidence": "low" if guessed else "high" if proven else "medium",
            "evidence": lines[:cap] + extra,
            "accounts": sorted(name[a] for a in accts),
            "tx_keys": [t["tx_key"] for t in used],
            "tx_ids": [tx_id_of(t["tx_key"]) for t in used],
            "hop_range": [min(t["hop"] for t in used), max(t["hop"] for t in used)],
        }

    order = sorted(outs, key=lambda a: (nodes[a]["hop"], name[a]))
    found: list[dict] = []

    # Rapid pass-through: most of this victim's money left again inside the window.
    lines, accts, used = [], set(), []
    for a in order:
        if a == source or not nodes[a]["in"]:
            continue
        share = nodes[a]["out"] / nodes[a]["in"]
        first_in = min(t["ts"] for t in ins[a])
        lag_lo = min(t["ts"] for t in outs[a]) - first_in
        lag_hi = max(t["ts"] for t in outs[a]) - first_in
        if share >= ctx.forward_share_min and 0 <= lag_hi <= ctx.rapid_window:
            lines.append(
                f"{name[a]} received {_rupees(nodes[a]['in'])} of the victim's money and"
                f" forwarded {_rupees(nodes[a]['out'])} ({share:.1%}) in {len(outs[a])}"
                f" transfer(s), "
                + (f"{_minutes(lag_lo)} to " if lag_lo != lag_hi else "")
                + f"{_minutes(lag_hi)} minutes after it arrived.")
            accts.add(a)
            used += ins[a] + outs[a]
    if lines:
        found.append(finding("RAPID_PASS_THROUGH", lines, accts, used))

    # Scatter (split): one account pays the money on to several receivers.
    lines, accts, used = [], set(), []
    for a in order:
        receivers = {t["to"] for t in outs[a]}
        if a != source and len(receivers) >= ctx.split_min:
            span = max(t["ts"] for t in outs[a]) - min(t["ts"] for t in outs[a])
            lines.append(
                f"{name[a]} split {_rupees(nodes[a]['out'])} across {len(receivers)} accounts"
                f" in {len(outs[a])} transfers within {_minutes(span)} minutes.")
            accts |= receivers | {a}
            used += outs[a]
    if lines:
        found.append(finding("SCATTER", lines, accts, used))

    # Funnel / consolidation: fan-in from other MULE accounts (the victim's own
    # payments are L1 fan-in, a different thing, and are left out).
    lines, accts, used = [], set(), []
    for a in sorted(ins, key=lambda a: (nodes[a]["hop"], name[a])):
        legs = [t for t in ins[a] if t["from"] != source]
        senders = {t["from"] for t in legs}
        if len(senders) >= ctx.funnel_min:
            lines.append(
                f"{name[a]} collected {_rupees(sum(t['tainted'] for t in legs))} from"
                f" {len(senders)} accounts in {len(legs)} transfers.")
            accts |= senders | {a}
            used += legs
    if lines:
        found.append(finding("FUNNEL", lines, accts, used))

    # Scatter-gather: the split reconverges on one account through several
    # intermediaries (second leg not earlier than the first).
    lines, accts, used = [], set(), []
    for a in order:
        if a == source:
            continue
        paths: dict[int, list[tuple[dict, dict]]] = {}
        for first in outs[a]:
            for second in outs.get(first["to"], []):
                if second["ts"] >= first["ts"]:
                    paths.setdefault(second["to"], []).append((first, second))
        for target in sorted(paths, key=lambda x: name[x]):
            mids = {f["to"] for f, _ in paths[target]}
            if len(mids) < ctx.scatter_min:
                continue
            seconds = {s["tx_key"]: s for _, s in paths[target]}.values()
            firsts = {f["tx_key"]: f for f, _ in paths[target]}.values()
            span = max(s["ts"] for s in seconds) - min(f["ts"] for f in firsts)
            lines.append(
                f"{name[a]} sent money through {len(mids)} intermediary accounts that all paid"
                f" {name[target]}, which received {_rupees(sum(s['tainted'] for s in seconds))}"
                f" this way within {_minutes(span)} minutes.")
            accts |= mids | {a, target}
            used += list(firsts) + list(seconds)
    if lines:
        found.append(finding("SCATTER_GATHER", lines, accts, used))

    # Cycle: reported only when the trace's transfers really close a loop.
    cyc = _on_cycle(transfers)
    if cyc:
        legs = [t for t in transfers if t["from"] in cyc and t["to"] in cyc]
        found.append(finding("CYCLE", [
            f"{len(cyc)} accounts pass {_rupees(sum(t['tainted'] for t in legs))} of the victim's"
            f" money around a loop in {len(legs)} transfers."], cyc, legs))
    return found


def trace_victim(acct_no: str, db: Path | str | None = None) -> dict:
    """Trace one victim's money. Returns a plain, JSON-ready dict."""
    ctx = get_context(db)
    source = ctx.id_of.get(str(acct_no).strip().upper())
    if source is None:
        return dict(NOT_FOUND)

    # nodes: acct_id -> running totals. hop = distance at first arrival only.
    nodes: dict[int, dict] = {}
    transfers: list[dict] = []
    truncated = False

    def node(a: int, hop: int) -> dict:
        return nodes.setdefault(a, {"hop": hop, "in": 0.0, "out": 0.0,
                                    "untraced": 0.0, "stopped": None})

    # Hop 0 -> 1: the victim's own payments are tainted in full.
    src = node(source, 0)
    dst, o_tx, o_ts, o_amt = ctx.out_slice(source)
    frontier: dict[int, list] = {}
    not_followed = {"count": 0, "amount": 0}
    if not len(o_ts):
        src["stopped"] = "no_outgoing_transfers"
    else:
        linked = np.isin(o_tx, ctx.link_keys)
        edge_scores = None
        if linked.any():
            via, follow = "layer_link", linked
        else:
            # No layer link: payments to flagged receivers only. If there is
            # none, only the payment(s) with the highest L1 edge score (step 0),
            # low confidence. Coverage is never filled from the other payments.
            via, follow = "fallback", ctx.flagged[dst]
            if not follow.any():
                edge_scores = _l1_edge_scores(ctx, source)
                follow = (edge_scores == edge_scores.max()) & (edge_scores > 0)
                if not follow.any():
                    src["stopped"] = "no_payment_with_l1_edge_score"
        not_followed = {"count": int((~follow).sum()), "amount": int(o_amt[~follow].sum())}
        for k in np.flatnonzero(follow):
            amount = int(o_amt[k])
            src["out"] += amount
            transfers.append({"hop": 1, "from": source, "to": int(dst[k]), "tx_key": int(o_tx[k]),
                              "ts": int(o_ts[k]), "amount": amount, "tainted": float(amount),
                              "via": via,
                              "edge_score": None if edge_scores is None else float(edge_scores[k])})
            frontier.setdefault(int(dst[k]), []).append((int(o_ts[k]), float(amount), int(o_tx[k])))

    hop = 1
    while frontier:
        nxt: dict[int, list] = {}
        for acct in sorted(frontier):
            batch = frontier[acct]
            nd = node(acct, hop)
            nd["in"] += sum(b[1] for b in batch)
            if ctx.receive_only[acct]:
                nd["stopped"] = "receive_only"
                continue
            if hop >= ctx.max_hops:
                nd["stopped"] = "max_hops"
                continue
            if truncated:
                nd["stopped"] = "max_accounts"
                continue
            followed, untraced, via = _expand(ctx, acct, batch)
            nd["untraced"] += untraced
            if not followed:
                nd["stopped"] = nd["stopped"] or "no_onward_transfer_in_window"
            for to, tx_key, ts, amount, carried in followed:
                nd["out"] += carried
                transfers.append({"hop": hop + 1, "from": acct, "to": to, "tx_key": tx_key,
                                  "ts": ts, "amount": amount, "tainted": carried, "via": via})
                nxt.setdefault(to, []).append((ts, carried, tx_key))
            if len(nodes) + len(nxt) > ctx.max_accounts:
                truncated = True
        frontier = nxt
        hop += 1

    # ------------------------------------------------------------ output
    fallback_keys = [t["tx_key"] for t in transfers if t["tx_key"] not in ctx.link]
    tx_ids = ctx.ensure_details(list(nodes), fallback_keys)

    def account(a: int, nd: dict) -> dict:
        d = ctx.details.get(a, {})
        held = nd["in"] - nd["out"] - nd["untraced"] if a != source else 0.0
        return {
            "acct_no": ctx.acct_no[a], "bank": ctx.bank[a], "hop": nd["hop"],
            "role": d.get("role"), "role_confirmed": d.get("role_confirmed"),
            "final_index": d.get("final_index"), "victim_score": d.get("victim_score"),
            "mule_index": d.get("mule_index"),
            "trust_index": d.get("trust_index"), "band": d.get("band"),
            "is_flagged": d.get("is_flagged"),
            "network_id": d.get("network_id"), "cell_ids": ctx.cells.get(a, []),
            "freeze_recommended": d.get("freeze_recommended", False),
            "account_holding": d.get("account_holding"),
            "tainted_in": int(round(nd["in"])), "tainted_out": int(round(nd["out"])),
            "untraced_out": int(round(nd["untraced"])),
            "holding": max(int(round(held)), 0),
            "stopped": nd["stopped"],
            "reasons": d.get("reasons", []),
        }

    transfers.sort(key=lambda t: (t["hop"], t["ts"], t["amount"], t["tx_key"]))
    out_transfers = []
    for t in transfers:
        link = ctx.link.get(t["tx_key"])
        out_transfers.append({
            "hop": t["hop"], "tx_key": t["tx_key"],
            "tx_id": link[1] if link else tx_ids.get(t["tx_key"]),
            "from": ctx.acct_no[t["from"]], "to": ctx.acct_no[t["to"]],
            "ts": _iso(t["ts"]), "amount": t["amount"],
            "tainted": int(round(t["tainted"])),
            "via": t["via"], "link_type": link[0] if link else None,
            # low = chosen by the L1 edge score; high = proven layer link.
            "confidence": ("low" if t.get("edge_score") is not None
                           else "high" if t["via"] == "layer_link" else "medium"),
            "l1_edge_score": t.get("edge_score"),
        })

    accounts = [account(a, nd) for a, nd in
                sorted(nodes.items(), key=lambda kv: (kv[1]["hop"], -kv[1]["in"], ctx.acct_no[kv[0]]))
                if a != source]

    per_hop = []
    prev_first = None
    for h in sorted({t["hop"] for t in transfers}):
        ts_h = [t["ts"] for t in transfers if t["hop"] == h]
        first = min(ts_h)
        per_hop.append({
            "hop": h,
            "accounts": sum(1 for a in accounts if a["hop"] == h),
            "transfers": len(ts_h),
            "tainted": int(round(sum(t["tainted"] for t in transfers if t["hop"] == h))),
            "first_ts": _iso(first), "last_ts": _iso(max(ts_h)),
            "seconds_since_previous_hop": None if prev_first is None else first - prev_first,
            "minutes_since_previous_hop": (None if prev_first is None
                                           else _minutes(first - prev_first)),
        })
        prev_first = first

    by_role: dict[str, int] = {}
    for a in accounts:
        by_role[a["role"] or "NONE"] = by_role.get(a["role"] or "NONE", 0) + 1
    # Reconciliation (integer paise): what the victim paid = what each
    # forwarding account kept + what sits at the accounts the trace stopped at
    # + what left on transfers the trace did not follow.
    paid = int(round(nodes[source]["out"]))
    forwarders = [a for a in accounts if a["tainted_out"] > 0]
    kept = sum(a["holding"] for a in forwarders)
    at_end = sum(a["holding"] for a in accounts if a["tainted_out"] == 0)
    untraced_total = sum(a["untraced_out"] for a in accounts)
    reconciliation = {
        "victim_paid": paid, "commissions_kept": kept, "holding_at_end": at_end,
        "untraced": untraced_total,
        "difference": paid - kept - at_end - untraced_total,   # rounding only
    }

    def tx_id_of(tx_key: int):
        link = ctx.link.get(tx_key)
        return link[1] if link else tx_ids.get(tx_key)

    findings = _findings(ctx, source, nodes, transfers, tx_id_of)

    # Freeze candidates: recommended by scoring AND still holding this victim's
    # money, largest first, with the transfers that prove receipt.
    my_cells = set(ctx.cells.get(source, []))
    receipts: dict[str, list[dict]] = {}
    for t in out_transfers:
        receipts.setdefault(t["to"], []).append(
            {"tx_id": t["tx_id"], "tx_key": t["tx_key"], "ts": t["ts"],
             "amount": t["amount"], "tainted": t["tainted"]})
    freeze_candidates = []
    for a in sorted((a for a in accounts if a["freeze_recommended"] and a["holding"] > 0),
                    key=lambda a: (-a["holding"], a["acct_no"])):
        shared = [c for c in a["cell_ids"] if c in my_cells]
        freeze_candidates.append({
            "acct_no": a["acct_no"], "bank": a["bank"], "role": a["role"], "hop": a["hop"],
            # the cell(s) this account shares with the victim's L1(s)
            "cell_id": shared[0] if shared else None, "cell_ids": shared,
            "holding": a["holding"], "tainted_in": a["tainted_in"],
            "receipts": receipts.get(a["acct_no"], []),
        })

    all_ts = [t["ts"] for t in transfers]
    low_confidence = any(t.get("edge_score") is not None for t in transfers)
    victim = account(source, nodes[source])
    flagged = sum(1 for a in accounts if a["is_flagged"])
    role_text = ", ".join(f"{n} {r}" for r, n in sorted(by_role.items())) or "none"
    payees = [a for a in accounts if a["hop"] == 1]
    who = (f"Victim account {victim['acct_no']} ({victim['bank']}) paid {_rupees(paid)} to"
           f" {len(payees)} account(s): {', '.join(a['acct_no'] for a in payees[:5])}."
           f" The money reached {len(accounts)} accounts ({role_text}); {flagged} are flagged.")
    if not transfers:
        how = "No outgoing transfer could be followed."
        why = "Nothing to assess: the trace found no onward movement."
        when = "No transfer in the trace."
    else:
        span = max(all_ts) - min(all_ts)
        how = (f"{_rupees(paid)} moved across {max(t['hop'] for t in transfers)} hops in"
               f" {len(transfers)} transfers;"
               f" {sum(1 for t in transfers if t['via'] == 'layer_link')} are proven layer links"
               f" and {sum(1 for t in transfers if t['via'] == 'fallback')} were followed by the"
               f" fallback rules. Patterns found: "
               f"{', '.join(f['pattern'] for f in findings) or 'none'}."
               + (" LOW CONFIDENCE: no payment of the victim went to a flagged account, so"
                  " only the payment(s) with the highest L1 edge score were followed."
                  if low_confidence else ""))
        # Roles are read from scores, never inferred from the hop.
        keepers = "/".join(sorted({a["role"] or "unroled" for a in forwarders})) or "forwarding"
        frozen = sum(c["holding"] for c in freeze_candidates)
        held = kept + at_end
        why = (f"{flagged} of {len(accounts)} accounts are flagged by scoring."
               f" The {keepers} accounts that passed the money on kept {_rupees(kept)} as"
               f" commission; {_rupees(at_end)} sits at the final accounts."
               + (f" The whole {_rupees(held)} is in {len(freeze_candidates)}"
                  f" freeze-recommended accounts." if frozen == held else
                  f" Of the {_rupees(held)} still held, {_rupees(frozen)} is in"
                  f" {len(freeze_candidates)} freeze-recommended accounts.")
               + (f" {_rupees(untraced_total)} left on transfers the trace did not follow."
                  if untraced_total else ""))
        when = (f"First transfer {_iso(min(all_ts))}, last transfer {_iso(max(all_ts))}:"
                f" {_minutes(span)} minutes from the victim's payment to the last account.")

    keys = sorted(t["tx_key"] for t in transfers)
    return {
        "found": True,
        "profile_id": ctx.profile_id,
        "amount_unit": "paise",
        "victim": victim,
        "summary": {
            "tainted_total": int(round(nodes[source]["out"])),
            "accounts": len(accounts),
            "accounts_by_role": dict(sorted(by_role.items())),
            "transfers": len(transfers),
            "hops": max((t["hop"] for t in transfers), default=0),
            "max_hops": ctx.max_hops,
            "holding_total": sum(a["holding"] for a in accounts),
            # the cells of the L1s this victim paid (traced accounts may sit in more)
            "cell_ids": ctx.cells.get(source, []),
            "freeze_recommended": sum(1 for a in accounts if a["freeze_recommended"]),
            "freeze_holding_total": sum(a["holding"] for a in accounts
                                        if a["freeze_recommended"]),
            "untraced_total": untraced_total,
            "reconciliation": reconciliation,
            "who": who, "how": how, "why": why, "when": when,
            "first_ts": _iso(min(all_ts)) if all_ts else None,
            "last_ts": _iso(max(all_ts)) if all_ts else None,
            "seconds_first_to_last": (max(all_ts) - min(all_ts)) if all_ts else None,
            "used_fallback": any(t["via"] == "fallback" for t in transfers),
            # True when the first hop was chosen by the L1 edge score.
            "low_confidence": low_confidence,
            # The victim's payments the trace did not follow (never tainted).
            "payments_not_followed": not_followed,
            "truncated": truncated,
        },
        "per_hop": per_hop,
        "findings": findings,
        "freeze_candidates": freeze_candidates,
        "accounts": accounts,
        "transfers": out_transfers,
        # Same evidence -> same hash (Section 4.4). tx_key, not tx_id, because
        # Transaction_ID is not unique in this dataset.
        "fingerprint": hashlib.sha256(",".join(map(str, keys)).encode()).hexdigest() if keys else None,
    }


# Per-account fields that do not depend on which victim is traced.
_STATIC = ("acct_no", "bank", "role", "role_confirmed", "final_index", "victim_score",
           "mule_index", "trust_index", "band", "is_flagged", "network_id", "cell_ids",
           "freeze_recommended", "account_holding", "stopped", "reasons")
_AMOUNTS = ("tainted_in", "tainted_out", "untraced_out", "holding")


def trace_victims(acct_nos: list[str], db: Path | str | None = None) -> dict:
    """Trace several victims into ONE graph (Section 4.4b).

    Each victim is traced alone -- the pro-rata pool already treats every other
    victim's money as clean, so the shares are right where victims share a
    mule -- and the traces are merged: a shared account or transfer appears
    once, with its total and each victim's part under `by_victim`.
    """
    ctx = get_context(db)
    wanted = list(dict.fromkeys(str(a).strip().upper() for a in acct_nos))
    traces = {v: trace_victim(v, db) for v in wanted}
    not_found = [v for v, r in traces.items() if not r["found"]]
    traces = {v: r for v, r in traces.items() if r["found"]}
    if not traces:
        return dict(NOT_FOUND, not_found=not_found)

    accounts: dict[str, dict] = {}
    transfers: dict[int, dict] = {}
    victims = []
    for v, r in traces.items():
        s = r["summary"]
        victims.append({
            "acct_no": v, "bank": r["victim"]["bank"], "paid": s["tainted_total"],
            "accounts": s["accounts"], "transfers": s["transfers"],
            "holding_total": s["holding_total"], "untraced_total": s["untraced_total"],
            "cell_ids": s["cell_ids"], "first_ts": s["first_ts"], "last_ts": s["last_ts"],
            "fingerprint": r["fingerprint"],
        })
        for a in r["accounts"]:
            m = accounts.get(a["acct_no"])
            if m is None:
                m = accounts[a["acct_no"]] = {k: a[k] for k in _STATIC}
                m.update(hop=a["hop"], by_victim={}, **dict.fromkeys(_AMOUNTS, 0))
            m["hop"] = min(m["hop"], a["hop"])
            for k in _AMOUNTS:
                m[k] += a[k]
            m["by_victim"][v] = {k: a[k] for k in _AMOUNTS}
        for t in r["transfers"]:
            m = transfers.get(t["tx_key"])
            if m is None:
                m = transfers[t["tx_key"]] = dict(t, tainted=0, by_victim={})
            m["hop"] = min(m["hop"], t["hop"])
            m["tainted"] += t["tainted"]
            m["by_victim"][v] = t["tainted"]

    for m in accounts.values():
        for part in m["by_victim"].values():
            part["share_of_tainted_in"] = (round(part["tainted_in"] / m["tainted_in"], 4)
                                           if m["tainted_in"] else None)
    acct_list = sorted(accounts.values(),
                       key=lambda a: (a["hop"], -a["tainted_in"], a["acct_no"]))
    tx_list = sorted(transfers.values(),
                     key=lambda t: (t["hop"], t["ts"], t["amount"], t["tx_key"]))

    receipts: dict[str, list[dict]] = {}
    for t in tx_list:
        receipts.setdefault(t["to"], []).append(
            {k: t[k] for k in ("tx_id", "tx_key", "ts", "amount", "tainted", "by_victim")})
    freeze_candidates = [
        {"acct_no": a["acct_no"], "bank": a["bank"], "role": a["role"], "hop": a["hop"],
         "cell_ids": a["cell_ids"], "holding": a["holding"],
         "by_victim": {v: p["holding"] for v, p in a["by_victim"].items()},
         "receipts": receipts.get(a["acct_no"], [])}
        for a in sorted((a for a in acct_list if a["freeze_recommended"] and a["holding"] > 0),
                        key=lambda a: (-a["holding"], a["acct_no"]))]

    by_role: dict[str, int] = {}
    for a in acct_list:
        by_role[a["role"] or "NONE"] = by_role.get(a["role"] or "NONE", 0) + 1
    keys = sorted(transfers)
    return {
        "found": True,
        "profile_id": ctx.profile_id,
        "amount_unit": "paise",
        "victims": victims,
        "not_found": not_found,
        "summary": {
            "victims": len(victims),
            "tainted_total": sum(v["paid"] for v in victims),
            "accounts": len(acct_list),
            "shared_accounts": sum(1 for a in acct_list if len(a["by_victim"]) > 1),
            "accounts_by_role": dict(sorted(by_role.items())),
            "transfers": len(tx_list),
            "shared_transfers": sum(1 for t in tx_list if len(t["by_victim"]) > 1),
            "holding_total": sum(a["holding"] for a in acct_list),
            "untraced_total": sum(a["untraced_out"] for a in acct_list),
            "cell_ids": sorted({c for v in victims for c in v["cell_ids"]}),
            "freeze_recommended": len(freeze_candidates),
            "used_fallback": any(r["summary"]["used_fallback"] for r in traces.values()),
            "low_confidence": any(r["summary"]["low_confidence"] for r in traces.values()),
            "truncated": any(r["summary"]["truncated"] for r in traces.values()),
        },
        "freeze_candidates": freeze_candidates,
        "accounts": acct_list,
        "transfers": tx_list,
        "fingerprint": hashlib.sha256(",".join(map(str, keys)).encode()).hexdigest() if keys else None,
    }


def _payments_into(ctx: Context, l1: int) -> list[dict]:
    """The victim payments into one L1, read backwards from the graph: its
    incoming transfers that are proven Victim -> L1 links. Where the account
    has no such link, incoming transfers from accounts scoring gave the role
    VICTIM. The loop runs over this one account's inflows."""
    lo, hi = ctx.g["in_ptr"][l1], ctx.g["in_ptr"][l1 + 1]
    rows = list(zip(ctx.g["in_src"][lo:hi].tolist(), ctx.g["in_tx"][lo:hi].tolist(),
                    ctx.g["in_ts"][lo:hi].tolist(), ctx.g["in_amt"][lo:hi].tolist()))
    linked = [r for r in rows if ctx.link.get(r[1], ("",))[0] == "VICTIM_L1"]
    via = "layer_link"
    if not linked:
        via = "fallback"
        linked = [r for r in rows if ctx.details.get(r[0], {}).get("role") == "VICTIM"]
    tx_ids = ctx.ensure_details([], [r[1] for r in linked]) if via == "fallback" else {}
    return [{"victim": src, "to": ctx.acct_no[l1], "tx_key": tx_key,
             "tx_id": ctx.link[tx_key][1] if tx_key in ctx.link else tx_ids.get(tx_key),
             "ts": ts, "amount": amount, "via": via}
            for src, tx_key, ts, amount in linked]


def _reverse(ctx: Context, l1s: list[int]) -> dict:
    """Walk back from a set of L1s to every victim that paid in."""
    by_victim: dict[int, list[dict]] = {}
    for l1 in l1s:
        for p in _payments_into(ctx, l1):
            by_victim.setdefault(p.pop("victim"), []).append(p)
    victims = []
    for v, pays in by_victim.items():
        pays.sort(key=lambda p: (p["ts"], p["amount"], p["tx_key"]))
        ts = [p["ts"] for p in pays]
        victims.append({
            "acct_no": ctx.acct_no[v], "bank": ctx.bank[v],
            "role": ctx.details.get(v, {}).get("role"),
            "amount": sum(p["amount"] for p in pays),
            "first_ts": _iso(min(ts)), "last_ts": _iso(max(ts)),
            "l1_accounts": sorted({p["to"] for p in pays}),
            "payments": [dict(p, ts=_iso(p["ts"])) for p in pays],
        })
    victims.sort(key=lambda x: (-x["amount"], x["acct_no"]))
    all_ts = [p["ts"] for pays in by_victim.values() for p in pays]
    return {
        "l1_accounts": sorted(ctx.acct_no[a] for a in l1s),
        "victim_count": len(victims),
        "total_in": sum(x["amount"] for x in victims),
        "payments": sum(len(x["payments"]) for x in victims),
        "first_ts": _iso(min(all_ts)) if all_ts else None,
        "last_ts": _iso(max(all_ts)) if all_ts else None,
        "victims": victims,
    }


def _cell(ctx: Context, cell_id) -> dict | None:
    try:
        return ctx.cell_info.get(int(cell_id))
    except (TypeError, ValueError):
        return None


def reverse_trace_cell(cell_id: int, db: Path | str | None = None) -> dict:
    """From a cell's L1 back to every victim that paid in (Section 4.4b)."""
    ctx = get_context(db)
    info = _cell(ctx, cell_id)
    if info is None:
        return {"found": False, "message": "No cell found"}
    return {"found": True, "profile_id": ctx.profile_id, "amount_unit": "paise",
            "cell_id": info["cell_id"], "network_id": info["network_id"],
            **_reverse(ctx, [info["l1_acct"]])}


def reverse_trace_network(network_id: int, db: Path | str | None = None) -> dict:
    """From every L1 of a network (the connected component) back to its victims."""
    ctx = get_context(db)
    try:
        cells = [c for c in ctx.cell_info.values() if c["network_id"] == int(network_id)]
    except (TypeError, ValueError):
        cells = []
    if not cells:
        return {"found": False, "message": "No network found"}
    return {"found": True, "profile_id": ctx.profile_id, "amount_unit": "paise",
            "network_id": int(network_id),
            "cell_ids": sorted(c["cell_id"] for c in cells),
            **_reverse(ctx, sorted(c["l1_acct"] for c in cells))}


def cell_summary(cell_id: int, db: Path | str | None = None) -> dict:
    """One cell at a glance: victims, money in, holding, mules by role and the
    accounts recommended for a freeze. Counts and totals are READ from `cells`;
    the victims are walked back from the cell's L1."""
    ctx = get_context(db)
    info = _cell(ctx, cell_id)
    if info is None:
        return {"found": False, "message": "No cell found"}
    rev = _reverse(ctx, [info["l1_acct"]])
    mules = [a for a in ctx.cell_accts.get(info["cell_id"], [])
             if ctx.details.get(a, {}).get("role") != "VICTIM"]
    by_role: dict[str, int] = {}
    for a in mules:
        role = ctx.details.get(a, {}).get("role") or "NONE"
        by_role[role] = by_role.get(role, 0) + 1
    freeze = sorted(
        ({"acct_no": ctx.acct_no[a], "bank": ctx.bank[a], "role": ctx.details[a]["role"],
          "account_holding": ctx.details[a]["account_holding"],
          "cell_ids": ctx.cells.get(a, [])}
         for a in mules if ctx.details.get(a, {}).get("freeze_recommended")),
        key=lambda x: (-(x["account_holding"] or 0), x["acct_no"]))
    return {
        "found": True, "profile_id": ctx.profile_id, "amount_unit": "paise",
        "cell_id": info["cell_id"], "network_id": info["network_id"],
        "l1_account": ctx.acct_no[info["l1_acct"]],
        "victim_count": rev["victim_count"],
        "victims": [{k: v[k] for k in ("acct_no", "bank", "amount", "first_ts", "last_ts")}
                    for v in rev["victims"]],
        "total_in": rev["total_in"],
        # linked money that arrived at the cell's mule accounts and was not
        # forwarded on; shared mules make this overlap with other cells
        "holding": info["holding_paise"],
        "mules": len(mules),
        "mules_by_role": dict(sorted(by_role.items())),
        "freeze_recommended": len(freeze),
        "freeze_holding": sum(f["account_holding"] or 0 for f in freeze),
        "freeze_accounts": freeze,
        "first_ts": info["first_ts"], "last_ts": info["last_ts"],
        "patterns": info["patterns"], "fingerprint": info["fingerprint"],
    }


def _score_shown(a: dict):
    """A VICTIM is shown with its victim_score; every other account with final_index."""
    return a["victim_score"] if a["role"] == "VICTIM" else a["final_index"]


def print_summary(r: dict) -> None:
    """Human-readable view of a trace (the CLI default)."""
    v, s = r["victim"], r["summary"]
    print(f"victim       : {v['acct_no']} ({v['bank']})  role {v['role']}"
          f"  {'victim_score' if v['role'] == 'VICTIM' else 'final'} {_score_shown(v)}")
    print(f"profile      : {r['profile_id']}")
    print(f"tainted      : {_rupees(s['tainted_total'])} across {s['hops']} hops,"
          f" {s['accounts']} accounts, {s['transfers']} transfers"
          f" in {s['seconds_first_to_last']} s" if s["transfers"] else
          "tainted      : no outgoing transfers to follow")
    print(f"by role      : {s['accounts_by_role']}")
    print(f"holding      : {_rupees(s['holding_total'])} still held;"
          f" {_rupees(s['untraced_total'])} left on transfers not followed")
    print(f"freeze       : {s['freeze_recommended']} accounts recommended, holding"
          f" {_rupees(s['freeze_holding_total'])} of this victim's money")
    print(f"cells        : {s['cell_ids']}   network: {v['network_id']}")
    print(f"fallback     : {s['used_fallback']}   truncated: {s['truncated']}"
          f"   low confidence: {s['low_confidence']}")
    nf = s["payments_not_followed"]
    if nf["count"]:
        print(f"not followed : {nf['count']} payment(s) of the victim, {_rupees(nf['amount'])}")
    for h in r["per_hop"]:
        print(f"  hop {h['hop']}: {h['accounts']} accounts, {h['transfers']} transfers,"
              f" {_rupees(h['tainted'])}, {h['first_ts']} -> {h['last_ts']}"
              + (" (victim payment)" if h["minutes_since_previous_hop"] is None
                 else f" (+{h['minutes_since_previous_hop']} min)"))
    for k in ("who", "how", "why", "when"):
        print(f"{k:<13}: {s[k]}")
    rc = s["reconciliation"]
    print(f"reconcile    : paid {_rupees(rc['victim_paid'])} = kept {_rupees(rc['commissions_kept'])}"
          f" + held at end {_rupees(rc['holding_at_end'])} + untraced {_rupees(rc['untraced'])}"
          f" (difference {rc['difference']} paise)")
    for f in r["findings"]:
        print(f"finding      : {f['pattern']} ({f['confidence']}), hops {f['hop_range']},"
              f" {len(f['accounts'])} accounts, {len(f['tx_keys'])} transfers")
        for line in f["evidence"]:
            print(f"    {line}")
    print(f"freeze list  : {len(r['freeze_candidates'])} accounts (largest holding first)")
    print("accounts (hop, role, final [victim_score for a VICTIM], tainted in -> out, holding, freeze):")
    for a in r["accounts"][:50]:
        print(f"  {a['hop']}  {a['acct_no']}  {str(a['role']):<18} {str(_score_shown(a)):>6}"
              f"  {_rupees(a['tainted_in']):>18} -> {_rupees(a['tainted_out']):>18}"
              f"  hold {_rupees(a['holding']):>16}"
              f"  {'FREEZE' if a['freeze_recommended'] else '      '}  {a['stopped'] or ''}")
    if len(r["accounts"]) > 50:
        print(f"  ... {len(r['accounts']) - 50} more (use --json)")
    print(f"fingerprint  : {r['fingerprint']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Trace victims' money through the graph.")
    what = ap.add_mutually_exclusive_group(required=True)
    what.add_argument("--victim", help="the victim's account number")
    what.add_argument("--victims", help="several victims, comma-separated: one merged trace (JSON)")
    what.add_argument("--cell", type=int, help="reverse trace: the victims of this cell (JSON)")
    what.add_argument("--network", type=int,
                      help="reverse trace: the victims of this network (JSON)")
    what.add_argument("--cell-summary", type=int, help="summary of this cell (JSON)")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to read (default: {DEFAULT_DB})")
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    args = ap.parse_args()

    if args.victims:
        result = trace_victims(args.victims.split(","), args.db)
    elif args.cell is not None:
        result = reverse_trace_cell(args.cell, args.db)
    elif args.network is not None:
        result = reverse_trace_network(args.network, args.db)
    elif args.cell_summary is not None:
        result = cell_summary(args.cell_summary, args.db)
    else:
        result = trace_victim(args.victim, args.db)
    if args.json or not result["found"] or not args.victim:
        print(json.dumps(result, indent=2))
    else:
        print_summary(result)


if __name__ == "__main__":
    main()
