from __future__ import annotations

from api.deps import Profile
from api.repositories import entities as repo
from api.schemas.entities import BankStat, EntitiesResponse, EntityItem
from api.services import bank_code, rupees, to_paise

# Display label per engine role (scores.role); None = neither flagged nor a victim.
TYPE_LABELS = {
    "VICTIM": "Victim",
    "L1": "L1",
    "L2": "L2",
    "L3": "L3",
    "UNCLASSIFIED_MULE": "Unclassified mule",
    None: "Not flagged",
}


def _risk(band: str | None, final_index: float | None) -> str | None:
    if band is None or final_index is None:
        return None
    return f"{band.upper()} ({final_index:.1f})"


def list_entities(con, profile: Profile, *, limit: int, bank_filter: str | None,
                  min_amount: float) -> EntitiesResponse:
    bank, min_paise = bank_code(bank_filter), to_paise(min_amount)
    rows = repo.list_entities(con, profile.profile_id, limit=limit, bank=bank,
                              min_paise=min_paise)
    entities = [
        EntityItem(
            account=r["acct_no"],
            bank=r["bank"],
            ifsc=r["ifsc"],
            type=TYPE_LABELS.get(r["role"], r["role"]),
            totalIn=rupees(r["in_paise"]),
            totalOut=rupees(r["out_paise"]),
            balance=rupees(r["in_paise"] - r["out_paise"]),
            risk=_risk(r["band"], r["final_index"]),
            role=r["role"],
            role_confirmed=r["role_confirmed"],
            is_flagged=r["is_flagged"],
            final_index=r["final_index"],
            mule_index=r["mule_index"],
            trust_index=r["trust_index"],
            victim_score=r["victim_score"],
            band=r["band"],
            freeze_recommended=r["freeze_recommended"],
            tx_count=r["tx_count"],
            n_in=r["n_in"],
            n_out=r["n_out"],
            days_active=r["days_active"],
            first_seen=r["first_seen"],
            last_seen=r["last_seen"],
        )
        for r in rows
    ]
    stats = repo.bank_stats(con)
    total = sum(b["n"] for b in stats)
    return EntitiesResponse(
        entities=entities,
        bank_stats=[BankStat(code=b["code"], name=b["name"], count=b["n"],
                             share=round(100.0 * b["n"] / total, 2) if total else 0.0)
                    for b in stats],
        total_accounts=total,
        matched=repo.count_entities(con, profile.profile_id, bank=bank, min_paise=min_paise),
        returned=len(entities),
        profile_id=profile.profile_id,
    )
