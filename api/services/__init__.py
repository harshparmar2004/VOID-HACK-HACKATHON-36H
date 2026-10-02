"""Field mapping from our tables to the names the UI reads. No SQL here."""
from __future__ import annotations

PAISE_PER_RUPEE = 100


def rupees(paise: int | None) -> float | None:
    return None if paise is None else paise / PAISE_PER_RUPEE


def to_paise(amount_rupees: float | None) -> int | None:
    """A min_amount filter in rupees as paise; 0 / missing means no filter."""
    if not amount_rupees or amount_rupees <= 0:
        return None
    return round(amount_rupees * PAISE_PER_RUPEE)


def bank_code(bank_filter: str | None) -> str | None:
    """The UI sends a 4-letter bank code, or ALL / nothing for no filter."""
    code = (bank_filter or "").strip().upper()
    return None if code in ("", "ALL") else code
