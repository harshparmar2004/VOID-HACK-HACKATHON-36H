"""
engine/seed_profile.py -- seed scoring_profiles from engine/config.yaml.

engine/config.yaml is the authored source of truth for every weight and
threshold; this script validates it and writes it verbatim into
scoring_profiles.definition as JSON (PROJECT_CONTEXT.md Section 8 rule 5).

The row is replaced on every run (DELETE then INSERT for that profile_id only),
so editing config.yaml and rerunning is safe. Other profiles are untouched.
A locked profile is the one used for the jury evaluation, so it is written
is_locked = true and must not be edited in place -- a change means a NEW
profile_id, which is what the UI's "save" flow creates.

Usage:  .venv\\Scripts\\python.exe engine\\seed_profile.py
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import duckdb
import yaml

ENGINE_DIR = Path(__file__).resolve().parent
ROOT = ENGINE_DIR.parent

CONFIG_PATH = ENGINE_DIR / "config.yaml"
DB_PATH = ROOT / "data" / "case.duckdb"

MEMORY_LIMIT = "3GB"


def validate(cfg: dict) -> list[str]:
    """Section 10 profile validation. Returns the list of checks that passed."""
    v = cfg.get("validation", {})
    passed: list[str] = []
    problems: list[str] = []

    mule = cfg["mule_index"]["parameters"]
    zero = cfg["mule_index"].get("zero_weight_parameters", [])
    trust = cfg["trust_index"]["parameters"]

    # No negative weights anywhere.
    negatives = [p["id"] for p in (mule + zero + trust) if p["weight"] < 0]
    for role, spec in cfg["roles"]["scores"].items():
        negatives += [f"{role}.{k}" for k, w in spec["weights"].items() if w < 0]
    if negatives:
        problems.append(f"negative weights: {negatives}")
    else:
        passed.append("no negative weights")

    # At least two enabled parameters.
    n_enabled = sum(1 for p in mule + trust if p.get("enabled"))
    if n_enabled < v.get("min_enabled_parameters", 2):
        problems.append(f"only {n_enabled} enabled parameters")
    else:
        passed.append(f"{n_enabled} enabled parameters")

    # The two-signal rule may never be switched off.
    ts = cfg["final"]["flag"]["two_signal_rule"]
    if not (ts.get("enabled") and ts.get("always_on")):
        problems.append("two-signal rule is not always on")
    else:
        passed.append(f"two-signal rule on (>= {ts['min_parameters_at_half']} params at half)")

    # Weight sums.
    for label, total, want in (
        ("mule MP1-MP8", sum(p["weight"] for p in mule), v.get("mule_weights_must_sum_to")),
        ("trust T1-T7", sum(p["weight"] for p in trust), v.get("trust_weights_must_sum_to")),
    ):
        if want is not None and total != want:
            problems.append(f"{label} weights sum to {total}, expected {want}")
        else:
            passed.append(f"{label} weights sum to {total}")

    want_role = v.get("role_weights_must_sum_to")
    for role, spec in cfg["roles"]["scores"].items():
        total = sum(spec["weights"].values())
        if want_role is not None and total != want_role:
            problems.append(f"role {role} weights sum to {total}, expected {want_role}")
        else:
            passed.append(f"role {role} weights sum to {total}")

    # Zero-weight parameters must really be zero.
    nonzero = [p["id"] for p in zero if p["weight"] != 0]
    if nonzero:
        problems.append(f"zero_weight_parameters with a non-zero weight: {nonzero}")
    else:
        passed.append(f"{len(zero)} zero-weight parameters all at weight 0")

    # Every role the CHECK constraint allows must be declared.
    allowed = set(cfg["roles"]["allowed_roles"])
    expected = {"L1", "L2", "L3", "UNCLASSIFIED_MULE", "VICTIM"}
    if allowed != expected:
        problems.append(f"allowed_roles {sorted(allowed)} != {sorted(expected)}")
    else:
        passed.append("allowed_roles match the scores.role CHECK")

    if problems:
        raise SystemExit("profile validation FAILED:\n  - " + "\n  - ".join(problems))
    return passed


def main() -> None:
    if not CONFIG_PATH.is_file():
        raise SystemExit(f"config not found: {CONFIG_PATH}")

    cfg = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    profile_id = cfg["profile_id"]
    passed = validate(cfg)

    definition = json.dumps(cfg, ensure_ascii=False, sort_keys=False)

    con = duckdb.connect(str(DB_PATH))
    try:
        con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
        con.execute("DELETE FROM scoring_profiles WHERE profile_id = ?", [profile_id])
        con.execute(
            "INSERT INTO scoring_profiles "
            "(profile_id, created_at, is_active, is_locked, definition) "
            "VALUES (?, ?, ?, ?, ?)",
            [profile_id, datetime.now(),
             bool(cfg.get("is_active", False)), bool(cfg.get("is_locked", False)),
             definition],
        )

        print(f"config     : {CONFIG_PATH}")
        print(f"profile_id : {profile_id}")
        print("validation :")
        for line in passed:
            print(f"    OK  {line}")
        print(f"definition : {len(definition):,} bytes of JSON")
        print(f"parameters : {len(cfg['mule_index']['parameters'])} mule"
              f" + {len(cfg['mule_index'].get('zero_weight_parameters', []))} zero-weight"
              f" + {len(cfg['trust_index']['parameters'])} trust"
              f" + {len(cfg['roles']['scores'])} role scores")
        print(f"gates      : {len(cfg['reliability_gates'])}"
              f" ({sum(1 for g in cfg['reliability_gates'] if g['status'] == 'closed')} closed)")
        for r in con.execute(
                "SELECT profile_id, is_active, is_locked, created_at "
                "FROM scoring_profiles ORDER BY profile_id").fetchall():
            print(f"    row: {r[0]}  active={r[1]}  locked={r[2]}  {r[3]}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
