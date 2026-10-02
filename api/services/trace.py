"""Maps engine\\victim_trace.py results to the names the UI reads. No trace logic here.

The engine's Context (graph arrays + profile lookups) is read-only and cached by
the engine itself: it is loaded on the first trace of the process and reused.
"""
from __future__ import annotations

import sys
import threading
from collections import Counter

from fastapi import HTTPException

from api.deps import ROOT, db_path
from api.repositories import trace as repo
from api.schemas.trace import (
    BatchNotFound, BatchResponse, BatchSummary, BatchVictim, CellBrief, CellsResponse,
    CellSummary, CellVictim, CellVictims, FiltersApplied, Finding, FreezeAccount,
    FreezeCandidate, NetworkItem, NetworkResponse, NotFound, PaymentsNotFollowed, PerHop,
    ProfileUsed, Receipt, Reconcile, ReverseVictim, TraceLink, TraceNode, TraceResponse,
    TraceSummary, VictimPayment, VictimShare, Window)
from api.services import bank_code, rupees

# The engine modules import each other by bare name (same directory).
ENGINE_DIR = ROOT / "engine"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import victim_trace as engine  # noqa: E402

AMOUNT_UNIT = "INR"
SECONDS_PER_MINUTE = 60

# One trace at a time: the context is built once and its lookup cache is shared.
_LOCK = threading.Lock()


def _run(fn, *args):
    """Call an engine function on the API's database. Returns (result, context)."""
    db = db_path()
    with _LOCK:
        try:
            return fn(*args, db), engine.get_context(db)
        except SystemExit as e:      # the engine's "not built yet" messages
            raise HTTPException(503, f"trace engine is not available: {e}") from e


def _profile(ctx) -> ProfileUsed:
    def window(seconds: tuple[int, int]) -> Window:
        return Window(min=seconds[0] / SECONDS_PER_MINUTE, max=seconds[1] / SECONDS_PER_MINUTE)

    return ProfileUsed(
        profile_id=ctx.profile_id, max_hops=ctx.max_hops,
        split_forward_minutes=window(ctx.split_window),
        single_forward_minutes=window(ctx.single_window),
        fallback_minutes=window(ctx.fallback_window),
        coverage_target=ctx.coverage, max_accounts=ctx.max_accounts)


def _node(a: dict, ifsc: dict[str, str]) -> TraceNode:
    shares = a.get("by_victim")
    return TraceNode(
        id=a["acct_no"], hop=a["hop"], role=a["role"], bank=a["bank"],
        ifsc=ifsc.get(a["acct_no"]),
        risk_score=a["victim_score"] if a["role"] == "VICTIM" else a["final_index"],
        holding_amount=rupees(a["holding"]),
        tainted_received=rupees(a["tainted_in"]),
        tainted_forwarded=rupees(a["tainted_out"]),
        final_index=a["final_index"], mule_index=a["mule_index"],
        trust_index=a["trust_index"], victim_score=a["victim_score"], band=a["band"],
        is_flagged=a["is_flagged"], role_confirmed=a["role_confirmed"],
        freeze_recommended=a["freeze_recommended"], reasons=a["reasons"],
        cell_ids=a["cell_ids"], network_id=a["network_id"],
        untraced_out=rupees(a["untraced_out"]),
        account_holding=rupees(a["account_holding"]), stopped=a["stopped"],
        by_victim=None if shares is None else {
            v: VictimShare(
                tainted_received=rupees(p["tainted_in"]),
                tainted_forwarded=rupees(p["tainted_out"]),
                untraced_out=rupees(p["untraced_out"]),
                holding_amount=rupees(p["holding"]),
                share_of_tainted_in=p["share_of_tainted_in"])
            for v, p in shares.items()})


def _root(ctx, acct_no: str, paid: int) -> dict:
    """A victim as the hop-0 node of a merged graph, read from the engine's lookups."""
    a = ctx.id_of[acct_no]
    d = ctx.details.get(a, {})
    return {
        "acct_no": acct_no, "bank": ctx.bank[a], "hop": 0,
        **{k: d.get(k) for k in ("role", "role_confirmed", "final_index", "victim_score",
                                 "mule_index", "trust_index", "band", "is_flagged",
                                 "network_id", "account_holding")},
        "cell_ids": ctx.cells.get(a, []),
        "freeze_recommended": d.get("freeze_recommended", False),
        "reasons": d.get("reasons", []),
        "tainted_in": 0, "tainted_out": paid, "untraced_out": 0, "holding": 0,
        "stopped": None,
    }


def _link(t: dict, facts: dict[int, dict]) -> TraceLink:
    f = facts.get(t["tx_key"], {})
    shares = t.get("by_victim")
    return TraceLink(
        source=t["from"], target=t["to"], amount=rupees(t["amount"]), timestamp=t["ts"],
        txn_id=t["tx_id"], payment_mode=f.get("mode"),
        tx_key=t["tx_key"], link_type=t["link_type"], lag_seconds=f.get("lag_seconds"),
        hop=t["hop"], tainted=rupees(t["tainted"]), via=t["via"],
        confidence=t["confidence"], l1_edge_score=t["l1_edge_score"],
        narration=f.get("narration"), device_type=f.get("device"), ip_address=f.get("ip"),
        by_victim=None if shares is None else {v: rupees(x) for v, x in shares.items()})


