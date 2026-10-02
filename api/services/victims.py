from __future__ import annotations

from api.deps import Profile
from api.repositories import victims as repo
from api.schemas.victims import VictimItem, VictimsResponse
from api.services import rupees


def list_victims(con, profile: Profile) -> VictimsResponse:
    items = [
        VictimItem(
            account=r["acct_no"],
            account_id=r["acct_no"],
            bank=r["bank"],
            ifsc=r["ifsc"],
            amount=rupees(r["amount_paise"]),
            timestamp=r["first_ts"],
            payments=r["n_payments"],
            victim_score=r["victim_score"],
            cell_ids=r["cell_ids"],
            network_id=r["ring_id"],
        )
        for r in repo.list_victims(con, profile.profile_id)
    ]
    return VictimsResponse(victims=[i.account for i in items], items=items)
