"""Profile description and the in-memory preview. Nothing here writes the case file."""
from __future__ import annotations

import contextlib
import copy
import io
import json
import sys
import threading
import time

import duckdb
from fastapi import HTTPException

from api.deps import ROOT, db_path
from api.repositories import preview as preview_repo
from api.repositories import profiles as repo
from api.schemas.profiles import (
    AccountList, BeforeAfter, CountChange, FinalInfo, GateInfo, NeverScored, ParameterInfo,
    PreviewAccount, PreviewRequest, PreviewResponse, ProfileChanges, ProfileResponse,
    RoleChanges, RoleTransition, TwoSignalRule)

# The engine modules import each other by bare name (same directory).
ENGINE_DIR = ROOT / "engine"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

import links as links_engine  # noqa: E402
import scoring as scoring_engine  # noqa: E402

# A two-signal rule asking for fewer than two signals is a disabled rule.
TWO_SIGNAL_FLOOR = 2

# One preview at a time: each one re-scores every account in memory.
_LOCK = threading.Lock()


def _one_line(text: str | None) -> str:
    return " ".join((text or "").split())


def _groups(definition: dict) -> list[dict]:
    """Every parameter of a profile, in the order the engine scores them."""
    return (definition["mule_index"]["parameters"]
            + definition["mule_index"].get("zero_weight_parameters", [])
            + definition["trust_index"]["parameters"])


def _scored(p: dict) -> bool:
    return bool(p.get("enabled")) and p["weight"] > 0


def describe(row: dict) -> ProfileResponse:
    d = json.loads(row["definition"])
    gates = {g["id"]: g for g in d.get("reliability_gates", [])}
    final = d["final"]
    two = final["flag"]["two_signal_rule"]
    return ProfileResponse(
        profile_id=row["profile_id"], is_active=row["is_active"], is_locked=row["is_locked"],
        created_at=row["created_at"], version=d.get("version"),
        description=_one_line(d.get("description")) or None,
        mule_total_weight=d["mule_index"]["total_weight"],
        trust_total_weight=d["trust_index"]["total_weight"],
        min_tx_for_trust=d["trust_index"].get("min_tx_for_trust"),
        parameters=[
            ParameterInfo(
                id=p["id"], name=p["name"], index=p.get("index"), weight=p["weight"],
                enabled=bool(p.get("enabled")), scored=_scored(p), gate=p.get("gate"),
                gate_status=gates.get(p.get("gate"), {}).get("status"),
                scoring_pass=p.get("pass", 1), features=p.get("features", []),
                thresholds=p.get("rule") or {},
                description=_one_line(p.get("rule_text")) or p["name"],
                disabled_reason=_one_line(p.get("disabled_reason")) or None)
            for p in _groups(d)],
        never_score=[NeverScored(id=n["id"], name=n["name"], reason=_one_line(n.get("reason")))
                     for n in d["mule_index"].get("never_score", [])],
        gates=[GateInfo(id=g["id"], status=g.get("status"), gates=g.get("gates", []),
                        description=g.get("description"), measured=g.get("measured"),
                        reason=_one_line(g.get("reason")) or None)
               for g in d.get("reliability_gates", [])],
        final=FinalInfo(
            formula=final.get("formula"),
            trust_discount_factor=final["trust_discount_factor"],
            flag_threshold=final["flag"]["threshold"],
            two_signal_rule=TwoSignalRule(
                enabled=bool(two.get("enabled", True)), always_on=two.get("always_on"),
                min_parameters_at_half=two["min_parameters_at_half"], over=two["over"]),
            override_floor=(final.get("override") or {}).get("floor"),
            bands=final.get("bands", [])),
        windows={k: v for k, v in d.get("windows", {}).items() if k != "notes"},
        definition=d)


def _row_or_error(rows: list[dict], what: str) -> dict:
    if len(rows) != 1:
        raise HTTPException(404 if not rows else 503, f"{what}: found {len(rows)}")
    return rows[0]


def get_active(con) -> ProfileResponse:
    rows = repo.active(con)
    if len(rows) != 1:
        raise HTTPException(503, f"expected exactly one active scoring profile, found {len(rows)}")
    return describe(rows[0])


def get_profile(con, profile_id: str) -> ProfileResponse:
    return describe(_row_or_error(repo.by_id(con, profile_id), f"scoring profile {profile_id!r}"))


