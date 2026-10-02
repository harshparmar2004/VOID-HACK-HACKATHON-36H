# Traps report — dataset audit (TRAP_CHECKLIST.md)

Independent data audit of `data\VoidHacks8_MuleAccount_2M_Transactions.csv`.
**No project code was modified. `data\case.duckdb` was not opened. `abhedya\` was not touched.**

Analysis used `.venv\Scripts\python.exe` + **in-memory DuckDB** (`duckdb.connect()`, never the file DB).
The CSV was loaded once with `read_csv(..., all_varchar=true)` into `%TEMP%\abhedya_src.parquet` /
`abhedya_t.parquet`, then queried. Printed results are aggregates or `LIMIT` ≤ 50.

**Tools actually used:** DuckDB 1.5.6, pyarrow (parquet), Python stdlib (`hashlib` unused, `re` via SQL,
`ipaddress` unused — octets via SQL). **Not installed in `.venv`:** matplotlib, scipy, igraph, networkx,
scikit-learn, polars. Plots are stdlib PNG bar charts. Graph checks are DuckDB SQL (igraph not available).

| Field | Value |
|---|---|
| Report written | 2026-10-02 08:14:34 |
| DuckDB | **1.5.6** |
| CSV rows | **2,000,000** |
| Distinct accounts | 24,873 |
| Window | 2026-09-15 00:00:00 → 2026-09-29 23:59:58 (15 dates, 14-day span) |
| Scripts | `audits\check_A.py` … `check_N.py` (rerunnable) |
| Figures | `reports\figures\*.png` |

### Run time per section (seconds)

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | parquet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30.9 | 1.9 | 25.6 | 2.7 | 3.4 | 2.9 | 1.6 | 5.5 | 3.5 | 3.6 | 2.3 | 6.1 | 2.0 | 1.1 | 7.9 |

Total wall time of section scripts ≈ **93 s** after parquet build.

**Auditor overrides** (script verdict kept in JSON; table below uses the corrected call):
- **F7** script SIGNAL → **NOISE** (every one of 21,600 minutes has ≥50 senders = generator density).
- **L14** script SIGNAL → **INCONCLUSIVE** (`burst_fanin` fires on 23,500 / 24,873 accounts).
- **M2** script CLEAN (ranges not disjoint) → **TRAP** as leakage *warning* (headless tails sit in a tight band).
- **H2** script SIGNAL → **NOISE** (143k “categories” are `Name#id` tokens, not rare scam types).
- **E7** script SIGNAL → **NOISE** (`50.0` × 8,698 is the generator floor, not structuring).

---

## Summary

