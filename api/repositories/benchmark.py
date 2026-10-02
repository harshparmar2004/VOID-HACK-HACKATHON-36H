from __future__ import annotations

import sys

from api.deps import ROOT

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# The structural chain is the audit's own: tx alone, no layer_links, no scores, no roles.
from audits.check_trace import structural_chain  # noqa: E402


def victims(con, profile_id: str) -> list[tuple[int, str]]:
    """(acct_id, acct_no) of every account the engine gave the VICTIM role."""
    return con.execute("""
        SELECT a.acct_id, a.acct_no
        FROM scores s
        JOIN accounts a USING (acct_id)
        WHERE s.profile_id = ? AND s.role = 'VICTIM'
        ORDER BY a.acct_no""", [profile_id]).fetchall()


def chain(con, definition: dict, acct_ids: list[int]) -> list[tuple[str, str, int]]:
    """(victim, account, tx_key) rows of the structural chain of these victims."""
    structural_chain(con, definition, acct_ids)      # a TEMP table; the file is not written
    return con.execute("""
        SELECT va.acct_no, a.acct_no, c.tx_key
        FROM chain c
        JOIN accounts va ON va.acct_id = c.victim
        JOIN accounts a  ON a.acct_id  = c.acct""").fetchall()
