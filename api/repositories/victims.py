from __future__ import annotations

from api.repositories import banks, fetch_dicts


def list_victims(con, profile_id: str) -> list[dict]:
    """Accounts with role VICTIM; amount / timestamp come from their proven VICTIM_L1 links."""
    return fetch_dicts(con, f"""
        WITH paid AS (
            SELECT l.from_acct          AS acct_id,
                   sum(l.amount_paise)  AS amount_paise,
                   min(t.ts)            AS first_ts,
                   count(*)             AS n_payments
            FROM layer_links l
            JOIN tx t ON t.tx_key = l.tx_key
            WHERE l.profile_id = ? AND l.link_type = 'VICTIM_L1'
            GROUP BY l.from_acct
        ),
        cm AS (
            SELECT acct_id, list(cell_id ORDER BY cell_id) AS cell_ids
            FROM cell_members
            WHERE profile_id = ?
            GROUP BY acct_id
        )
        SELECT a.acct_no, a.ifsc, a.bank, bd.bank_name, s.victim_score, s.ring_id,
               p.amount_paise, p.first_ts, p.n_payments,
               coalesce(cm.cell_ids, []) AS cell_ids
        FROM scores s
        JOIN accounts a ON a.acct_id = s.acct_id
        {banks.JOIN}
        LEFT JOIN paid p ON p.acct_id = s.acct_id
        LEFT JOIN cm ON cm.acct_id = s.acct_id
        WHERE s.profile_id = ? AND s.role = 'VICTIM'
        ORDER BY a.acct_no""", [profile_id, profile_id, profile_id])