| ID | Verdict | Count | One-line finding |
|---|---|---|---|
| A1 | CLEAN | 0 | UTF-8, no BOM |
| A2 | CLEAN | 0 | Header matches the 11 expected names exactly |
| A3 | CLEAN | 0 | Every parsed row has 11 fields (2,000,000) |
| A4 | CLEAN | 0 | Physical lines = 2,000,001 = header + rows + trailing LF |
| A5 | CLEAN | 0 | Unix LF only, not mixed |
| A6 | CLEAN | 0 | No quoted fields, no commas inside fields |
| A7 | CLEAN | 0 | No non-UTF-8, no control bytes, no non-ASCII |
| A8 | CLEAN | 0 | No full-row duplicates |
| B1 | NOISE | 4,502 | 2,250 duplicate IDs (2,248×2, 2×3) — known collisions |
| B2 | CLEAN | 0 | No space/case/prefix variants on Transaction_ID |
| B3 | CLEAN | 0 | All IDs match `^TXN[0-9]{9}$` |
| B4 | CLEAN | — | ID vs time corr ≈ 0; ~50% inversions (IDs not sequential) |
| B5 | CLEAN | 0 | Headless IDs overlap the full ID range (no ID-range leak) |
| C1 | CLEAN | 0 | `^[A-Z]{4}[0-9]{8}$` and prefix = IFSC prefix, all rows |
| C2 | CLEAN | 0 | No whitespace/lowercase account variants |
| C3 | CLEAN | 0 | No account with more than one IFSC |
| C4 | CLEAN | 0 | No self-transfers |
| C5 | CLEAN | 24,873 | 300 send-only, 385 recv-only, 24,188 both |
| C6 | NOISE | 45,168 | Dense same-bank hamming-1 neighbours (generator numbering) |
| C7 | CLEAN | 10 | 10 bank prefixes; payments-bank headless rate not elevated (ratio 1.15) |
| C8 | CLEAN | 0 | Digit ranges overlap, but see M2 band concentration |
| C9 | CLEAN | 350 | tx/account p50=169 max=221; 350 singleton involvements |
| D1 | CLEAN | 0 | IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`; 5th char always 0 |
| D2 | CLEAN | 10 | Exactly 10 prefixes (PS claim holds) |
| D3 | NOISE | 8,708 | Branch 6-char codes reused across banks |
| D4 | CLEAN | 200,460 | 10.0% intra-bank; 19 same-IFSC rows |
| E1 | CLEAN | 0 | All amounts numeric; no commas/symbols |
| E2 | CLEAN | 0 | No zero/negative amounts |
| E3 | NOISE | 0 | Mix of 1 dp (208,046) and 2 dp (1,791,954); none >2 dp |
| E4 | CLEAN | 0 | min ₹50 max ₹499,823.99 (under ₹10 lakh) |
| E5 | NOISE | 198 | Round multiples of ₹100 are rare (0.01%) |
| E6 | NOISE | 723 | Near-limit clusters small (mostly ₹9,999 ±1%) |
| E7 | NOISE | 8,698 | Exact amount `50.0` is the floor (generator), not a mule tell |
| E8 | NOISE | 60,102 | Rail limits ignored: 59,747/59,823 RTGS below ₹2 lakh |
| E9 | NOISE | χ²=1365 | First digits fail Benford (generator) |
| E10 | SIGNAL | 2,654 | Headless median ₹41k vs normal ₹899 |
| F1 | CLEAN | 0 | All timestamps parse as `%Y-%m-%d %H:%M:%S` |
| F2 | CLEAN | 0 | 15-day window 15–29 Sep 2026; no future/old rows |
| F3 | CLEAN | 0 | No hour=24 / sec=60 style fields |
| F4 | CLEAN | 0 | All 15 days and 24 hours present; almost flat |
| F5 | CLEAN | 33,165 | Seconds take all 60 values (~3.3% are `:00`) |
| F6 | CLEAN | 11 | Max exact-ts collision = 11 rows |
| F7 | NOISE | 21,600 | **Every minute** of the window has ≥50 senders |
| F8 | CLEAN | — | File order is **not** time order (decrease share 0.50) |
| G1 | CLEAN | 0 | UPI 1,299,844 · IMPS 441,199 · NEFT 199,134 · RTGS 59,823 |
| G2 | NOISE | 0 | Narration rail ~71/14/14 UPI/IMPS/NEFT for **every** mode |
| H1 | TRAP | 285,541 | 14% of rows are 2-part `RAIL/CAT#n`, not 3-part |
| H2 | NOISE | 143,283 | “Rare categories” are `FriendSplit#id` 2-part tokens |
| H3 | SIGNAL | 4,581 | crypto/p2p/wallet = 1,327 each; task/refund = 300 |
| H4 | CLEAN | 0 | No prompt-injection / SQL / `{{` / `<script` text |
| H5 | CLEAN | 0 | Narration length 21–33; no non-ASCII / zero-width |
| H6 | CLEAN | 0 | No decoy account/IFSC tokens in narration |
| H7 | NOISE | 2,954 | Trailing `_digits` is not a Transaction_ID |
| H8 | SIGNAL | 2,654 | `P2A` and `WALLET_LOAD` are 100% headless+foreign |
| I1 | CLEAN | 0 | Single shape `N.N.N.N`; no octet >255 / leading zeros |
| I2 | CLEAN | 0 | No IPv6 / non-IP |
| I3 | CLEAN | 0 | No RFC1918 / loopback / multicast / 169.254 |
| I4 | SIGNAL | 2,654 | Only 103.x (domestic), 185.x (1,327), 194.x (1,327) |
| I5 | CLEAN | 5 | Max distinct senders per IP = 5 (no big shared-IP cluster) |
| I6 | CLEAN | 0 | **Zero** accounts mix domestic and foreign IPs |
| I7 | SIGNAL | 2,654 | Foreign ⇒ only Web_Emulator/Linux_Script; avg ₹61k |
| J1 | CLEAN | 0 | 5 labels; Linux_Script=1,327 and Web_Emulator=1,327 |
| J2 | CLEAN | 0 | 0 phone+headless mix; phones mix Android/iOS/Windows |
| J3 | SIGNAL | 688 | 688 distinct headless senders; unique IP per headless tx |
| J4 | SIGNAL | 2,654 | Headless ⇔ foreign (perfect); 198 also odd-hour+cashout-kw |
| K1 | CLEAN | 0 | 0 account-prefix vs IFSC-prefix mismatches |
| K2 | CLEAN | 0 | No account changes bank prefix across rows |
| K3 | NOISE | 60,102 | Same as E8 — generator does not obey rail limits |
| K4 | SIGNAL | 0 | Foreign IP never appears on iOS/Android/Windows_Browser |
| L1 | CLEAN | 0 | No high-fan-in / low-outflow decoy merchants |
| L2 | NOISE | 319 | Long-history ≥90% pass-through exists (payroll/merchant-like) |
| L3 | SIGNAL | 23,502 | 123 inflows forwarded at 0s; 23,502 in <3 min (14,785 accts) |
| L4 | SIGNAL | 359 | 359 inflows with 3–7 receivers in 15 min; **zero** with >7 |
| L5 | SIGNAL | 4,681 | 5,990 inflows with 60-min out ≈ 95–99% of in (ratio often 0.98) |
| L6 | CLEAN | 0 | No equal-sized 3–7 splits (cv<0.02) |
| L7 | NOISE | 22,731 | Most accounts go “negative” from a 0 start (unknown opening bal) |
| L8 | SIGNAL | 685 | 300 send-only (incl. ₹5 lakh single outs); 385 recv-only sinks |
| L9 | NOISE | 3,636 | Reciprocal pairs common; 4,346 triangles on 6,266-node subgraph |
| L10 | SIGNAL | 29 | 29 accounts with ≥5 tx packed into <2 hours |
| L11 | CLEAN | 0 | No dormant-then-single-day-burst pattern at the threshold used |
| L12 | CLEAN | 0 | No “victim-like 1–3 outs” that later receive large inflows |
| L13 | NOISE | 19,208 | Sample of 30k edges: many 2-hops only work if time is ignored |
| L14 | INCONCLUSIVE | 13,082 | Loose 2-of-4 flags over-count; `burst_fanin` is almost everyone |
| M1 | CLEAN | 0 | No mule/victim/injected/L1/L2/L3 tokens in ID or narration |
| M2 | TRAP | 2,654 | Headless sender tails concentrated in 10000303–10001099 (**leakage**) |
| M3 | NOISE | — | Phone devices split to 0.05%; hours flat to 0.7% |
| N1 | NOISE | 4,502 | Duplicate Transaction_ID — already decided (`tx_key`) |
| N2 | CLEAN | 0 | 4 letters + 8 digits — already decided |
| N3 | NOISE | 0 | Rail vs mode mismatch — already decided, do not score |