def _graph(con, ctx, accounts: list[dict], transfers: list[dict]):
    ifsc = repo.ifsc_of(con, [a["acct_no"] for a in accounts])
    facts = repo.transfer_facts(con, ctx.profile_id, [t["tx_key"] for t in transfers])
    nodes, links = [_node(a, ifsc) for a in accounts], [_link(t, facts) for t in transfers]
    # Device and IP are recorded per transfer, made by the sender: a node gets
    # the most frequent value of its outgoing links in this trace (a tie goes
    # to the earliest transfer).
    sent: dict[str, list[TraceLink]] = {}
    for l in sorted(links, key=lambda l: l.timestamp):
        sent.setdefault(l.source, []).append(l)
    for n in nodes:
        for field in ("device_type", "ip_address"):
            values = Counter(v for l in sent.get(n.id, ()) if (v := getattr(l, field)) is not None)
            if values:
                setattr(n, field, values.most_common(1)[0][0])
    return nodes, links


def _receipt(r: dict) -> Receipt:
    shares = r.get("by_victim")
    return Receipt(
        tx_id=r["tx_id"], tx_key=r["tx_key"], ts=r["ts"], amount=rupees(r["amount"]),
        tainted=rupees(r["tainted"]),
        by_victim=None if shares is None else {v: rupees(x) for v, x in shares.items()})


def _freeze(c: dict) -> FreezeCandidate:
    shares = c.get("by_victim")
    return FreezeCandidate(
        acct_no=c["acct_no"], bank=c["bank"], role=c["role"], hop=c["hop"],
        cell_id=c.get("cell_id"), cell_ids=c["cell_ids"], holding=rupees(c["holding"]),
        tainted_in=rupees(c.get("tainted_in")),
        by_victim=None if shares is None else {v: rupees(x) for v, x in shares.items()},
        receipts=[_receipt(r) for r in c["receipts"]])


def _cell_brief(r: dict) -> CellBrief:
    return CellBrief(
        cell_id=r["cell_id"], network_id=r["network_id"], l1_account=r["l1_account"],
        size=r["size"], l1_count=r["l1_count"], l2_count=r["l2_count"],
        l3_count=r["l3_count"], unclassified_count=r["unclassified_count"],
        victim_count=r["victim_count"], total_in=rupees(r["total_in_paise"]),
        holding=rupees(r["holding_paise"]), first_ts=r["first_ts"], last_ts=r["last_ts"],
        patterns=r["patterns"], fingerprint=r["fingerprint"])


def _cells(con, ctx, cell_ids: list[int]) -> list[CellBrief]:
    if not cell_ids:
        return []
    return [_cell_brief(r) for r in repo.cells_by_id(con, ctx.profile_id, cell_ids)]


def _shown(nodes: list[TraceNode], links: list[TraceLink], roots: set[str], *,
           max_hops: int, min_amount: float | None, bank: str | None, keyword: str | None):
    """Filter what is RETURNED. A link stays when it is within max_hops, is at
    least min_amount, touches the bank and its narration contains the keyword;
    a node stays when a remaining link touches it (the victim always stays)."""
    bank_of = {n.id: n.bank for n in nodes}
    word = (keyword or "").lower()
    kept = [l for l in links
            if l.hop <= max_hops
            and (min_amount is None or l.amount >= min_amount)
            and (bank is None or bank in (bank_of.get(l.source), bank_of.get(l.target)))
            and (not word or word in (l.narration or "").lower())]
    ids = roots | {l.source for l in kept} | {l.target for l in kept}
    return [n for n in nodes if n.id in ids], kept


