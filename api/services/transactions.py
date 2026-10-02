from __future__ import annotations

from datetime import datetime

from api.repositories import transactions as repo
from api.schemas.transactions import TransactionItem, TransactionSearchResponse
from api.services import bank_code, rupees, to_paise


def search(con, profile_id: str, *, min_amount: float | None, max_amount: float | None,
           bank: str | None, payment_mode: str | None, device: str | None,
           foreign_ip: bool | None, narration_category: str | None,
           from_ts: datetime | None, to_ts: datetime | None,
           limit: int) -> TransactionSearchResponse:
    received = {
        "min_amount": min_amount, "max_amount": max_amount, "bank": bank_code(bank),
        "payment_mode": payment_mode, "device": device, "foreign_ip": foreign_ip,
        "narration_category": narration_category, "from_ts": from_ts, "to_ts": to_ts}
    received = {k: v for k, v in received.items() if v is not None and v != ""}
    filters = dict(received)
    for name in ("min_amount", "max_amount"):          # rupees -> paise
        if name in filters:
            value = filters.pop(name)
            filters[f"{name}_paise"] = to_paise(value) if value > 0 else 0
    rows = repo.search(con, profile_id, filters, limit)
    return TransactionSearchResponse(
        matched=repo.count(con, filters), returned=len(rows), limit=limit, filters=received,
        transactions=[
            TransactionItem(
                tx_key=r["tx_key"], txn_id=r["tx_id"], source=r["source"], target=r["target"],
                source_bank=r["source_bank"], target_bank=r["target_bank"],
                amount=rupees(r["amount_paise"]), timestamp=r["ts"], payment_mode=r["mode"],
                narration=r["narration"], narration_category=r["narration_category"] or None,
                device_type=r["device"], ip_address=r["ip"],
                is_foreign_ip=r["is_foreign_ip"], is_headless=r["is_headless"],
                link_type=r["link_type"])
            for r in rows])