---

## Top findings

The 10 most important TRAPs / SIGNALs (and one leakage warning). Queries ran on in-memory table `t`
built from the CSV (all_varchar then typed). Examples trimmed to 3 rows.

### 1. J4 / K4 / I4 — Headless ⇔ foreign IP ⇔ 185.x/194.x (SIGNAL)

Injected L3 signature is **one** combo, not independent signals.

```sql
SELECT count(*) FROM t WHERE is_headless AND is_foreign;          -- 2654
SELECT count(*) FROM t WHERE is_headless AND NOT is_foreign;      -- 0
SELECT count(*) FROM t WHERE is_foreign AND NOT is_headless;      -- 0
SELECT ip_o1, count(*) FROM t GROUP BY 1 ORDER BY 2 DESC;
-- 103: 1997346, 185: 1327, 194: 1327
SELECT device, count(*) FROM t WHERE is_foreign GROUP BY 1;
-- Web_Emulator 1327, Linux_Script 1327
```

688 distinct senders, 2,654 rows, unique IP per headless tx. **Do not add M4 foreign + M4 headless as two proofs.**

### 2. H8 / H3 — Cash-out narration is 100% that same 2,654 rows (SIGNAL)

```sql
SELECT narr_cat, count(*) n,
       sum(CAST(is_headless AS INT)) n_headless
FROM t GROUP BY 1 HAVING sum(CAST(is_headless AS INT)) > 0
ORDER BY n_headless DESC;
-- P2A         1327 / 1327 headless (Web_Emulator + IMPS)
-- WALLET_LOAD 1327 / 1327 headless (Linux_Script + UPI + P2P_CRYPTO)
```