def trace(con, victim: str, *, max_hops: int | None, min_amount: float,
          bank_filter: str | None, keyword: str | None,
          ignored: list[str]) -> TraceResponse | NotFound:
    r, ctx = _run(engine.trace_victim, victim)
    if not r["found"]:
        return NotFound(message=r["message"])

    root = r["victim"]
    nodes, links = _graph(con, ctx, [root] + r["accounts"], r["transfers"])
    shown_hops = min(max_hops or ctx.max_hops, ctx.max_hops)
    amount = min_amount if min_amount > 0 else None
    bank = bank_code(bank_filter)
    word = (keyword or "").strip() or None
    shown_nodes, shown_links = _shown(
        nodes, links, {root["acct_no"]}, max_hops=shown_hops, min_amount=amount,
        bank=bank, keyword=word)

    s = dict(r["summary"])
    rec = s.pop("reconciliation")
    not_followed = s.pop("payments_not_followed")
    for k in ("tainted_total", "holding_total", "freeze_holding_total", "untraced_total"):
        s[k] = rupees(s[k])
    return TraceResponse(
        nodes=shown_nodes, links=shown_links,
        total_siphoned_inr=s["tainted_total"],
        recoverable_holding_inr=s["freeze_holding_total"],
        display_trimmed=len(shown_links) < len(links) or len(shown_nodes) < len(nodes),
        full_hops=s["hops"],
        victim=root["acct_no"], amount_unit=AMOUNT_UNIT, fingerprint=r["fingerprint"],
        profile=_profile(ctx),
        filters=FiltersApplied(
            max_hops_requested=max_hops, max_hops_shown=shown_hops, min_amount=amount,
            bank_filter=bank, keyword=word, ignored=ignored,
            nodes_total=len(nodes), links_total=len(links),
            nodes_returned=len(shown_nodes), links_returned=len(shown_links)),
        summary=TraceSummary(
            **s, payments_not_followed=PaymentsNotFollowed(
                count=not_followed["count"], amount=rupees(not_followed["amount"]))),
        reconcile=Reconcile(**{k: rupees(v) for k, v in rec.items()}),
        per_hop=[PerHop(**dict(h, tainted=rupees(h["tainted"]))) for h in r["per_hop"]],
        findings=[Finding(**f) for f in r["findings"]],
        freeze_candidates=[_freeze(c) for c in r["freeze_candidates"]],
        cells=_cells(con, ctx, r["summary"]["cell_ids"]))


def trace_batch(con, victims: list[str]) -> BatchResponse | BatchNotFound:
    r, ctx = _run(engine.trace_victims, victims)
    if not r["found"]:
        return BatchNotFound(message=r["message"], not_found=r["not_found"])

    reached = {a["acct_no"] for a in r["accounts"]}
    roots = [_root(ctx, v["acct_no"], v["paid"]) for v in r["victims"]
             if v["acct_no"] not in reached]
    nodes, links = _graph(con, ctx, roots + r["accounts"], r["transfers"])
    s = dict(r["summary"])
    for k in ("tainted_total", "holding_total", "untraced_total"):
        s[k] = rupees(s[k])
    candidates = [_freeze(c) for c in r["freeze_candidates"]]
    return BatchResponse(
        nodes=nodes, links=links,
        total_siphoned_inr=s["tainted_total"],
        recoverable_holding_inr=sum(c.holding for c in candidates),
        amount_unit=AMOUNT_UNIT, fingerprint=r["fingerprint"], profile=_profile(ctx),
        victims=[BatchVictim(**dict(
            v, paid=rupees(v["paid"]), holding_total=rupees(v["holding_total"]),
            untraced_total=rupees(v["untraced_total"]))) for v in r["victims"]],
        not_found=r["not_found"],
        summary=BatchSummary(**s),
        freeze_candidates=candidates,
        cells=_cells(con, ctx, r["summary"]["cell_ids"]))


def list_cells(con, profile_id: str) -> CellsResponse:
    cells = [_cell_brief(r) for r in repo.list_cells(con, profile_id)]
    return CellsResponse(profile_id=profile_id, amount_unit=AMOUNT_UNIT,
                         count=len(cells), cells=cells)


def _cell_or_404(fn, cell_id: int) -> dict:
    r, _ = _run(fn, cell_id)
    if not r["found"]:
        raise HTTPException(404, r["message"])
    return r


def cell(cell_id: int) -> CellSummary:
    r = _cell_or_404(engine.cell_summary, cell_id)
    return CellSummary(**dict(
        r, amount_unit=AMOUNT_UNIT,
        victims=[CellVictim(**dict(v, amount=rupees(v["amount"]))) for v in r["victims"]],
        total_in=rupees(r["total_in"]), holding=rupees(r["holding"]),
        freeze_holding=rupees(r["freeze_holding"]),
        freeze_accounts=[FreezeAccount(**dict(
            f, account_holding=rupees(f["account_holding"]))) for f in r["freeze_accounts"]]))


def cell_victims(cell_id: int) -> CellVictims:
    r = _cell_or_404(engine.reverse_trace_cell, cell_id)
    return CellVictims(**dict(
        r, amount_unit=AMOUNT_UNIT, total_in=rupees(r["total_in"]),
        victims=[ReverseVictim(**dict(
            v, amount=rupees(v["amount"]),
            payments=[VictimPayment(**dict(p, amount=rupees(p["amount"])))
                      for p in v["payments"]])) for v in r["victims"]]))


def networks(con, profile_id: str) -> NetworkResponse:
    items = [
        NetworkItem(
            network_id=r["network_id"], cells=r["cells"], size=r["size"],
            l1_count=r["l1_count"], l2_count=r["l2_count"], l3_count=r["l3_count"],
            unclassified_count=r["unclassified_count"], victim_count=r["victim_count"],
            total_in=rupees(r["total_in_paise"]), holding=rupees(r["holding_paise"]),
            first_ts=r["first_ts"], last_ts=r["last_ts"], patterns=r["patterns"],
            fingerprint=r["fingerprint"])
        for r in repo.list_networks(con, profile_id)]
    return NetworkResponse(profile_id=profile_id, amount_unit=AMOUNT_UNIT,
                           count=len(items), networks=items)
