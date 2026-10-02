"""Section I — IP_Address."""
from __future__ import annotations

import time

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        n = con.execute("SELECT count(*) FROM t").fetchone()[0]
        # I1 shapes — no LIMIT on the shape list
        shapes = con.execute(
            """
            SELECT
              regexp_replace(ip, '[0-9]+', 'N', 'g') AS shape,
              count(*) n,
              min(length(ip)) AS min_len,
              max(length(ip)) AS max_len
            FROM t
            GROUP BY 1
            ORDER BY n DESC
            """
        ).fetchall()
        shape_d = [{"shape": r[0], "n": r[1], "min_len": r[2], "max_len": r[3]} for r in shapes]

        bad_octet = con.execute(
            """
            SELECT
              sum(CASE WHEN ip_o1 IS NULL OR ip_o2 IS NULL OR ip_o3 IS NULL OR ip_o4 IS NULL THEN 1 ELSE 0 END) AS non_int,
              sum(CASE WHEN ip_o1 > 255 OR ip_o2 > 255 OR ip_o3 > 255 OR ip_o4 > 255 THEN 1 ELSE 0 END) AS gt255,
              sum(CASE WHEN ip_o1 < 0 OR ip_o2 < 0 OR ip_o3 < 0 OR ip_o4 < 0 THEN 1 ELSE 0 END) AS neg
            FROM t
            """
        ).fetchone()
        # leading zeros: octet text like 01, 001, 00
        lead0 = con.execute(
            """
            WITH o AS (
              SELECT ip, split_part(ip,'.',1) a, split_part(ip,'.',2) b,
                     split_part(ip,'.',3) c, split_part(ip,'.',4) d
              FROM t
            )
            SELECT count(*) FROM o
            WHERE (length(a)>1 AND starts_with(a,'0'))
               OR (length(b)>1 AND starts_with(b,'0'))
               OR (length(c)>1 AND starts_with(c,'0'))
               OR (length(d)>1 AND starts_with(d,'0'))
            """
        ).fetchone()[0]
        empty_oct = con.execute(
            """
            SELECT count(*) FROM t
            WHERE split_part(ip,'.',1)='' OR split_part(ip,'.',2)=''
               OR split_part(ip,'.',3)='' OR split_part(ip,'.',4)=''
               OR length(ip) - length(replace(ip,'.','')) <> 3
            """
        ).fetchone()[0]
        i1_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, ip, ip_o1, ip_o2, ip_o3, ip_o4 FROM t
            WHERE ip_o1 > 255 OR ip_o2 > 255 OR ip_o3 > 255 OR ip_o4 > 255
               OR ip_o1 IS NULL OR length(ip)-length(replace(ip,'.','')) <> 3
            LIMIT 5
            """,
        )

        n_v6 = con.execute("SELECT count(*) FROM t WHERE instr(ip, ':') > 0").fetchone()[0]
        n_non_ip = con.execute(
            r"SELECT count(*) FROM t WHERE regexp_full_match(ip, '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$') = false"
        ).fetchone()[0]
        i2_ex = rows_to_dicts(
            con,
            r"SELECT tx_id, ip FROM t WHERE regexp_full_match(ip, '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$') = false LIMIT 5",
        )

        reserved = con.execute(
            """
            SELECT
              sum(CASE WHEN ip_o1 = 10 THEN 1 ELSE 0 END) AS rfc_10,
              sum(CASE WHEN ip_o1 = 172 AND ip_o2 BETWEEN 16 AND 31 THEN 1 ELSE 0 END) AS rfc_172,
              sum(CASE WHEN ip_o1 = 192 AND ip_o2 = 168 THEN 1 ELSE 0 END) AS rfc_192168,
              sum(CASE WHEN ip_o1 = 127 THEN 1 ELSE 0 END) AS loopback,
              sum(CASE WHEN ip_o1 = 0 THEN 1 ELSE 0 END) AS o_zero,
              sum(CASE WHEN ip_o1 >= 224 THEN 1 ELSE 0 END) AS mcast,
              sum(CASE WHEN ip_o1 = 169 AND ip_o2 = 254 THEN 1 ELSE 0 END) AS link_local
            FROM t
            """
        ).fetchone()
        res_names = ["rfc_10", "rfc_172", "rfc_192168", "loopback", "o_zero", "mcast", "link_local"]
        res = dict(zip(res_names, reserved))
        res_n = sum(res.values())
        res_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, ip, src_acct FROM t
            WHERE ip_o1=10 OR (ip_o1=172 AND ip_o2 BETWEEN 16 AND 31)
               OR (ip_o1=192 AND ip_o2=168) OR ip_o1=127 OR ip_o1=0
               OR ip_o1>=224 OR (ip_o1=169 AND ip_o2=254)
            LIMIT 5
            """,
        )

        octets = con.execute(
            "SELECT ip_o1, count(*) n FROM t GROUP BY 1 ORDER BY n DESC"
        ).fetchall()
        oct_d = [{"o1": r[0], "n": r[1]} for r in octets]
        n_185 = next((x["n"] for x in oct_d if x["o1"] == 185), 0)
        n_194 = next((x["n"] for x in oct_d if x["o1"] == 194), 0)
        n_103 = next((x["n"] for x in oct_d if x["o1"] == 103), 0)
        other_non103 = [x for x in oct_d if x["o1"] not in (103, 185, 194)]
        bar_png("I4_first_octet.png", "IP FIRST OCTET COUNTS",
                [str(x["o1"]) for x in oct_d[:15]], [x["n"] for x in oct_d[:15]])

        top_ip = rows_to_dicts(
            con,
            """
            SELECT ip, count(*) AS n_tx, count(DISTINCT src_acct) AS n_senders
            FROM t GROUP BY 1 ORDER BY n_senders DESC, n_tx DESC LIMIT 20
            """,
            limit=20,
        )

        ip_per_src = con.execute(
            """
            SELECT
              count(*) AS n_accts,
              min(n_ip), approx_quantile(n_ip,0.5), approx_quantile(n_ip,0.99), max(n_ip)
            FROM (
              SELECT src_acct, count(DISTINCT ip) n_ip FROM t GROUP BY 1
            )
            """
        ).fetchone()
        switchers = con.execute(
            """
            SELECT count(*) FROM (
              SELECT src_acct
              FROM t
              GROUP BY 1
              HAVING sum(CAST(is_foreign AS INT)) > 0
                 AND sum(CAST(is_foreign AS INT)) < count(*)
            )
            """
        ).fetchone()[0]
        sw_ex = rows_to_dicts(
            con,
            """
            SELECT src_acct,
                   count(DISTINCT ip) n_ip,
                   sum(CAST(is_foreign AS INT)) n_foreign,
                   count(*) n_tx
            FROM t
            GROUP BY 1
            HAVING sum(CAST(is_foreign AS INT)) > 0
               AND sum(CAST(is_foreign AS INT)) < count(*)
            ORDER BY n_tx DESC
            LIMIT 5
            """,
        )

        foreign_prof = con.execute(
            """
            SELECT
              count(*) n,
              count(DISTINCT src_acct) n_accts,
              count(DISTINCT device) n_dev,
              avg(amount) avg_amt
            FROM t WHERE is_foreign
            """
        ).fetchone()
        f_dev = con.execute(
            "SELECT device, count(*) n FROM t WHERE is_foreign GROUP BY 1 ORDER BY n DESC"
        ).fetchall()
        f_mode = con.execute(
            "SELECT mode, count(*) n FROM t WHERE is_foreign GROUP BY 1 ORDER BY n DESC"
        ).fetchall()
        f_cat = con.execute(
            """
            SELECT narr_cat, count(*) n FROM t WHERE is_foreign
            GROUP BY 1 ORDER BY n DESC LIMIT 15
            """
        ).fetchall()
        f_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, src_acct, ip, device, mode, amount, narration
            FROM t WHERE is_foreign USING SAMPLE 5
            """,
        )
    finally:
        con.close()

    checks = []
    non_int, gt255, neg = bad_octet
    checks.append(
        rec(
            "I1",
            f"shapes={shape_d}; non-int octets={non_int}; >255={gt255}; neg={neg}; "
            f"leading-zero octets={lead0}; empty/wrong-dot-count={empty_oct}",
            int(gt255 + empty_oct + non_int),
            i1_ex if i1_ex else shape_d[:5],
            "TRAP" if gt255 or empty_oct else ("NOISE" if lead0 else "CLEAN"),
            "Validate 4 integer octets 0-255. Leading zeros are cosmetic; do not rewrite IPs.",
            extra={"shapes": shape_d},
        )
    )
    checks.append(
        rec(
            "I2",
            f"contains colon (IPv6?)={n_v6}; not dotted-decimal={n_non_ip}",
            int(n_non_ip),
            i2_ex,
            "CLEAN" if n_non_ip == 0 else "TRAP",
            "IPv6/non-IP should go to rejects; none expected.",
        )
    )
    checks.append(
        rec(
            "I3",
            f"private/reserved counts={res} total={res_n}",
            int(res_n),
            res_ex,
            "CLEAN" if res_n == 0 else "NOISE",
            "is_reserved_ip should cover 10/8, 172.16/12, 192.168/16, 127/8, 0/8, 224+, 169.254. Current file has none.",
            extra=res,
        )
    )
    checks.append(
        rec(
            "I4",
            f"103.x={n_103}, 185.x={n_185}, 194.x={n_194}; other first-octets={other_non103}",
            int(n_185 + n_194),
            oct_d[:10],
            "SIGNAL" if n_185 + n_194 else "CLEAN",
            "Foreign = 185.x or 194.x only on this file. Do not treat other non-103 as foreign without evidence.",
            extra={"octets": oct_d},
        )
    )
    max_senders = top_ip[0]["n_senders"] if top_ip else 0
    checks.append(
        rec(
            "I5",
            f"top IP by distinct senders has {max_senders} senders. top5={top_ip[:5]}",
            int(max_senders),
            top_ip[:5],
            "SIGNAL" if max_senders and max_senders >= 10 else "CLEAN",
            "Shared-IP cluster is M5; strong only with foreign/headless.",
            extra={"top20": top_ip},
        )
    )
    n_accts, mn, p50, p99, mx = ip_per_src
    checks.append(
        rec(
            "I6",
            f"distinct IPs per sender: min={mn} p50={p50} p99={p99} max={mx}; "
            f"accounts mixing domestic+foreign={switchers} / {n_accts}",
            int(switchers),
            sw_ex,
            "SIGNAL" if switchers else "CLEAN",
            "Domestic↔foreign switching is an M9 bot feature. Do not reject those rows.",
        )
    )
    fn, facc, fdev, favg = foreign_prof
    checks.append(
        rec(
            "I7",
            f"foreign rows={fn} accounts={facc} devices={f_dev} modes={f_mode} avg_amount={favg}; "
            f"top cats={f_cat[:8]}",
            int(fn),
            f_ex,
            "SIGNAL",
            "Foreign IP co-occurs with headless/cash-out — L3/M4. Profile in extra.",
            extra={
                "devices": [{"device": r[0], "n": r[1]} for r in f_dev],
                "modes": [{"mode": r[0], "n": r[1]} for r in f_mode],
                "cats": [{"cat": r[0], "n": r[1]} for r in f_cat],
            },
        )
    )
    dump_section("I", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