Keyword hits: crypto=1327, p2p=1327, wallet=1327, task=300, refund=300. Example:
`TXN515751130` · `UPI/WALLET_LOAD/P2P_CRYPTO_2360` · Linux_Script · 194.x.

`narr_flags` should key on `WALLET_LOAD`, `P2A`, `P2P_CRYPTO`, `TASK`, `REFUND` — not the rail prefix.

### 3. E10 — Headless amounts are ~45× the normal median (SIGNAL)

| | n | median | p90 | avg | max |
|---|---|---|---|---|---|
| normal | 1,997,346 | ₹899 | ₹3,668 | ₹1,682 | ₹499,824 |
| headless | 2,654 | ₹41,165 | ₹147,651 | ₹61,349 | ₹452,221 |

L3 cash-out is large-value, not smurfed ₹50–₹1,000.

### 4. L5 — Commission band often **exactly 2%** (SIGNAL)

```sql
-- 60-min out_sum in [0.95, 0.99] * in_amt
-- 5990 inflows, 4681 accounts
```

Examples (ratio = 0.980000):

| acct | in_amt | out_sum | n_out |
|---|---|---|---|
| IPOS10000334 | 499823.99 | 489827.51 | 5 |
| SBIN10000392 | 496878.67 | 486941.09 | 4 |
| HDFC10000429 | 496130.24 | 486207.64 | 5 |

Treat `out/in ≈ 0.98` as an L2/M3 feature. Allocate outflows without double-counting (guardrail 16).

### 5. L8 — 300 send-only sources and 385 sinks (SIGNAL)

```sql
-- send-only 300, recv-only 385 of 24873
```

Send-only examples are **one outflow near the file max**:

| acct | n_out | out_amt |
|---|---|---|
| SBIN10000294 | 1 | 499823.99 |
| AXIS10000018 | 1 | 496878.67 |
| HDFC10000062 | 1 | 496130.24 |

These look like injected victims, not organic users. Recv-only are L3-sink candidates.

### 6. L3 / L4 — Fast forward exists; 3–7 splits are rare; never >7 (SIGNAL)

15-minute inflow→outflow join: **115,423** matched inflows (dense-sender cap unused; max out-degree 221).

- next out at **0 seconds**: 123 inflows / 123 accounts
- next out **< 3 min**: 23,502 inflows / 14,785 accounts
- distinct receivers in 15 min: 1 → 111,791; 2 → 3,273; **3–7 → 359**; **>7 → 0**

The PS “3–7 split” exists but is small. Do not hard-reject fan-out of 2 or of 8. Velocity windows must include sub-3-minute (and 0s) holds.

### 7. H1 — Narration is not always 3-part `RAIL/CAT/DETAIL#n` (TRAP)

| Pattern | Rows |
|---|---|
| `^(UPI\|IMPS\|NEFT\|RTGS)/[^/]+/[^#]+#[0-9]+$` (3-part + hash) | 1,569,833 |
| 3-part `RAIL/CAT/DETAIL` | 1,714,459 |
| 2-part samples `IMPS/FriendSplit#29109` | **285,541** |
| trailing `_digits` | 2,954 |

Ingest should accept both `RAIL/CAT#n` and `RAIL/CAT/DETAIL#n`. Do not quarantine the 2-part majority of FriendSplit-style rows.

### 8. E8 / K3 — Generator ignores real rail limits (NOISE, ingest trap if you enforce them)

```sql
SELECT
  sum(CASE WHEN mode='UPI'  AND amount > 100000 THEN 1 ELSE 0 END), -- 355 / 1,299,844
  sum(CASE WHEN mode='RTGS' AND amount < 200000 THEN 1 ELSE 0 END), -- 59747 / 59823
  sum(CASE WHEN mode='IMPS' AND amount > 500000 THEN 1 ELSE 0 END); -- 0
```

