from __future__ import annotations

from fastapi import HTTPException

from api.repositories import scanner as repo
from api.schemas.scanner import (
    FlaggedTransferSummary, ForeignIpSummary, HoldingSummary, LinkageSummary, LinkTypeCount,
    ProblematicTransaction, ScannerSummary)
from api.services import bank_code, rupees, to_paise

# filter_type values that are not a link type. The UI's other tabs (whales,
# hop-2 smurfing) have no counterpart in our data and are refused.
FILTER_LINKED = "ILLEGAL_LINKAGES"     # every proven layer link
FILTER_FOREIGN = "FOREIGN_IP"


def summary(con, profile_id: str) -> ScannerSummary:
    total = repo.totals(con, profile_id)
    types = repo.link_types(con, profile_id)
    held = repo.holding(con, profile_id)
    return ScannerSummary(
        status="success", profile_id=profile_id, records_scanned=repo.tx_total(con),
        multi_ip_geolocation=ForeignIpSummary(
            foreign_ip_txns=total["foreign_n"], total_volume_inr=rupees(total["foreign_paise"])),
        illegal_linkages=LinkageSummary(
            flagged_txns=sum(t["n"] for t in types),
            total_volume_inr=rupees(sum(t["paise"] for t in types))),
        early_intervention=HoldingSummary(
            holding_accounts_at_risk=held["accounts"],
            recoverable_holding_inr=rupees(held["paise"])),
        flagged_transfers=FlaggedTransferSummary(
            count=total["n"], total_volume_inr=rupees(total["paise"])),
        link_types=[LinkTypeCount(link_type=t["link_type"], count=t["n"],
                                  total_volume_inr=rupees(t["paise"])) for t in types])


def problematic(con, profile_id: str, *, limit: int, filter_type: str | None,
                link_type: str | None, min_amount: float | None, bank_filter: str | None,
                keyword: str | None) -> list[ProblematicTransaction]:
    known = [t["link_type"] for t in repo.link_types(con, profile_id)]
    filters: dict = {}
    for name, value in (("filter_type", filter_type), ("link_type", link_type)):
        value = (value or "").strip().upper()
        if value in ("", "ALL"):
            continue
        if name == "filter_type" and value == FILTER_LINKED:
            filters["linked"] = True
        elif name == "filter_type" and value == FILTER_FOREIGN:
            filters["foreign_ip"] = True
        elif value in known:
            filters["link_type"] = value
        else:
            extra = [FILTER_LINKED, FILTER_FOREIGN] if name == "filter_type" else []
            raise HTTPException(422, f"Unknown {name} '{value}'. "
                                     f"Allowed: {', '.join(known + extra)}")
    if to_paise(min_amount):
        filters["min_amount_paise"] = to_paise(min_amount)
    if bank_code(bank_filter):
        filters["bank"] = bank_code(bank_filter)
    if keyword and keyword.strip():
        filters["keyword"] = keyword.strip()
    return [
        ProblematicTransaction(
            Transaction_ID=r["tx_id"], txn_timestamp=r["ts"],
            Sender_Account=r["source"], Sender_IFSC=r["source_ifsc"],
            Receiver_Account=r["target"], Receiver_IFSC=r["target_ifsc"],
            Amount_INR=rupees(r["amount_paise"]), Payment_Mode=r["mode"],
            Narration=r["narration"], IP_Address=r["ip"], Device_Type=r["device"],
            receiver_bank=r["target_bank"], receiver_role=r["target_role"],
            is_foreign_ip=r["is_foreign_ip"],
            holding_balance=rupees(r["target_holding_paise"]),
            tx_key=r["tx_key"], link_type=r["link_type"], lag_seconds=r["lag_seconds"],
            sender_bank=r["source_bank"], sender_role=r["source_role"],
            sender_flagged=r["source_flagged"], receiver_flagged=r["target_flagged"],
            narration_category=r["narration_category"] or None, is_headless=r["is_headless"])
        for r in repo.transfers(con, profile_id, filters, limit)]
