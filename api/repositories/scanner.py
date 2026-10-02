from __future__ import annotations

from api.repositories import fetch_dicts
from api.repositories.transactions import CATEGORY

# A transfer is in the explorer if it is a proven layer link of the profile or
# its sender or receiver is a flagged account. Takes the profile id 3 times.
_FROM = """
        FROM tx t
        JOIN accounts s ON s.acct_id = t.src
        JOIN accounts d ON d.acct_id = t.dst
        LEFT JOIN layer_links l ON l.tx_key = t.tx_key AND l.profile_id = ?
        LEFT JOIN scores ss ON ss.acct_id = t.src AND ss.profile_id = ?
        LEFT JOIN scores sd ON sd.acct_id = t.dst AND sd.profile_id = ?
        WHERE (l.tx_key IS NOT NULL OR coalesce(ss.is_flagged, FALSE)
               OR coalesce(sd.is_flagged, FALSE))"""

# Whitelist: filter -> (condition, number of bound parameters it takes).
CONDITIONS: dict[str, tuple[str, int]] = {
    "link_type": ("l.link_type = ?", 1),
    "linked": ("l.tx_key IS NOT NULL", 0),
    "foreign_ip": ("t.is_foreign_ip", 0),
    "min_amount_paise": ("t.amount_paise >= ?", 1),
    "bank": ("(s.bank = ? OR d.bank = ?)", 2),
    "keyword": (f"contains(lower({CATEGORY}), lower(?))", 1),
}


def _where(filters: dict) -> tuple[str, list]:
    parts, params = [], []
    for field, value in filters.items():
        condition, n = CONDITIONS[field]      # KeyError = not whitelisted
        parts.append(condition)
        params += [value] * n
    return "".join(f" AND {p}" for p in parts), params


def transfers(con, profile_id: str, filters: dict, limit: int) -> list[dict]:
    where, params = _where(filters)
    return fetch_dicts(con, f"""
        SELECT t.tx_key, t.tx_id, t.ts, s.acct_no AS source, s.ifsc AS source_ifsc,
               s.bank AS source_bank, d.acct_no AS target, d.ifsc AS target_ifsc,
               d.bank AS target_bank, t.amount_paise, t.mode, t.narration,
               {CATEGORY} AS narration_category, t.ip, t.device, t.is_foreign_ip,
               t.is_headless, l.link_type, l.lag_seconds,
               ss.role AS source_role, sd.role AS target_role,
               coalesce(ss.is_flagged, FALSE) AS source_flagged,
               coalesce(sd.is_flagged, FALSE) AS target_flagged,
               sd.holding_paise AS target_holding_paise
        {_FROM}{where}
        ORDER BY t.ts DESC, t.amount_paise DESC, t.tx_id
        LIMIT ?""", [profile_id] * 3 + params + [limit])


def totals(con, profile_id: str) -> dict:
    return fetch_dicts(con, f"""
        SELECT count(*)                                                        AS n,
               coalesce(sum(t.amount_paise), 0)                                AS paise,
               count(*) FILTER (WHERE t.is_foreign_ip)                         AS foreign_n,
               coalesce(sum(t.amount_paise) FILTER (WHERE t.is_foreign_ip), 0) AS foreign_paise
        {_FROM}""", [profile_id] * 3)[0]


def link_types(con, profile_id: str) -> list[dict]:
    return fetch_dicts(con, """
        SELECT link_type, count(*) AS n, sum(amount_paise) AS paise
        FROM layer_links
        WHERE profile_id = ?
        GROUP BY link_type
        ORDER BY link_type""", [profile_id])


def holding(con, profile_id: str) -> dict:
    return fetch_dicts(con, """
        SELECT count(*) FILTER (WHERE holding_paise > 0) AS accounts,
               coalesce(sum(holding_paise), 0)           AS paise
        FROM scores
        WHERE profile_id = ? AND is_flagged""", [profile_id])[0]


def tx_total(con) -> int:
    return con.execute("SELECT count(*) FROM tx").fetchone()[0]