Almost every RTGS is **below** the real ₹2 lakh minimum. **Do not reject these rows.**

### 9. M2 / C8 — Headless account-number band (TRAP / leakage)

Ranges are not disjoint, so a naive “min/max split” test is CLEAN — but headless **sender tails** sit in a
narrow pocket:

| | 8-digit min | p50 | max |
|---|---|---|---|
| normal | 10000000 | 10013228 | 10024999 |
| headless | **10000303** | **10000452** | **10001099** |

**Do not score, filter, or “find mules” by `CAST(substr(acct,5,8) AS INT) BETWEEN 10000303 AND 10001099`.**
The jury file will not preserve this. See Leakage warnings.

### 10. M3 / J1 / F4 / F7 — Unnaturally flat generator (NOISE)

- Android 665,425 / iOS 665,917 / Windows_Browser 666,004 (rel. deviation **0.054%**)
- Linux_Script = Web_Emulator = **1,327**
- Hour-of-day counts 83,025–83,906 (rel. deviation **0.69%**)
- 15 days almost equal (max/mean **1.01**)
- **21,600/21,600 minutes** have ≥50 distinct senders (mean ≈ 93 tx/minute)

Do not treat “even device mix” or “activity every hour” as trust. Odd-hour (1–5 AM) share will look like daytime.

---

## A. File-level

Byte scan in 1 MiB chunks (`audits\check_A.py`); DuckDB for A3/A8.

| ID | Result | Count | Examples | Verdict | Handling |
|---|---|---|---|---|---|
| A1 | UTF-8, no BOM, first3=`547261` (`Tra`) | 0 | — | CLEAN | utf-8, not utf-8-sig required |
| A2 | 11 names exact | 0 | header as spec | CLEAN | reject files with different headers |
| A3 | 2,000,000 × 11 | 0 | — | CLEAN | all_varchar then type |
| A4 | 2,000,001 physical lines | 0 | — | CLEAN | trailing LF is not a row |
| A5 | LF only | 0 | — | CLEAN | already consistent |
| A6 | 0 quotes, 0 commas in fields | 0 | — | CLEAN | unquoted CSV |
| A7 | utf8_ok, 0 control, 0 non-ASCII | 0 | — | CLEAN | — |
| A8 | 0 full-row duplicate groups | 0 | — | CLEAN | — |

---

## B. Transaction_ID

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| B1 | 2,250 IDs / 4,502 rows; 2,248 twice, 2 thrice | 4,502 | NOISE | keep both; `tx_key`; cite ID+ts+amount+parties |
| B2 | 0 space/case/prefix issues | 0 | CLEAN | reject if they appear |
| B3 | 0 not `TXN`+9 digits | 0 | CLEAN | validate that regex |
| B4 | corr(id, epoch(ts)) = −0.0004; 50% time-order inversions | — | CLEAN | ID is not time |
| B5 | headless IDs overlap [100M, 999M] | 0 | CLEAN | do not score ID magnitude |

B1 examples (thrice first): see `audits\out_B.json`. Confirms PROJECT_CONTEXT Section 9 note.

---

## C. Accounts

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| C1 | format + prefix=IFSC 2,000,000/2,000,000 | 0 | CLEAN | keep `^[A-Z]{4}[0-9]{8}$` |
| C2 | 0 variants | 0 | CLEAN | don’t trim/case-fold |
| C3 | 0 multi-IFSC accounts | 0 | CLEAN | `min(ifsc)` is safe **on this file** |
| C4 | 0 self-transfers | 0 | CLEAN | quarantine if they appear |
| C5 | 24,873 accts; send-only 300; recv-only 385 | 24,873 | CLEAN | role features (see L8) |
| C6 | 45,168 same-bank hamming-1 pairs (sample of 5 in JSON) | 45,168 | NOISE | not typos |
| C7 | 10 prefixes, payments-bank headless ratio 1.15 | 10 | CLEAN | do not use PYTM/AIRP/IPOS as L3 |
| C8 | ranges overlap; headless pocket 10000303–10001099 | 0 | CLEAN | leakage is M2 |
| C9 | p50=169, max=221, exact-1=350 | 350 | CLEAN | no 50k-degree merchants |

