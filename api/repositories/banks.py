from __future__ import annotations

# The join every account query uses to add the bank's name (null if the directory lacks it).
JOIN = "LEFT JOIN bank_directory bd ON bd.bank_prefix = a.bank"


def names(con) -> dict[str, str]:
    """bank prefix -> bank name, from bank_directory (filled by engine\\seed_banks.py)."""
    return dict(con.execute("SELECT bank_prefix, bank_name FROM bank_directory").fetchall())
