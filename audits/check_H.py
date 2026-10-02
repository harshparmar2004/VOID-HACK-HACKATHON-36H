"""Section H — Narration."""
from __future__ import annotations

import time
import unicodedata

from _common import bar_png, connect, dump_section, print_checks, rec, rows_to_dicts

KEYWORDS = [
    "crypto", "usdt", "p2p", "binance", "wazirx", "wallet", "gateway", "atm",
    "cash", "withdraw", "offshore", "task", "bonus", "invest", "ipo", "kyc",
    "customs", "arrest", "cbi", "police", "loan", "refund", "betting", "hawala", "mule",
]
INJECT = [
    "ignore", "previous", "instruction", "system", "assistant", "prompt", "override",
]


def main() -> None:
    t0 = time.perf_counter()
    con = connect()
    try:
        n = con.execute("SELECT count(*) FROM t").fetchone()[0]
        # H1 structure
        h1 = con.execute(
            """
            SELECT
              sum(CASE WHEN regexp_full_match(narration, '^(UPI|IMPS|NEFT|RTGS)/[^/]+/[^#]+#[0-9]+$') THEN 1 ELSE 0 END) AS hash_pat,
              sum(CASE WHEN regexp_full_match(narration, '^(UPI|IMPS|NEFT)/[^/]+/.+_[0-9]+$') THEN 1 ELSE 0 END) AS uscore_pat,
              sum(CASE WHEN regexp_full_match(narration, '^(UPI|IMPS|NEFT|RTGS)/[^/]+/.+$') THEN 1 ELSE 0 END) AS three_part,
              sum(CASE WHEN narration IS NULL OR trim(narration)='' THEN 1 ELSE 0 END) AS empty
            FROM t
            """
        ).fetchone()
        nonmatch = con.execute(
            """
            SELECT narration, count(*) n
            FROM t
            WHERE regexp_full_match(narration, '^(UPI|IMPS|NEFT|RTGS)/[^/]+/.+$') = false
            GROUP BY 1 ORDER BY n DESC LIMIT 10
            """
        ).fetchall()
        n_non = con.execute(
            """
            SELECT count(*) FROM t
            WHERE regexp_full_match(narration, '^(UPI|IMPS|NEFT|RTGS)/[^/]+/.+$') = false
            """
        ).fetchone()[0]
        # sample of actual pattern
        samples = rows_to_dicts(
            con, "SELECT narration FROM t USING SAMPLE 5", limit=5
        )

        # H2 categories rarest first
        cats = con.execute(
            """
            SELECT coalesce(nullif(narr_cat,''), '(empty)') AS cat, count(*) n
            FROM t GROUP BY 1 ORDER BY n ASC, cat
            """
        ).fetchall()
        cat_all = [{"cat": r[0], "n": r[1]} for r in cats]
        rare = cat_all[:15]
        common = cat_all[-10:]
        n_cat = len(cat_all)
        bar_png(
            "H2_rarest_categories.png",
            "RAREST NARRATION CATEGORIES",
            [c["cat"][:8] for c in rare[:12]],
            [c["n"] for c in rare[:12]],
        )

        # H3 keywords
        kw_rows = []
        for kw in KEYWORDS:
            cnt = con.execute(
                "SELECT count(*) FROM t WHERE instr(lower(narration), ?) > 0",
                [kw],
            ).fetchone()[0]
            kw_rows.append({"kw": kw, "n": cnt})
        # examples for top keywords
        top_kw = sorted(kw_rows, key=lambda x: -x["n"])[:8]
        kw_ex = []
        for item in top_kw[:5]:
            if item["n"] == 0:
                continue
            kw_ex.extend(
                rows_to_dicts(
                    con,
                    f"SELECT tx_id, narration, device, is_headless FROM t "
                    f"WHERE instr(lower(narration), '{item['kw']}') > 0 LIMIT 1",
                    limit=1,
                )
            )

        # H4 injection-like
        inj_counts = []
        for kw in INJECT:
            cnt = con.execute(
                "SELECT count(*) FROM t WHERE instr(lower(narration), ?) > 0",
                [kw],
            ).fetchone()[0]
            inj_counts.append({"kw": kw, "n": cnt})
        special = con.execute(
            """
            SELECT
              sum(CASE WHEN instr(narration, '{{')>0 THEN 1 ELSE 0 END) AS mustache,
              sum(CASE WHEN instr(narration, '${')>0 THEN 1 ELSE 0 END) AS dollar,
              sum(CASE WHEN instr(lower(narration), '<script')>0 THEN 1 ELSE 0 END) AS script,
              sum(CASE WHEN instr(narration, '</')>0 THEN 1 ELSE 0 END) AS close_xml,
              sum(CASE WHEN instr(narration, ''' OR')>0 OR instr(lower(narration), ''' or')>0 THEN 1 ELSE 0 END) AS or_sql,
              sum(CASE WHEN instr(upper(narration), 'DROP')>0 THEN 1 ELSE 0 END) AS drop_kw,
              sum(CASE WHEN instr(narration, '--')>0 THEN 1 ELSE 0 END) AS dashdash,
              sum(CASE WHEN instr(narration, ';')>0 THEN 1 ELSE 0 END) AS semicolon
            FROM t
            """
        ).fetchone()
        spec_names = ["mustache", "dollar", "script", "close_xml", "or_sql", "drop_kw", "dashdash", "semicolon"]
        spec = dict(zip(spec_names, special))
        inj_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, narration FROM t
            WHERE instr(narration, '{{')>0 OR instr(narration, '${')>0
               OR instr(lower(narration), '<script')>0 OR instr(narration, '</')>0
               OR instr(narration, '--')>0 OR instr(narration, ';')>0
               OR instr(upper(narration), 'DROP')>0
            LIMIT 5
            """,
        )

        # H5 non-ascii / length
        h5 = con.execute(
            """
            SELECT
              min(length(narration)), approx_quantile(length(narration),0.5),
              approx_quantile(length(narration),0.99), max(length(narration)),
              sum(CASE WHEN length(narration) > 200 THEN 1 ELSE 0 END) AS long200
            FROM t
            """
        ).fetchone()
        # non-ascii: DuckDB regexp
        n_non_ascii = con.execute(
            r"SELECT count(*) FROM t WHERE regexp_matches(narration, '[^\x00-\x7F]')"
        ).fetchone()[0]
        non_ascii_ex = rows_to_dicts(
            con,
            r"SELECT tx_id, narration FROM t WHERE regexp_matches(narration, '[^\x00-\x7F]') LIMIT 5",
        )
        # zero-width samples: pull a small sample of narrations with high length or weird chars
        zw_n = con.execute(
            """
            SELECT count(*) FROM t
            WHERE instr(narration, chr(8203))>0 OR instr(narration, chr(8204))>0
               OR instr(narration, chr(8205))>0 OR instr(narration, chr(65279))>0
            """
        ).fetchone()[0]

        # H6 embedded accounts/IFSC/amounts that don't match the row
        h6 = con.execute(
            """
            WITH x AS (
              SELECT tx_id, src_acct, dst_acct, src_ifsc, dst_ifsc, amount_raw, narration,
                     regexp_extract_all(narration, '[A-Z]{4}[0-9]{8}') AS accts,
                     regexp_extract_all(narration, '[A-Z]{4}0[A-Z0-9]{6}') AS ifscs
              FROM t
            )
            SELECT
              sum(CASE WHEN len(accts) > 0 THEN 1 ELSE 0 END) AS n_has_acct_token,
              sum(CASE WHEN len(ifscs) > 0 THEN 1 ELSE 0 END) AS n_has_ifsc_token
            FROM x
            """
        ).fetchone()
        h6_mismatch = con.execute(
            """
            WITH x AS (
              SELECT tx_id, src_acct, dst_acct, narration,
                     regexp_extract_all(narration, '[A-Z]{4}[0-9]{8}') AS accts
              FROM t
            ),
            u AS (SELECT tx_id, src_acct, dst_acct, narration, unnest(accts) AS tok FROM x)
            SELECT count(*) FROM u
            WHERE tok <> src_acct AND tok <> dst_acct
            """
        ).fetchone()[0]
        h6_ex = rows_to_dicts(
            con,
            """
            WITH x AS (
              SELECT tx_id, src_acct, dst_acct, narration,
                     regexp_extract_all(narration, '[A-Z]{4}[0-9]{8}') AS accts
              FROM t
            ),
            u AS (SELECT tx_id, src_acct, dst_acct, narration, unnest(accts) AS tok FROM x)
            SELECT tx_id, src_acct, dst_acct, tok, narration
            FROM u WHERE tok <> src_acct AND tok <> dst_acct
            LIMIT 5
            """,
        )

        # H7 #<number> or trailing _number
        h7 = con.execute(
            """
            SELECT
              sum(CASE WHEN regexp_matches(narration, '#[0-9]+$') THEN 1 ELSE 0 END) AS hash_ref,
              sum(CASE WHEN regexp_matches(narration, '_[0-9]+$') THEN 1 ELSE 0 END) AS uscore_ref,
              count(DISTINCT regexp_extract(narration, '_([0-9]+)$', 1)) AS n_distinct_uscore
            FROM t
            """
        ).fetchone()
        n_ref_eq_txid = con.execute(
            """
            SELECT count(*) FROM t
            WHERE regexp_extract(narration, '_([0-9]+)$', 1) <> ''
              AND ('TXN' || regexp_extract(narration, '_([0-9]+)$', 1)) = tx_id
            """
        ).fetchone()[0]
        n_ref_eq_any = con.execute(
            """
            WITH refs AS (
              SELECT regexp_extract(narration, '_([0-9]+)$', 1) AS ref
              FROM t
              WHERE regexp_extract(narration, '_([0-9]+)$', 1) <> ''
            )
            SELECT count(*) FROM refs r
            JOIN (SELECT DISTINCT tx_id FROM t) x
              ON x.tx_id = 'TXN' || r.ref
            """
        ).fetchone()[0]
        dup_ref = con.execute(
            """
            SELECT count(*) FROM (
              SELECT regexp_extract(narration, '_([0-9]+)$', 1) AS ref, count(*) n
              FROM t
              WHERE regexp_extract(narration, '_([0-9]+)$', 1) <> ''
              GROUP BY 1 HAVING count(*) > 1
            )
            """
        ).fetchone()[0]
        h7_ex = rows_to_dicts(
            con,
            """
            SELECT tx_id, narration, regexp_extract(narration, '_([0-9]+)$', 1) AS ref
            FROM t WHERE regexp_extract(narration, '_([0-9]+)$', 1) <> ''
            LIMIT 5
            """,
        )

        # H8 categories vs headless/foreign
        h8 = con.execute(
            """
            SELECT narr_cat,
              count(*) n,
              sum(CAST(is_headless AS INT)) AS n_headless,
              sum(CAST(is_foreign AS INT)) AS n_foreign,
              avg(CAST(is_headless AS INT)) AS p_headless
            FROM t
            GROUP BY 1
            HAVING sum(CAST(is_headless AS INT)) > 0
            ORDER BY p_headless DESC, n DESC
            LIMIT 20
            """
        ).fetchall()
        h8d = [
            {"cat": r[0], "n": r[1], "n_headless": r[2], "n_foreign": r[3], "p_headless": r[4]}
            for r in h8
        ]
        bar_png(
            "H8_headless_by_category.png",
            "HEADLESS COUNT BY NARR CAT",
            [r["cat"][:8] for r in h8d[:12]],
            [r["n_headless"] for r in h8d[:12]],
        )
    finally:
        con.close()

    checks = []
    hash_pat, uscore_pat, three_part, empty = h1
    checks.append(
        rec(
            "H1",
            f"hash #n pattern={hash_pat}/{n}; underscore _n pattern={uscore_pat}/{n}; "
            f"3-part RAIL/CAT/DETAIL={three_part}/{n}; empty={empty}; non-3-part={n_non}",
            int(n - three_part),
            [{"hash_pat": hash_pat, "uscore_pat": uscore_pat, "samples": samples},
             *[{"narration": r[0], "n": r[1]} for r in nonmatch[:3]]],
            "NOISE" if hash_pat == 0 and uscore_pat > n * 0.9 else ("TRAP" if n_non > 0 else "CLEAN"),
            "Do not require '#<number>'. Real pattern is RAIL/CATEGORY/DETAIL_digits. Quarantine non-3-part only.",
        )
    )
    checks.append(
        rec(
            "H2",
            f"{n_cat} distinct category segments. rarest={rare[:5]}; most common={list(reversed(common))[:5]}",
            n_cat,
            rare[:5],
            "SIGNAL",
            "Rare categories are candidate M4 cash-out markers. Build narr_flags from a measured list, not guesses.",
            extra={"rarest": rare, "common": list(reversed(common))},
        )
    )
    n_kw_hit = sum(x["n"] for x in kw_rows if x["n"])
    checks.append(
        rec(
            "H3",
            "keyword hits: " + ", ".join(f"{x['kw']}={x['n']}" for x in kw_rows if x["n"]),
            int(n_kw_hit),
            kw_ex[:5],
            "SIGNAL" if n_kw_hit else "CLEAN",
            "Score cash-out/scam keywords in later narration segments (M4). Do not send raw narration to the LLM.",
            extra={"keywords": kw_rows},
        )
    )
    inj_n = sum(x["n"] for x in inj_counts) + sum(spec.values())
    checks.append(
        rec(
            "H4",
            f"injection-like words={inj_counts}; special tokens={spec}",
            int(inj_n),
            inj_ex,
            "TRAP" if spec.get("script") or spec.get("mustache") else ("NOISE" if inj_n else "CLEAN"),
            "Never send raw Narration to the LLM. Treat injection-like hits as untrusted text, not mule labels.",
            extra={"words": inj_counts, "special": spec},
        )
    )
    mn, p50, p99, mx, long200 = h5
    checks.append(
        rec(
            "H5",
            f"length min={mn} p50={p50} p99={p99} max={mx} >200={long200}; "
            f"non-ascii rows={n_non_ascii}; zero-width rows={zw_n}",
            int(n_non_ascii + zw_n + long200),
            non_ascii_ex,
            "TRAP" if n_non_ascii or zw_n else "CLEAN",
            "Strip/flag zero-width and non-ASCII before any LLM; keep original in rejects/evidence.",
        )
    )
    has_acct, has_ifsc = h6
    checks.append(
        rec(
            "H6",
            f"rows with account-like token in narration={has_acct}; IFSC-like={has_ifsc}; "
            f"account tokens not equal to sender/receiver={h6_mismatch}",
            int(h6_mismatch),
            h6_ex,
            "TRAP" if h6_mismatch else "CLEAN",
            "If decoy account numbers appear in narration, never copy them into notices; always use src/dst columns.",
        )
    )
    hash_ref, uscore_ref, n_dist = h7
    checks.append(
        rec(
            "H7",
            f"#digit suffix={hash_ref}; _digit suffix={uscore_ref} ({n_dist} distinct); "
            f"ref equals own tx_id={n_ref_eq_txid}; ref equals some tx_id={n_ref_eq_any}; duplicated refs={dup_ref}",
            int(uscore_ref),
            h7_ex,
            "NOISE",
            "Trailing _digits is a generator reference, not Transaction_ID. Do not join on it.",
        )
    )
    checks.append(
        rec(
            "H8",
            f"categories with any headless row (top by headless rate)={h8d[:8]}",
            int(sum(x["n_headless"] for x in h8d)),
            h8d[:5],
            "SIGNAL" if h8d and h8d[0]["p_headless"] and h8d[0]["p_headless"] > 0.2 else "CLEAN",
            "Co-occurrence of category × headless/foreign is an L3/M4 feature. Do not use rail prefix.",
            extra={"cats": h8d},
        )
    )
    dump_section("H", checks, time.perf_counter() - t0)
    print_checks(checks)


if __name__ == "__main__":
    main()