Figures: `C7_tx_by_bank.png`, `C7_headless_rate_by_bank.png`, `C9_top20_accounts.png`.

C6 was pairwise Hamming on the 24,873 account list grouped by prefix (not a tx loop).

---

## D. IFSC

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| D1 | all match; 5th char 0 | 0 | CLEAN | keep current regex |
| D2 | 10 prefixes, ~equal volume | 10 | CLEAN | seed `bank_directory` from these 10 |
| D3 | 8,708 branch codes reused across banks | 8,708 | NOISE | key by full IFSC |
| D4 | 10.02% same-bank prefix; 19 identical IFSC | 200,460 | CLEAN | context feature only |

---

## E. Amount

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| E1 | all numeric | 0 | CLEAN | — |
| E2 | no ≤0 | 0 | CLEAN | never ABS |
| E3 | 1dp vs 2dp formatting | 0 | NOISE | integer paise |
| E4 | ₹50 – ₹499,823.99 | 0 | CLEAN | — |
| E5 | round ₹100 share 0.01% | 198 | NOISE | M8 will not fire on “round rupees” here |
| E6 | 723 near-limit (±1%) | 723 | NOISE | weak M8 |
| E7 | `50.0` × 8,698; next mode ~32 | 8,698 | NOISE | floor, not structuring |
| E8 | RTGS<2L = 59,747/59,823 | 60,102 | NOISE | do not ingest-reject |
| E9 | Benford χ²=1,365 (df=8) | — | NOISE | do not use Benford |
| E10 | see Top finding 3 | 2,654 | SIGNAL | size is an L3 correlate |

Figures: `E4_amount_log_buckets.png`, `E9_benford.png`, `E10_avg_amount_headless.png`.

---

## F. Timestamp

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| F1 | 0 parse failures | 0 | CLEAN | explicit strptime |
| F2 | 2026-09-15 .. 2026-09-29 | 0 | CLEAN | trace inside this window |
| F3 | 0 impossible clock fields | 0 | CLEAN | — |
| F4 | 15 days, 24 hours, ratio 1.01 | 0 | CLEAN | odd-hour feature will be weak |
| F5 | 60 distinct seconds | 33,165 | CLEAN | not truncated to `:00` |
| F6 | top ts count=11 | 11 | CLEAN | not a defaulted timestamp |
| F7 | 21,600 minutes ≥50 senders = **all minutes** | 21,600 | NOISE | raise any “burst” bar well above 50 |
| F8 | row_n vs ts decrease share 0.4998 | — | CLEAN | `tx_key` ≠ time; always `ORDER BY ts` |

Figures: `F4_tx_per_day.png`, `F4_tx_per_hour.png`.

---

## G. Payment_Mode

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| G1 | UPI/IMPS/NEFT/RTGS only, exact case | 0 | CLEAN | reject anything else |
| G2 | rail mix ~71/14/14 independent of mode; **never RTGS rail** | 0 | NOISE | do not score rail≠mode (Section 3b) |

---

## H. Narration

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| H1 | 285,541 two-part `RAIL/CAT#n` | 285,541 | TRAP | accept 2- and 3-part |
| H2 | 143k split-2 “categories” | 143,283 | NOISE | split on `/` then `#`; real cats ≈ Flipkart/Recharge/Swiggy/… |
| H3 | crypto/p2p/wallet 1327; task/refund 300; mule=0 | 4,581 | SIGNAL | M4 keyword list |
| H4 | 0 injection tokens | 0 | CLEAN | still never send raw narration to the LLM |
| H5 | len 21–33, ASCII | 0 | CLEAN | — |
| H6 | 0 embedded accounts | 0 | CLEAN | — |
| H7 | `#n` suffix 1.86M; `_n` 2,954; never equals tx_id | 2,954 | NOISE | do not join on the suffix |
| H8 | only P2A + WALLET_LOAD co-occur with headless | 2,654 | SIGNAL | those two cats are the cash-out flag |

Figures: `H2_rarest_categories.png` (misleading until `#` stripped), `H8_headless_by_category.png`.

---

