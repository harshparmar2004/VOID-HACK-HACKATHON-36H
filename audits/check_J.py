"""Section J — Device_Type."""
from __future__ import annotations

import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        j1 = con.execute(
            """
            SELECT device, count(*) n
            FROM t GROUP BY 1 ORDER BY n DESC
            """
        ).fetchall()
        vals = [{"device": r[0], "n": r[1]} for r in j1]
        n_other = con.execute(
            """
            SELECT count(*) FROM t
            WHERE device NOT IN ('Android','iOS','Windows_Browser','Web_Emulator','Linux_Script')
               OR device <> trim(device)
            """
        ).fetchone()[0]
        bar_png("J1_device_counts.png", "DEVICE TYPE COUNTS",
                [v["device"][:10] for v in vals], [v["n"] for v in vals])

        mix = con.execute(
            """
            WITH per AS (
              SELECT src_acct,
                     count(DISTINCT device) n_dev,
                     count(DISTINCT CASE WHEN is_headless THEN device END) n_head_dev,
                     count(DISTINCT CASE WHEN NOT is_headless THEN device END) n_phone_dev,
                     count(*) n_tx
              FROM t GROUP BY 1
            )
            SELECT
              count(*) n_accts,
              sum(CASE WHEN n_dev > 1 THEN 1 ELSE 0 END) AS multi_device,
              sum(CASE WHEN n_head_dev > 0 AND n_phone_dev > 0 THEN 1 ELSE 0 END) AS mix_phone_headless,
              max(n_dev) AS max_dev
            FROM per
            """
        ).fetchone()
        mix_ex = rows_to_dicts(
            con,
            """
            SELECT src_acct, count(DISTINCT device) n_dev,
                   list(DISTINCT device) AS devices, count(*) n_tx
            FROM t
            GROUP BY 1
            HAVING count(DISTINCT CASE WHEN is_headless THEN 1 END) > 0
               AND count(DISTINCT CASE WHEN NOT is_headless THEN 1 END) > 0
            ORDER BY n_tx DESC
            LIMIT 5
            """,
        )

        n_head_acct = con.execute(
            "SELECT count(DISTINCT src_acct) FROM t WHERE is_headless"
        ).fetchone()[0]
        n_head_tx = con.execute("SELECT count(*) FROM t WHERE is_headless").fetchone()[0]
        head_hour = con.execute(
            """
            SELECT hour(ts) h, count(*) n FROM t WHERE is_headless
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        head_amt = con.execute(
            """
            SELECT min(amount), approx_quantile(amount,0.5), avg(amount), max(amount)
            FROM t WHERE is_headless
            """
        ).fetchone()
        head_ip = con.execute(
            """
            SELECT count(DISTINCT ip),
                   sum(CAST(is_foreign AS INT)),
                   count(DISTINCT ip_o1)
            FROM t WHERE is_headless
            """
        ).fetchone()
        head_cat = con.execute(
            """
            SELECT narr_cat, count(*) n FROM t WHERE is_headless
            GROUP BY 1 ORDER BY n DESC LIMIT 15
            """
        ).fetchall()
        head_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_acct, dst_acct, amount, ts, ip, device, narration
            FROM t WHERE is_headless USING SAMPLE 5
            """,
        )
        bar_png(
            "J3_headless_by_hour.png",
            "HEADLESS TX BY HOUR",
            [str(r[0]) for r in head_hour],
            [r[1] for r in head_hour],
        )

        # J4 4-way co-occurrence
        j4 = con.execute(
            """
            SELECT
              is_headless,
              is_foreign,
              (hour(ts) BETWEEN 1 AND 4) AS odd_hour,  -- 1,2,3,4 AM; 5:00 still '5'
              (instr(lower(narration), 'crypto')>0 OR instr(lower(narration), 'wallet')>0
               OR instr(lower(narration), 'atm')>0 OR instr(lower(narration), 'cash')>0
               OR instr(lower(narration), 'withdraw')>0 OR instr(lower(narration), 'usdt')>0
               OR instr(lower(narration), 'p2p')>0) AS cashout_kw,
              count(*) n
            FROM t
            GROUP BY 1,2,3,4
            ORDER BY 1 DESC, 2 DESC, 3 DESC, 4 DESC
            """
        ).fetchall()
        j4d = [
            {"headless": r[0], "foreign": r[1], "odd_hour": r[2], "cashout_kw": r[3], "n": r[4]}
            for r in j4
        ]
        all4 = next(
            (r["n"] for r in j4d if r["headless"] and r["foreign"] and r["odd_hour"] and r["cashout_kw"]),
            0,
        )
        h_and_f = con.execute(
            "SELECT count(*) FROM t WHERE is_headless AND is_foreign"
        ).fetchone()[0]
        h_not_f = con.execute(
            "SELECT count(*) FROM t WHERE is_headless AND NOT is_foreign"
        ).fetchone()[0]
        f_not_h = con.execute(
            "SELECT count(*) FROM t WHERE is_foreign AND NOT is_headless"
        ).fetchone()[0]
    finally:
        con.close()

    checks = []
    ls = next((v["n"] for v in vals if v["device"] == "Linux_Script"), 0)
    we = next((v["n"] for v in vals if v["device"] == "Web_Emulator"), 0)
    checks.append(
        rec(
            "J1",
            f"values={vals}; other/whitespace={n_other}; Linux_Script={ls} Web_Emulator={we}",
            int(n_other),
            vals,
            "CLEAN" if n_other == 0 and ls == 1327 and we == 1327 else ("NOISE" if n_other == 0 else "TRAP"),
            "Exact 5 labels; headless pair 1327/1327 confirmed. Do not case-fold.",
            extra={"values": vals},
        )
    )
    n_accts, multi, mix_ph, max_dev = mix
    checks.append(
        rec(
            "J2",
            f"accounts={n_accts}; multi-device={multi}; mix phone+headless={mix_ph}; max distinct devices={max_dev}",
            int(mix_ph),
            mix_ex,
            "SIGNAL" if mix_ph else "CLEAN",
            "Phone+headless mixing on one sender is an M9/M5 feature.",
        )
    )
    checks.append(
        rec(
            "J3",
            f"headless tx={n_head_tx} distinct senders={n_head_acct}; amount min/p50/avg/max={head_amt}; "
            f"distinct IPs={head_ip[0]} foreign_rows={head_ip[1]}; cats={head_cat[:8]}",
            int(n_head_acct),
            head_ex,
            "SIGNAL",
            "Headless senders are a small account set — core L3 signal (M4/M9). See hour plot.",
            extra={
                "hours": [{"h": r[0], "n": r[1]} for r in head_hour],
                "cats": [{"cat": r[0], "n": r[1]} for r in head_cat],
            },
        )
    )
    checks.append(
        rec(
            "J4",
            f"headless AND foreign={h_and_f}; headless not foreign={h_not_f}; foreign not headless={f_not_h}; "
            f"all-four (headless×foreign×odd-hour×cashout-kw)={all4}. matrix={j4d[:12]}",
            int(h_and_f),
            j4d[:5],
            "SIGNAL",
            "Headless and foreign almost perfectly co-occur — treat as one injected L3 signature, not two independent proofs.",
            extra={"matrix": j4d},
        )
    )
    dump_section("J", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