def apply_changes(definition: dict, changes: ProfileChanges) -> tuple[dict, list[str]]:
    """A changed COPY of the profile and its warnings. Invalid changes -> HTTP 422."""
    d = copy.deepcopy(definition)
    by_id = {p["id"]: p for p in _groups(d)}
    errors = []
    for pid, change in changes.parameters.items():
        p = by_id.get(pid)
        if p is None:
            errors.append(f"unknown parameter {pid!r} (known: {', '.join(by_id)})")
            continue
        if change.weight is not None:
            if change.weight < 0:
                errors.append(f"{pid}: weight cannot be negative")
            p["weight"] = change.weight
        if change.enabled is not None:
            p["enabled"] = change.enabled

    # A zero-weight parameter has no measured thresholds and no scores column.
    for p in d["mule_index"].get("zero_weight_parameters", []):
        if _scored(p):
            errors.append(f"{p['id']} is a zero-weight parameter (not measured on this "
                          "dataset) and cannot be scored in a preview")

    flag = d["final"]["flag"]
    two = flag["two_signal_rule"]
    if changes.two_signal_rule_enabled is False:
        errors.append("the two-signal rule cannot be disabled")
    if changes.min_parameters_at_half is not None:
        if changes.min_parameters_at_half < TWO_SIGNAL_FLOOR:
            errors.append("the two-signal rule cannot be disabled: min_parameters_at_half "
                          f"must be at least {TWO_SIGNAL_FLOOR}")
        two["min_parameters_at_half"] = changes.min_parameters_at_half
    if changes.flag_threshold is not None:
        flag["threshold"] = changes.flag_threshold
    if changes.trust_discount_factor is not None:
        d["final"]["trust_discount_factor"] = changes.trust_discount_factor

    signals = [pid for pid in two["over"] if pid in by_id and _scored(by_id[pid])]
    needed = max(TWO_SIGNAL_FLOOR, two["min_parameters_at_half"])
    if len(signals) < needed:
        errors.append(f"at least {needed} mule parameters must stay enabled with a weight above "
                      f"zero (the two-signal rule); {len(signals)} would remain")
    if errors:
        raise HTTPException(422, "Invalid profile changes: " + "; ".join(errors))

    warnings = []
    for index in ("mule", "trust"):
        total = d[f"{index}_index"]["total_weight"]
        used = sum(p["weight"] for p in by_id.values() if p.get("index") == index and _scored(p))
        if abs(used - total) > 1e-9:
            warnings.append(
                f"{index} weights now sum to {used:g}, not {total:g}: the {index} index can "
                f"reach at most {100.0 * used / total:.1f}. Rebalance the other weights to "
                "compare like with like.")
    if changes.flag_threshold is not None and not any(
            changes.flag_threshold in (b.get("min_inclusive"), b.get("max_exclusive"))
            for b in d["final"].get("bands", [])):
        warnings.append("the flag threshold no longer matches a band boundary; bands were "
                        "left as stored")
    return d, warnings


def _accounts(count: int, rows: list[dict]) -> dict:
    return {"count": count, "truncated": len(rows) < count,
            "accounts": [PreviewAccount(**r) for r in rows]}


def preview(con, request: PreviewRequest) -> PreviewResponse:
    rows = repo.active(con)
    if len(rows) != 1:
        raise HTTPException(503, f"expected exactly one active scoring profile, found {len(rows)}")
    profile_id = rows[0]["profile_id"]
    definition, warnings = apply_changes(json.loads(rows[0]["definition"]), request.changes)

    with _LOCK:
        t0 = time.perf_counter()
        mem = preview_repo.open_memory(db_path(), scoring_engine.MEMORY_LIMIT)
        try:
            preview_repo.set_profile(mem, profile_id, definition)
            # The engine's own steps, in build order, on the in-memory tables.
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    scoring_engine.score(mem, 1, "preview")
                    engine_warnings = links_engine.build(mem, "preview")
                    engine_warnings += scoring_engine.score(mem, 2, "preview")
            except (SystemExit, duckdb.Error) as e:   # the engine refused the changed profile
                raise HTTPException(422, f"Profile cannot be scored: {e}") from e
            preview_repo.compare(mem, profile_id)
            t = preview_repo.totals(mem, profile_id)
            if t["accounts"] != t["stored_rows"]:
                raise HTTPException(503, "stored scores do not cover the previewed accounts")
            limit = request.account_limit
            return PreviewResponse(
                profile_id=profile_id, changes=request.changes,
                warnings=warnings + engine_warnings,
                seconds=round(time.perf_counter() - t0, 3), accounts=t["accounts"],
                flagged_count=t["flagged_after"],
                flagged=CountChange(before=t["flagged_before"], after=t["flagged_after"]),
                flags_gained=AccountList(**_accounts(t["gained"], preview_repo.gained(mem, limit))),
                flags_lost=AccountList(**_accounts(t["lost"], preview_repo.lost(mem, limit))),
                role_changes=RoleChanges(
                    **_accounts(t["role_changes"], preview_repo.role_changed(mem, limit)),
                    transitions=[RoleTransition(**r) for r in preview_repo.role_transitions(mem)]),
                band_counts=BeforeAfter(**preview_repo.counts(mem, "band")),
                role_counts=BeforeAfter(**preview_repo.counts(mem, "role")),
                freeze_recommended=CountChange(before=t["freeze_before"], after=t["freeze_after"]),
                layer_links=CountChange(before=t["links_before"], after=t["links_after"]),
                final_index_changed=t["final_changed"],
                max_final_index_change=t["max_final_change"])
        finally:
            mem.close()