## I. IP_Address

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| I1 | one shape `N.N.N.N`, octets 0–255 | 0 | CLEAN | — |
| I2 | 0 IPv6 | 0 | CLEAN | — |
| I3 | 0 private/reserved | 0 | CLEAN | reserved-IP code is unused on this file |
| I4 | 103 / 185 / 194 only | 2,654 | SIGNAL | foreign := 185. or 194. |
| I5 | max 5 senders/IP | 5 | CLEAN | M5 shared-IP will be weak unless combined with foreign |
| I6 | 0 domestic↔foreign switchers | 0 | CLEAN | M9 “IP switch” will not fire |
| I7 | foreign = headless devices, IMPS+UPI split 1327/1327, avg ₹61k | 2,654 | SIGNAL | same cluster as J |

Figure: `I4_first_octet.png`.

---

## J. Device_Type

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| J1 | 5 values; 1327/1327 headless | 0 | CLEAN | confirm [KNOWN] |
| J2 | 0 phone+headless mix; 23,500 phone multi-device | 0 | CLEAN | phone mixing is generator; headless accounts are pure |
| J3 | 688 senders, 2,654 tx, 2,654 IPs | 688 | SIGNAL | L3 candidate set |
| J4 | see Top finding 1; all-four=198 | 2,654 | SIGNAL | one signature |

Figures: `J1_device_counts.png`, `J3_headless_by_hour.png` (headless is also flat by hour).

---

## K. Cross-column

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| K1 | 0 prefix mismatches | 0 | CLEAN | keep ingest check |
| K2 | 0 bank-prefix changes | 0 | CLEAN | — |
| K3 | = E8 | 60,102 | NOISE | do not enforce rail limits |
| K4 | 0 foreign on phone devices | 0 | SIGNAL | foreign is not a phone-proxy pattern here |

---

## L. Graph and behaviour

SQL on full 2M edges except L13 (sample 30,000 edges). Range joins used all senders (max `n_out`=221 < cap 1,500).
igraph/networkx not installed; L9 triangles via SQL on the 6,266-node reciprocal subgraph.

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| L1 | 0 decoy merchants | 0 | CLEAN | `is_merchant` may stay 0 |
| L2 | 319 long-history pass-through accts | 319 | NOISE | require a second signal (M10) |
| L3 | 123 at 0s; 23,502 at <3 min | 23,502 | SIGNAL | include <3 min in velocity |
| L4 | 359 of 3–7; 0 of >7 | 359 | SIGNAL | rare L2 split |
| L5 | 4,681 accts in 95–99% band | 4,681 | SIGNAL | 2% commission |
| L6 | 0 equal-amount splits | 0 | CLEAN | equal-split M8 is dead here |
| L7 | 22,731 “negative” from 0 start | 22,731 | NOISE | unknown opening balance |
| L8 | 300 / 385 | 685 | SIGNAL | victims vs sinks |
| L9 | 3,636 reciprocal pairs; 4,346 triangles | 3,636 | NOISE | cycles are common; filter to candidates |
| L10 | 29 short-burst accts | 29 | SIGNAL | M10 |
| L11 | 0 at threshold | 0 | CLEAN | — |
| L12 | 0 | 0 | CLEAN | victims in L8 do not later receive |
| L13 | 19,208 time-violating 2-hops on 30k-edge sample | 19,208 | NOISE | traces **must** be time-respecting |
| L14 | 13,082 with ≥2 loose flags (pt=12,981, fanin=23,500, split=188, hf=688) | 13,082 | INCONCLUSIVE | tighten fan-in; two-signal on **real** M parameters |

Figure: `L4_fanout_per_inflow.png`.

L14 is not an estimate of the 1,500 mules. `fanin>=15 AND n_in>=20` is the background graph.

---

## M. Leakage and generator hints

| ID | Result | Count | Verdict | Handling |
|---|---|---|---|---|
| M1 | no mule/victim/injected/L1/L2/L3 in narration or ID | 0 | CLEAN | — |
| M2 | headless tails 10000303–10001099; tx_id ranges overlap; banks even | 2,654 | TRAP | **do not score** |
| M3 | device thirds and hours nearly perfect | — | NOISE | ignore as trust |

Figures: `M3_hourly_counts.png`, `M3_phone_devices.png`.

---

## N. Already decided (confirm only)

