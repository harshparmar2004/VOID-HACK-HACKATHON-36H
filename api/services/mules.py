from __future__ import annotations

import json

from api.deps import Profile
from api.repositories import mules as repo
from api.schemas.mules import MuleItem
from api.services import bank_code, rupees, to_paise

REASON_SEPARATOR = "; "


def _role(role_filter: str | None) -> str | None:
    """The UI sends our role (L2) or its own label (L2_DISTRIBUTOR); ALL means no filter.

    A label with no engine role (e.g. L4_TERMINAL) is passed through and matches nothing.
    """
    role = (role_filter or "").strip().upper()
    if role in ("", "ALL"):
        return None
    if role.startswith(("L1", "L2", "L3")):
        return role[:2]
    return role


def list_mules(con, profile: Profile, *, limit: int, role_filter: str | None,
               min_risk: float, min_amount: float, bank_filter: str | None) -> list[MuleItem]:
    rows = repo.list_mules(
        con, profile.profile_id, limit=limit, role=_role(role_filter),
        min_final_index=min_risk if min_risk > 0 else None,
        min_incoming_paise=to_paise(min_amount), bank=bank_code(bank_filter))
    out = []
    for r in rows:
        reasons = r["reasons"] or []
        holding = rupees(r["holding_paise"])
        out.append(MuleItem(
            account=r["acct_no"],
            account_id=r["acct_no"],
            bank=r["bank"],
            bank_name=r["bank_name"],
            ifsc=r["ifsc"],
            bank_ifsc=r["ifsc"],
            role=r["role"],
            risk_index=r["final_index"],
            risk_score=r["final_index"],
            risk_band=r["band"],
            forensic_reason=REASON_SEPARATOR.join(reasons),
            forensic_reasons=reasons,
            reasons=reasons,
            distinct_senders=r["senders"],
            distinct_receivers=r["receivers"],
            total_incoming_amt=rupees(r["in_paise"]),
            total_outgoing_amt=rupees(r["out_paise"]),
            current_holding_balance=holding,
            holding_amount=holding,
            final_index=r["final_index"],
            mule_index=r["mule_index"],
            trust_index=r["trust_index"],
            band=r["band"],
            role_confirmed=r["role_confirmed"],
            freeze_recommended=r["freeze_recommended"],
            param_points=json.loads(r["param_points"]) if r["param_points"] else None,
            cell_ids=r["cell_ids"],
            network_id=r["ring_id"],
        ))
    return out
