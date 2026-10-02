from __future__ import annotations

from api.repositories import fetch_dicts

_CELL_COLUMNS = """
        SELECT c.cell_id, c.network_id, a.acct_no AS l1_account, c.size, c.l1_count,
               c.l2_count, c.l3_count, c.unclassified_count, c.victim_count,
               c.total_in_paise, c.holding_paise, c.first_ts, c.last_ts,
               coalesce(c.patterns, []) AS patterns, c.fingerprint
        FROM cells c
        LEFT JOIN accounts a ON a.acct_id = c.l1_acct
        WHERE c.profile_id = ?"""


def ifsc_of(con, acct_nos: list[str]) -> dict[str, str]:
    return dict(con.execute(
        "SELECT acct_no, ifsc FROM accounts WHERE acct_no IN (SELECT unnest(?))",
        [acct_nos]).fetchall())


def transfer_facts(con, profile_id: str, tx_keys: list[int]) -> dict[int, dict]:
    """Per traced transfer: what `tx` recorded, and the lag of its layer link (if proven)."""
    rows = fetch_dicts(con, """
        SELECT t.tx_key, t.mode, t.narration, t.ip, t.device, l.lag_seconds
        FROM tx t
        LEFT JOIN layer_links l ON l.tx_key = t.tx_key AND l.profile_id = ?
        WHERE t.tx_key IN (SELECT unnest(?))""", [profile_id, tx_keys])
    return {r["tx_key"]: r for r in rows}


def list_cells(con, profile_id: str) -> list[dict]:
    return fetch_dicts(con, _CELL_COLUMNS + " ORDER BY c.cell_id", [profile_id])


def cells_by_id(con, profile_id: str, cell_ids: list[int]) -> list[dict]:
    return fetch_dicts(
        con, _CELL_COLUMNS + " AND c.cell_id IN (SELECT unnest(?)) ORDER BY c.cell_id",
        [profile_id, cell_ids])


def list_networks(con, profile_id: str) -> list[dict]:
    return fetch_dicts(con, """
        SELECT r.ring_id AS network_id,
               (SELECT count(*) FROM cells c
                WHERE c.profile_id = r.profile_id AND c.network_id = r.ring_id) AS cells,
               r.size, r.l1_count, r.l2_count, r.l3_count, r.unclassified_count,
               r.victim_count, r.total_in_paise, r.holding_paise, r.first_ts, r.last_ts,
               coalesce(r.patterns, []) AS patterns, r.fingerprint
        FROM rings r
        WHERE r.profile_id = ?
        ORDER BY r.ring_id""", [profile_id])