| ID | Result | Verdict | Handling |
|---|---|---|---|
| N1 | 2,250 IDs / 4,502 rows; 2 thrice | NOISE | `tx_key` |
| N2 | 2,000,000 / 2,000,000 match 4+8 | CLEAN | keep regex |
| N3 | ~0.713 UPI-rail on every Payment_Mode | NOISE | do not score |

---

## Recommended rule changes

Suggestions only — **nothing applied**.

**Ingest validation**
1. Keep account `^[A-Z]{4}[0-9]{8}$` and prefix = IFSC prefix (already true on this file).
2. Do **not** add NPCI/RBI amount-vs-mode limits (E8).
3. Do **not** require 3-part narration; allow `RAIL/CAT#n` and `RAIL/CAT/DETAIL#n` plus rare `_n`.
4. Keep duplicate Transaction_IDs (B1); add `tx_key` + `is_dup_tx_id`.
5. Foreign IP := first octet 185 or 194 only. Reserved-IP check can stay but will be 0 here.
6. Floor amount is ₹50, not 0 — still reject ≤0 only.

**Features**
7. `is_headless` and `is_foreign` are the **same 2,654 rows**. Store both, but M4 should not sum them as independent.
8. `narr_flags`: `WALLET_LOAD`, `P2A`, `P2P_CRYPTO`, and weaker `TASK`/`REFUND`. Ignore rail vs mode.
9. Pass-through: include lags in **[0, 15] min**, not only 3–15. Track 0-second forwards separately.
10. Split-count: 3–7 is rare (359 inflows) and **never >7**. Also score 2-way splits (3,273).
11. Commission: `out/in` near **0.98** inside 60 min (L5). Enforce guardrail 16 (no double-count).
12. `is_merchant`: no L1-style hubs (max involvement 221, L1=0). Don’t expect a merchant bump.
13. Send-only (300) / recv-only (385) as victim/sink priors.
14. Shared-IP (I5) and domestic↔foreign switch (I6=0) will not carry M5/M9 on this file.
15. Round-amount and equal-split M8 are nearly dead (E5, L6).
16. Odd-hour share is not a discriminator (hours are flat, including headless).

**Scoring**
17. Two-signal rule is mandatory: loose “fan-in + pass-through” flags **13k accounts** (L14).
18. Headless/foreign/P2A/WALLET_LOAD is a high-precision L3 **cluster of 688 senders**, not 1,500. The other ~800 mules must come from velocity/split/commission, not from this cluster.
19. 319 long-history pass-through accounts (L2) need M10 (short life) before they count as mules.
20. Reciprocal pairs/triangles are common (L9) — run M6 only on a candidate subgraph.

---

## Leakage warnings (Section M)

**These shortcuts must not be used for scoring, role assignment, or tracing.**
The jury dataset will not include generator fingerprints.

1. **Account-number tail band.** Headless senders’ 8-digit tails lie in `10000303`–`10001099` (C8/M2). A rule like “if `int(acct[-8:]) < 10001100` then mule” would fake recall. **Forbidden.**
2. **Device thirds and 1,327/1,327.** Exact equality of Linux_Script and Web_Emulator, and 1/3 phone split, is how the file was built (M3/J1). **Forbidden** as a label.
3. **Foreign ⇔ headless ⇔ P2A/WALLET_LOAD.** That identity is the injection method. Using only that combo will catch the 688 L3-like senders and miss L1/L2. It is a legitimate **behavioural** feature (device, IP, narration) — do **not** turn it into “if 185.x then mule” without the other Mule Index terms, and do not treat the three flags as independent evidence.
4. **No textual labels.** M1 found no `mule` / `victim` / `L1` / `injected` in narration or IDs. If a later file grows them, ignore them (guardrail 9).
5. **tx_id numeric range does not separate** headless from normal (B5/M2) — good; don’t go looking for a clever ID cutoff anyway.
6. **Bank prefix is not a mule separator** (C7 ratio 1.15). Do not rank PYTM/AIRP/IPOS as guilty.

Guardrail 9 remains: never read ground-truth label files in scoring.

---

## How to rerun

```bat
.venv\Scripts\python.exe audits\_common.py
.venv\Scripts\python.exe audits\check_A.py
.venv\Scripts\python.exe audits\check_B.py
rem ... check_C.py through check_N.py
```

Each script writes `audits\out_<section>.json` and prints a one-line table. Parquet in `%TEMP%` is reused if present.
