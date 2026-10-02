"""Section M — leakage and generator hints. Report only; never use as scoring features."""
from __future__ import annotations

import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts

LEAK_WORDS = [
    "mule", "victim", "fraud", "layer", "l1", "l2", "l3",
    "test", "fake", "injected", "ground", "truth", "label",
]


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        # M1 scan several fields
        m1 = []
        for kw in LEAK_WORDS:
            n_narr = con.execute(
                "SELECT count(*) FROM t WHERE instr(lower(narration), ?) > 0", [kw]
            ).fetchone()[0]
            n_id = con.execute(
                "SELECT count(*) FROM t WHERE instr(lower(tx_id), ?) > 0", [kw]
            ).fetchone()[0]
            n_mode = con.execute(
                "SELECT count(*) FROM t WHERE instr(lower(mode), ?) > 0", [kw]
            ).fetchone()[0]
            m1.append({"kw": kw, "narration": n_narr, "tx_id": n_id, "mode": n_mode})
        m1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, narration, src_acct, device FROM t
            WHERE instr(lower(narration), 'mule')>0
               OR instr(lower(narration), 'victim')>0
               OR instr(lower(narration), 'injected')>0
               OR instr(lower(narration), 'l1')>0
               OR instr(lower(narration), 'fraud')>0
            LIMIT 5
            """,
        )

        # M2 range separation
        m2_acct = con.execute(
            """
            SELECT is_headless,
              min(CAST(substr(src_acct,5,8) AS BIGINT)) dmin,
              approx_quantile(CAST(substr(src_acct,5,8) AS BIGINT), 0.5) dp50,
              max(CAST(substr(src_acct,5,8) AS BIGINT)) dmax,
              count(*) n
            FROM t GROUP BY 1
            """
        ).fetchall()
        m2_id = con.execute(
            """
            SELECT is_headless,
              min(CAST(substr(tx_id,4) AS BIGINT)) imin,
              approx_quantile(CAST(substr(tx_id,4) AS BIGINT), 0.5) ip50,
              max(CAST(substr(tx_id,4) AS BIGINT)) imax
            FROM t GROUP BY 1
            """
        ).fetchall()
        m2_bank = con.execute(
            """
            SELECT src_bank,
              avg(CAST(is_headless AS INT)) p_head,
              avg(CAST(is_foreign AS INT)) p_for,
              count(*) n
            FROM t GROUP BY 1 ORDER BY p_head DESC
            """
        ).fetchall()
        m2a = [{"is_headless": r[0], "dmin": r[1], "dp50": r[2], "dmax": r[3], "n": r[4]} for r in m2_acct]
        m2i = [{"is_headless": r[0], "imin": r[1], "ip50": r[2], "imax": r[3]} for r in m2_id]
        m2b = [{"bank": r[0], "p_head": r[1], "p_for": r[2], "n": r[3]} for r in m2_bank]
        h = next((x for x in m2a if x["is_headless"]), None)
        nrm = next((x for x in m2a if not x["is_headless"]), None)
        disjoint_acct = h and nrm and (h["dmax"] < nrm["dmin"] or nrm["dmax"] < h["dmin"])
        hi = next((x for x in m2i if x["is_headless"]), None)
        ni = next((x for x in m2i if not x["is_headless"]), None)
        disjoint_id = hi and ni and (hi["imax"] < ni["imin"] or ni["imax"] < hi["imin"])

        # M3 uniformity
        dev = con.execute(
            """
            SELECT device, count(*) n FROM t
            WHERE device NOT IN ('Web_Emulator','Linux_Script')
            GROUP BY 1 ORDER BY device
            """
        ).fetchall()
        hours = con.execute(
            "SELECT hour(ts) h, count(*) n FROM t GROUP BY 1 ORDER BY 1"
        ).fetchall()
        hour_ns = [r[1] for r in hours]
        mean_h = sum(hour_ns) / len(hour_ns) if hour_ns else 1
        max_dev_h = max(abs(x - mean_h) / mean_h for x in hour_ns) if hour_ns else 0
        phone = [r[1] for r in dev]
        if phone:
            m = sum(phone) / len(phone)
            phone_dev = max(abs(x - m) / m for x in phone)
        else:
            phone_dev = 0
        bar_png("M3_hourly_counts.png", "HOURLY TX COUNTS",
                [str(r[0]) for r in hours], [r[1] for r in hours])
        bar_png("M3_phone_devices.png", "PHONE DEVICE COUNTS",
                [r[0][:10] for r in dev], [r[1] for r in dev])
    finally:
        con.close()

    checks = []
    n_leak = sum(x["narration"] + x["tx_id"] + x["mode"] for x in m1)
    checks.append(
        rec(
            "M1",
            "leakage-word hits: " + ", ".join(
                f"{x['kw']}(narr={x['narration']},id={x['tx_id']})" for x in m1 if x["narration"] or x["tx_id"]
            )
            or "no mule/victim/injected/L1/L2/L3/test/fake tokens in tx_id or narration",
            int(n_leak),
            m1_ex,
            "TRAP" if any(x["kw"] in ("mule", "injected", "victim") and x["narration"] for x in m1) else (
                "NOISE" if n_leak else "CLEAN"
            ),
            "If labels leak into narration, ignore them for scoring (guardrail 9). Report only.",
            extra={"words": m1},
        )
    )
    checks.append(
        rec(
            "M2",
            f"account-digit range disjoint={disjoint_acct} {m2a}; tx_id range disjoint={disjoint_id} {m2i}; "
            f"headless rate by bank={m2b}",
            int(bool(disjoint_acct or disjoint_id)),
            m2b[:5],
            "TRAP" if disjoint_acct or disjoint_id else "CLEAN",
            "LEAKAGE: do NOT score on account-number ranges, tx_id ranges, or bank prefix as a mule label.",
            extra={"acct_range": m2a, "id_range": m2i, "by_bank": m2b},
        )
    )
    checks.append(
        rec(
            "M3",
            f"phone-device max relative deviation from even thirds={phone_dev:.6f} counts={dev}; "
            f"hourly max relative deviation from flat={max_dev_h:.4f}",
            round(phone_dev, 6),
            [{"device": r[0], "n": r[1]} for r in dev],
            "NOISE",
            "Near-even Android/iOS/Windows_Browser split is a generator artefact. Do not treat device thirds as organic.",
            extra={"hours": [{"h": r[0], "n": r[1]} for r in hours], "devices": [{"device": r[0], "n": r[1]} for r in dev]},
        )
    )
    dump_section("M", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
