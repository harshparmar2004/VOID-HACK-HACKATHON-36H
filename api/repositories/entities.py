from __future__ import annotations

from api.repositories import banks, fetch_dicts

_FLOWS = """
    flow_in AS (
        SELECT dst AS acct_id, sum(amount_paise) AS in_paise FROM tx GROUP BY dst
    ),
    flow_out AS (
        SELECT src AS acct_id, sum(amount_paise) AS out_paise FROM tx GROUP BY src
    )"""

_FROM = """
    FROM accounts a
    LEFT JOIN scores s ON s.acct_id = a.acct_id AND s.profile_id = ?
    LEFT JOIN features f ON f.acct_id = a.acct_id
    LEFT JOIN flow_in fi ON fi.acct_id = a.acct_id
    LEFT JOIN flow_out fo ON fo.acct_id = a.acct_id"""


def _where(bank: str | None, min_paise: int | None) -> tuple[str, list]:
    where, params = [], []
    if bank is not None:
        where.append("a.bank = ?")
        params.append(bank)
    if min_paise is not None:
        where.append("greatest(coalesce(fi.in_paise, 0), coalesce(fo.out_paise, 0)) >= ?")
        params.append(min_paise)
    return ("WHERE " + " AND ".join(where)) if where else "", params


def list_entities(con, profile_id: str, *, limit: int, bank: str | None,
                  min_paise: int | None) -> list[dict]:
    where, params = _where(bank, min_paise)
    return fetch_dicts(con, f"""
        WITH {_FLOWS}
        SELECT a.acct_no, a.ifsc, a.bank, bd.bank_name, a.first_seen, a.last_seen,
               s.role, s.role_confirmed, s.is_flagged, s.final_index, s.mule_index,
               s.trust_index, s.victim_score, s.band, s.freeze_recommended,
               f.tx_count, f.n_in, f.n_out, f.days_active,
               coalesce(fi.in_paise, 0)  AS in_paise,
               coalesce(fo.out_paise, 0) AS out_paise
        {_FROM}
        {banks.JOIN}
        {where}
        ORDER BY s.final_index DESC NULLS LAST, a.acct_no
        LIMIT ?""", [profile_id] + params + [limit])


def count_entities(con, profile_id: str, *, bank: str | None, min_paise: int | None) -> int:
    where, params = _where(bank, min_paise)
    return con.execute(f"""
        WITH {_FLOWS}
        SELECT count(*)
        {_FROM}
        {where}""", [profile_id] + params).fetchone()[0]


def bank_stats(con) -> list[dict]:
    return fetch_dicts(con, """
        SELECT a.bank AS code, any_value(d.bank_name) AS name, count(*) AS n
        FROM accounts a
        LEFT JOIN bank_directory d ON d.bank_prefix = a.bank
        GROUP BY a.bank
        ORDER BY n DESC, a.bank""")
