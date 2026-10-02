from __future__ import annotations

from api.deps import Profile
from api.repositories import victims as repo
from api.schemas.victims import VictimItem
from api.services import rupees


def list_victims(con, profile: Profile) -> list[VictimItem]:
    return [
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
