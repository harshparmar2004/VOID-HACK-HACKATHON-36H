"""
engine/trace.py -- Step 5a of the Abhedya-Chakra pipeline: the victim trace.

    trace_victim(acct_no, db=None)  ->  plain dict (JSON-ready, for the API)

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
    tainted money arrived, inside the profile's trace.fallback_window, ranked
    by the receiver's final_index, until trace.coverage_target of the tainted
    amount is covered.
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
    .venv\\Scripts\\python.exe engine\\trace.py --victim HDFC12345678
    .venv\\Scripts\\python.exe engine\\trace.py --victim HDFC12345678 --json
    .venv\\Scripts\\python.exe engine\\trace.py --victim HDFC12345678 --db %TEMP%\\case_review.duckdb
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
from features import active_profile

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

DEFAULT_DB = ROOT / "data" / "case.duckdb"

MEMORY_LIMIT = "3GB"

NOT_FOUND = {"found": False, "message": "No transaction graph found"}

# Columns of `scores` shown for every traced account.
DETAIL_SQL = (
    "SELECT s.acct_id, s.role, s.role_confirmed, s.final_index, s.mule_index, "
    "       s.trust_index, s.band, s.is_flagged, s.ring_id, s.reasons "
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
                "SELECT acct_id, final_index FROM scores WHERE profile_id = ?",
                [self.profile_id]).fetchnumpy()
            if not len(s["acct_id"]):
                raise SystemExit(
                    f"no scores for profile {self.profile_id} -- run engine\\scoring.py first")
            # An account with no score ranks last in the fallback; it is never
            # given a default risk (guardrail 11).
            self.final = np.full(self.n, -1.0)
            self.final[np.asarray(s["acct_id"])] = np.asarray(s["final_index"], dtype=float)

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

    def _add_details(self, rows: list) -> None:
        for (acct_id, role, confirmed, final, mule, trust, band, flagged,
             ring_id, reasons) in rows:
            self.details[acct_id] = {
                "role": role, "role_confirmed": confirmed,
                "final_index": None if final is None else round(final, 2),
                "mule_index": None if mule is None else round(mule, 2),
                "trust_index": None if trust is None else round(trust, 2),
                "band": band, "is_flagged": flagged, "ring_id": ring_id,
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


def _rank_until_covered(ctx: Context, dst, amt, candidates: np.ndarray,
                        target: float) -> np.ndarray:
    """Fallback choice: receivers by final_index (then amount), until the
    followed amount covers `target`. Returns a mask over the outflow slice."""
    chosen = np.zeros(len(dst), dtype=bool)
    idx = np.flatnonzero(candidates)
    if not len(idx):
        return chosen
    # lexsort: last key is the primary one. Descending risk, then descending
    # amount; equal rows are interchangeable, so no tx_key is consulted.
    order = idx[np.lexsort((-amt[idx], -ctx.final[dst[idx]]))]
    covered = np.cumsum(amt[order])
    n_take = int(np.searchsorted(covered, target, side="left")) + 1
    chosen[order[:n_take]] = True
    return chosen


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
        follow = _rank_until_covered(ctx, dst, o_amt, candidates, ctx.coverage * tainted_in)

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
    if not len(o_ts):
        src["stopped"] = "no_outgoing_transfers"
    else:
        linked = np.isin(o_tx, ctx.link_keys)
        if linked.any():
            via, follow = "layer_link", linked
        else:
            via = "fallback"
            follow = _rank_until_covered(ctx, dst, o_amt, np.ones(len(dst), dtype=bool),
                                         ctx.coverage * float(o_amt.sum()))
        for k in np.flatnonzero(follow):
            amount = int(o_amt[k])
            src["out"] += amount
            transfers.append({"hop": 1, "from": source, "to": int(dst[k]), "tx_key": int(o_tx[k]),
                              "ts": int(o_ts[k]), "amount": amount, "tainted": float(amount),
                              "via": via})
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
            "final_index": d.get("final_index"), "mule_index": d.get("mule_index"),
            "trust_index": d.get("trust_index"), "band": d.get("band"),
            "is_flagged": d.get("is_flagged"), "ring_id": d.get("ring_id"),
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
        })

    accounts = [account(a, nd) for a, nd in
                sorted(nodes.items(), key=lambda kv: (kv[1]["hop"], -kv[1]["in"], ctx.acct_no[kv[0]]))
                if a != source]

    hops = []
    prev_first = None
    for h in sorted({t["hop"] for t in transfers}):
        ts_h = [t["ts"] for t in transfers if t["hop"] == h]
        first = min(ts_h)
        hops.append({
            "hop": h,
            "accounts": sum(1 for a in accounts if a["hop"] == h),
            "transfers": len(ts_h),
            "tainted": int(round(sum(t["tainted"] for t in transfers if t["hop"] == h))),
            "first_ts": _iso(first), "last_ts": _iso(max(ts_h)),
            "seconds_since_previous_hop": None if prev_first is None else first - prev_first,
        })
        prev_first = first

    by_role: dict[str, int] = {}
    for a in accounts:
        by_role[a["role"] or "NONE"] = by_role.get(a["role"] or "NONE", 0) + 1
    all_ts = [t["ts"] for t in transfers]
    keys = sorted(t["tx_key"] for t in transfers)
    return {
        "found": True,
        "profile_id": ctx.profile_id,
        "amount_unit": "paise",
        "victim": account(source, nodes[source]),
        "summary": {
            "tainted_total": int(round(nodes[source]["out"])),
            "accounts": len(accounts),
            "accounts_by_role": dict(sorted(by_role.items())),
            "transfers": len(transfers),
            "hops": max((t["hop"] for t in transfers), default=0),
            "max_hops": ctx.max_hops,
            "holding_total": sum(a["holding"] for a in accounts),
            "untraced_total": sum(a["untraced_out"] for a in accounts),
            "first_ts": _iso(min(all_ts)) if all_ts else None,
            "last_ts": _iso(max(all_ts)) if all_ts else None,
            "seconds_first_to_last": (max(all_ts) - min(all_ts)) if all_ts else None,
            "used_fallback": any(t["via"] == "fallback" for t in transfers),
            "truncated": truncated,
        },
        "hops": hops,
        "accounts": accounts,
        "transfers": out_transfers,
        # Same evidence -> same hash (Section 4.4). tx_key, not tx_id, because
        # Transaction_ID is not unique in this dataset.
        "fingerprint": hashlib.sha256(",".join(map(str, keys)).encode()).hexdigest() if keys else None,
    }


def _rupees(paise: int) -> str:
    return f"Rs {paise / 100:,.2f}"


def print_summary(r: dict) -> None:
    """Human-readable view of a trace (the CLI default)."""
    v, s = r["victim"], r["summary"]
    print(f"victim       : {v['acct_no']} ({v['bank']})  role {v['role']}"
          f"  final {v['final_index']}")
    print(f"profile      : {r['profile_id']}")
    print(f"tainted      : {_rupees(s['tainted_total'])} across {s['hops']} hops,"
          f" {s['accounts']} accounts, {s['transfers']} transfers"
          f" in {s['seconds_first_to_last']} s" if s["transfers"] else
          "tainted      : no outgoing transfers to follow")
    print(f"by role      : {s['accounts_by_role']}")
    print(f"holding      : {_rupees(s['holding_total'])} still held;"
          f" {_rupees(s['untraced_total'])} left on transfers not followed")
    print(f"fallback     : {s['used_fallback']}   truncated: {s['truncated']}")
    for h in r["hops"]:
        print(f"  hop {h['hop']}: {h['accounts']} accounts, {h['transfers']} transfers,"
              f" {_rupees(h['tainted'])}, {h['first_ts']} -> {h['last_ts']}"
              f" (+{h['seconds_since_previous_hop']} s)")
    print("accounts (hop, role, final, tainted in -> out, holding):")
    for a in r["accounts"][:50]:
        print(f"  {a['hop']}  {a['acct_no']}  {str(a['role']):<18} {str(a['final_index']):>6}"
              f"  {_rupees(a['tainted_in']):>18} -> {_rupees(a['tainted_out']):>18}"
              f"  hold {_rupees(a['holding']):>16}  {a['stopped'] or ''}")
    if len(r["accounts"]) > 50:
        print(f"  ... {len(r['accounts']) - 50} more (use --json)")
    print(f"fingerprint  : {r['fingerprint']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Trace one victim's money through the graph.")
    ap.add_argument("--victim", required=True, help="the victim's account number")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB,
                    help=f"DuckDB file to read (default: {DEFAULT_DB})")
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    args = ap.parse_args()

    result = trace_victim(args.victim, args.db)
    if args.json or not result["found"]:
        print(json.dumps(result, indent=2))
    else:
        print_summary(result)


if __name__ == "__main__":
    main()
