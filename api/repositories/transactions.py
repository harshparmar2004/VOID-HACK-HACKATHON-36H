from __future__ import annotations

from api.repositories import fetch_dicts

# The narration category, read the way the engine reads it (features.sql).
CATEGORY = "split_part(split_part(t.narration, '/', 2), '#', 1)"

# Whitelist: search field -> (condition, number of bound parameters it takes).
# Only these fragments ever reach the SQL text; every value is a bound parameter.
CONDITIONS: dict[str, tuple[str, int]] = {
    "min_amount_paise": ("t.amount_paise >= ?", 1),
    "max_amount_paise": ("t.amount_paise <= ?", 1),
    "bank": ("(s.bank = ? OR d.bank = ?)", 2),
    "payment_mode": ("lower(t.mode) = lower(?)", 1),
    "device": ("lower(t.device) = lower(?)", 1),
    "foreign_ip": ("t.is_foreign_ip = ?", 1),
    "narration_category": (f"lower({CATEGORY}) = lower(?)", 1),
    "from_ts": ("t.ts >= ?", 1),
    "to_ts": ("t.ts <= ?", 1),
}

_FROM = """
        FROM tx t
        JOIN accounts s ON s.acct_id = t.src
        JOIN accounts d ON d.acct_id = t.dst"""


def _where(filters: dict) -> tuple[str, list]:
    parts, params = [], []
    for field, value in filters.items():
        condition, n = CONDITIONS[field]      # KeyError = not whitelisted
        parts.append(condition)
        params += [value] * n
    return (" WHERE " + " AND ".join(parts) if parts else ""), params


def count(con, filters: dict) -> int:
    where, params = _where(filters)
    return con.execute("SELECT count(*)" + _FROM + where, params).fetchone()[0]


def search(con, profile_id: str, filters: dict, limit: int) -> list[dict]:
    where, params = _where(filters)
    return fetch_dicts(con, f"""
        SELECT t.tx_key, t.tx_id, s.acct_no AS source, d.acct_no AS target,
               s.bank AS source_bank, d.bank AS target_bank, t.amount_paise, t.ts,
               t.mode, t.narration, {CATEGORY} AS narration_category, t.device, t.ip,
               t.is_foreign_ip, t.is_headless,
               (SELECT l.link_type FROM layer_links l
                WHERE l.tx_key = t.tx_key AND l.profile_id = ?) AS link_type
        {_FROM}{where}
        ORDER BY t.ts DESC, t.amount_paise DESC, t.tx_id
        LIMIT ?""", [profile_id] + params + [limit])
