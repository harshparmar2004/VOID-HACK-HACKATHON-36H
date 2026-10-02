from __future__ import annotations

from api.repositories import banks, fetch_dicts


def list_mules(con, profile_id: str, *, limit: int, role: str | None,
               min_final_index: float | None, min_incoming_paise: int | None,
               bank: str | None) -> list[dict]:
    """Flagged accounts of the profile with their money totals from tx."""
    where, params = ["s.profile_id = ?", "s.is_flagged"], [profile_id]
    if role is not None:
        where.append("s.role = ?")
        params.append(role)
    if min_final_index is not None:
        where.append("s.final_index >= ?")
        params.append(min_final_index)
    if bank is not None:
        where.append("a.bank = ?")
        params.append(bank)
    params += [profile_id, profile_id]          # cm, then the scores join
    amount = ""
    if min_incoming_paise is not None:
        amount = "WHERE coalesce(fi.in_paise, 0) >= ?"
        params.append(min_incoming_paise)
    params.append(limit)
    return fetch_dicts(con, f"""
        WITH scope AS (
            SELECT s.acct_id
            FROM scores s
            JOIN accounts a ON a.acct_id = s.acct_id
            WHERE {' AND '.join(where)}
        ),
        flow_in AS (
            SELECT dst AS acct_id, sum(amount_paise) AS in_paise,
                   count(DISTINCT src) AS senders
            FROM tx WHERE dst IN (SELECT acct_id FROM scope)
            GROUP BY dst
        ),
        flow_out AS (
            SELECT src AS acct_id, sum(amount_paise) AS out_paise,
                   count(DISTINCT dst) AS receivers
            FROM tx WHERE src IN (SELECT acct_id FROM scope)
            GROUP BY src
        ),
        cm AS (
            SELECT acct_id, list(cell_id ORDER BY cell_id) AS cell_ids
            FROM cell_members
            WHERE profile_id = ?
            GROUP BY acct_id
        )
        SELECT a.acct_no, a.ifsc, a.bank, bd.bank_name,
               s.role, s.role_confirmed, s.final_index, s.mule_index, s.trust_index,
               s.band, s.freeze_recommended, s.holding_paise, s.reasons, s.ring_id,
               CAST(s.param_points AS VARCHAR) AS param_points,
               coalesce(fi.in_paise, 0)   AS in_paise,
               coalesce(fo.out_paise, 0)  AS out_paise,
               coalesce(fi.senders, 0)    AS senders,
               coalesce(fo.receivers, 0)  AS receivers,
               coalesce(cm.cell_ids, [])  AS cell_ids
        FROM scope sc
        JOIN scores s ON s.acct_id = sc.acct_id AND s.profile_id = ?
        JOIN accounts a ON a.acct_id = sc.acct_id
        {banks.JOIN}
        LEFT JOIN flow_in fi ON fi.acct_id = sc.acct_id
        LEFT JOIN flow_out fo ON fo.acct_id = sc.acct_id
        LEFT JOIN cm ON cm.acct_id = sc.acct_id
        {amount}
        ORDER BY s.final_index DESC, a.acct_no
        LIMIT ?""", params)
