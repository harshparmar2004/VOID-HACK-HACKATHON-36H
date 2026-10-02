# Victim → mule chain report

Independent analysis of the hypothesis in `reports\traps_report.md`:
the 300 send-only accounts are victims; each sends one large payment (~₹5 lakh)
to a first mule, which forwards ~98% (2% commission) to 2–7 accounts within 60 minutes;
money then continues and may end in the L3 cluster (headless + foreign IP +
P2A/WALLET_LOAD narration).

**No project code was modified. `data\case.duckdb` was not opened. `abhedya\` was not touched.**
**Leakage unused:** account-number ranges, 1,327/1,327 counts, and device proportions
were not used to select or label anything. L3 is defined only by the behavioural combo
`is_headless AND is_foreign AND narr_cat IN ('P2A','WALLET_LOAD')`.

| Field | Value |
|---|---|
| Written | 2026-10-02 09:28:19 |
| DuckDB | 1.5.6 |
| CSV rows | 2,000,000 |
| Runtime | 1.6 s |
| Script | `audits\victim_chains.py` |
| Window | 60 minutes after each hop's inflow, `ts >= in_ts` (0-second forwards allowed) |

## Summary

| step | finding | count |
|---|---|---|
| 1 victims | Send-only accounts (n_in=0, n_out>0) | 300 |
| 1 outflows | Outgoing txs from those accounts | 300 |
| 1 not-one | Send-only accounts with n_out ≠ 1 | 0 |
| 1 amount | min=51698.58 med=285009.345 max=499823.99; ≥₹4L=71 | 71 |
| 2 first mules | Distinct hop-1 receivers of victim payments | 129 |
| 2 fan-in | First mules that receive from >1 victim | 91 |
| 2 max fan-in | Max distinct victims per first mule | 8 |
| 2 extra in | First mules with inflows besides victim payments | 0 |
| 3 no forward | Victim payments with no 60-min outflow from first mule | 0 |
| 3 h2 edges | Hop-2 transfers (first mule → next, 60 min) | 1327 |
| 3 h2 accts | Distinct hop-2 receivers | 559 |
| 3 exact 0.98 | Hop-2 inflows with out/in exactly 0.98 | 300 |
| 3 exceeds | Hop-2 inflows where out_sum > victim amount | 0 |
| 4 h3 edges | Hop-3 transfers | 1337 |
| 4 h3 accts | Distinct hop-3 receivers | 385 |
| 4 h4 edges | Hop-4 transfers | 0 |
| 4 h4 accts | Distinct hop-4 receivers | 0 |
| 5 reach L3 | Victim payments whose chain hits an L3-combo sender | 300 |
| 5 L3 hop1-4 | at1=300 at2=0 at3=0 at4=0 | 300 |
| 5 reach sink | Victim payments whose chain hits a receive-only account | 300 |
| 5 neither | Chains that hit neither L3 sender nor sink within 4 hops | 0 |
| 6 union | Distinct accounts at hops 1–4 combined | 1073 |
| 6 vs 1500 | Union minus expected ~1,500 mules | -427 |
| 6 ∩ L3 | Hop 1–4 accounts that are L3-combo senders | 688 |
| 6 L3 miss | L3-combo senders never reached by these chains | 0 |
| break busy | First mules with lifetime n_tx ≥ 50 | 0 |
| break back | Hop-2 edges with lag_sec < 0 (should be 0) | 0 |
| combo h2 | Hop-2 edges that are L3-combo rows | 1327 |
| combo h3 | Hop-3 edges that are L3-combo rows | 1337 |

## Per-hop metrics

Hop 1 is the victim payment itself (no lag / no out-in ratio). Hops 2–4 are
time-respecting outflows within 60 minutes of the previous hop's inflow.
Out/in at hop *k* is `sum(out in window) / inflow_amount` of that hop, not of the original victim amount.

| hop | accounts | transfers | lag stats | out/in ratio stats | receivers per sender |
|---|---|---|---|---|---|
| 1 | 129 | 300 | n/a (origin) | n/a (origin) | n_out=1:300 |
| 2 | 559 | 1327 | min=180 med=542.0 max=898; 0s=0 <3min=0 back=0 | med=0.9800000013326259 exact0.98=300 round0.98=300 band95-99=300 exceeds=0 | 1=0 2=0 3-7=300 >7=0 |
| 3 | 385 | 1337 | min=123 med=1035.0 max=3450; 0s=0 <3min=1 back=0 | med=0.96 exact0.98=0 round0.98=0 band95-99=1317 exceeds=10 | 1=1318 2=9 3-7=0 >7=0 |
| 4 | 0 | 0 | min=None med=None max=None; 0s=0 <3min=0 back=0 | med=None exact0.98=0 round0.98=0 band95-99=0 exceeds=0 | 1=0 2=0 3-7=0 >7=0 |

### Receivers-per-inflow distributions

**Hop 2** (first mule, 60 min after victim payment):

| n_recv | n_inflows |
|---|---|
| 3 | 72 |
| 4 | 96 |
| 5 | 69 |
| 6 | 63 |

**Hop 3:**

| n_recv | n_inflows |
|---|---|
| 1 | 1318 |
| 2 | 9 |

**Hop 4:**

| n_recv | n_inflows |
|---|---|
| — | 0 |

## Step 1 — 300 send-only accounts

- Send-only accounts: **300**
- Outgoing transactions from them: **300**
- Accounts with `n_out ≠ 1`: **0**
- `n_out` distribution: n_out=1:300
- Amount min/median/mean/p90/max: ₹51,698.58 / ₹285,009.34 / ₹282,556.02 / ₹453,985.62 / ₹499,823.99
- Count ≥ ₹1 lakh: 276; ≥ ₹4 lakh: 71; sum = ₹84,766,804.55
- Time window: 2026-09-15 00:10:45 → 2026-09-29 21:47:20 (15 dates)
- Victim-payment narration categories: REF=300

Victim payments by date:

| date | n | amount |
|---|---|---|
| 2026-09-15 | 18 | ₹4,568,070.86 |
| 2026-09-16 | 20 | ₹4,965,581.71 |
| 2026-09-17 | 16 | ₹4,851,573.27 |
| 2026-09-18 | 22 | ₹6,352,455.62 |
| 2026-09-19 | 30 | ₹7,299,715.67 |
| 2026-09-20 | 20 | ₹5,993,186.92 |
| 2026-09-21 | 21 | ₹5,963,179.81 |
| 2026-09-22 | 24 | ₹7,273,440.44 |
| 2026-09-23 | 21 | ₹5,459,861.39 |
| 2026-09-24 | 18 | ₹6,160,089.88 |
| 2026-09-25 | 15 | ₹4,009,183.24 |
| 2026-09-26 | 19 | ₹5,454,909.03 |
| 2026-09-27 | 23 | ₹6,582,527.77 |
| 2026-09-28 | 17 | ₹5,124,254.50 |
| 2026-09-29 | 16 | ₹4,708,774.44 |

Largest victim payments (5):

| tx_key | tx_id | victim | first_mule | amount | ts | mode |
|---|---|---|---|---|---|---|
| 2897 | TXN956268943 | SBIN10000294 | IPOS10000334 | ₹499,823.99 | 2026-09-29 00:04:07 | UPI |
| 189 | TXN188248885 | AXIS10000018 | SBIN10000392 | ₹496,878.67 | 2026-09-24 05:00:30 | UPI |
| 593 | TXN214503073 | HDFC10000062 | HDFC10000429 | ₹496,130.24 | 2026-09-24 10:07:30 | UPI |
| 2637 | TXN701118692 | SBIN10000268 | IPOS10000387 | ₹495,985.75 | 2026-09-20 01:40:24 | UPI |
| 912 | TXN838033148 | IPOS10000095 | KKBK10000389 | ₹495,577.76 | 2026-09-27 08:31:52 | UPI |

## Step 2 — Hop 1 first mules

- Distinct first mules: **129**
- First mules with >1 victim: **91** (max victims/mule = 8)
- First mules that are themselves L3-combo senders: **129**

Victims per first mule:

| n_victims | n_mules | n_payments |
|---|---|---|
| 1 | 38 | 38 |
| 2 | 45 | 90 |
| 3 | 24 | 72 |
| 4 | 13 | 52 |
| 5 | 8 | 40 |
| 8 | 1 | 8 |

First-mule **lifetime** activity (whole file, not the 60-min window):

| metric | value |
|---|---|
| avg / median / min / max n_tx | 12.612403100775193 / 11.0 / 4 / 41 |
| avg n_in / n_out / days_active | 2.3255813953488373 / 10.286821705426357 / 5.75968992248062 |
| only victim inflows (n_in = n_vpay) | 129 |
| extra non-victim inflows | 0 |
| n_tx ≥ 50 (busy-like) | 0 |
| n_in ≥ 10 | 0 |

Example first mules:

| hop1 | n_victims | n_vpay | in_from_victims | n_in | n_out | n_tx | days |
|---|---|---|---|---|---|---|---|
| HDFC10000336 | 8 | 8 | ₹2,719,959.61 | 8 | 33 | 41 | 12 |
| SBIN10000401 | 5 | 5 | ₹1,665,091.87 | 5 | 26 | 31 | 10 |
| PYTM10000327 | 5 | 5 | ₹1,398,074.72 | 5 | 25 | 30 | 11 |
| AIRP10000329 | 5 | 5 | ₹1,020,886.93 | 5 | 24 | 29 | 12 |
| ICIC10000304 | 5 | 5 | ₹1,405,334.59 | 5 | 24 | 29 | 7 |

## Step 3 — Hop 2 (60 min after victim payment)

- Victim payments with **no** 60-min forward: **0**
- Hop-2 edges: **1327**; distinct receivers: **559**
- Inflows that produced at least one out: **300**
- Backwards edges (lag < 0): **0**
- Exact ratio 0.98: **300**; round(ratio,2)=0.98: **300**; band 0.95–0.99: **300**
- out_sum > in_amt: **0**; out_sum > 1.5×in: **0**
- Lag on edges: min=180s med=542.0s max=898s; 0s=0; <3 min (excluding 0)=0

Closest-to-0.98 hop-2 inflows:

| victim | hop1 | in_amt | n_recv | out_sum | ratio | min_lag |
|---|---|---|---|---|---|---|
| PUNB10000251 | PUNB10000428 | ₹241,424.50 | 6 | ₹236,596.01 | 0.98 | 258 |
| BARB10000234 | IPOS10000424 | ₹381,634.50 | 5 | ₹374,001.81 | 0.98 | 256 |
| AXIS10000061 | AXIS10000358 | ₹142,897.50 | 4 | ₹140,039.55 | 0.98 | 184 |
| SBIN10000294 | IPOS10000334 | ₹499,823.99 | 5 | ₹489,827.51 | 0.98 | 341 |
| ICIC10000283 | AXIS10000358 | ₹352,942.51 | 3 | ₹345,883.66 | 0.98 | 561 |

## Step 4 — Hops 3 and 4

Hop-2 edges with no 60-min onward out: **0**
Hop-3 edges with no 60-min onward out: **1337**

See the per-hop metrics table. Hop 3/4 out/in is versus **that hop's inflow**, not the original ₹5 lakh.

## Step 5 — Endpoints

L3-combo senders in the file (behavioural definition): **688** (2654 rows). Receive-only sinks: **385**.

| endpoint | chains | at hop1 | at hop2 | at hop3 | at hop4 |
|---|---|---|---|---|---|
| reaches L3-combo sender | 300 | 300 | 0 | 0 | 0 |
| reaches receive-only sink | 300 | 0 | 0 | 300 | 0 |

- Chains that never hit L3 or a sink in 4 hops: **0**
- Dead after hop 1 (no 60-min forward): **0**

A chain “reaches L3” when any account on hops 1–4 is a sender of at least one
L3-combo row anywhere in the file (not necessarily the chain edge itself).

## Step 6 — Distinct accounts vs ~1,500 mules

| set | distinct accounts | of which L3 senders | of which sinks |
|---|---|---|---|
| hop 1 (first mules) | 129 | 129 | 0 |
| hop 2 | 559 | 559 | 0 |
| hop 3 | 385 | 0 | 385 |
| hop 4 | 0 | 0 | 0 |
| hops 1–4 union | 1073 | 688 | — |
| expected injected mules | 1500 | — | — |
| L3 senders not on these chains | 0 | 0 | — |

Union of hops 1–4 = **1073** vs expected **~1,500** mules (delta -427).
Accounts can appear at more than one hop (overlap); the union column de-duplicates.

## Example chains

Each path is one greedy walk: at every hop prefer a next account that is an L3 sender,
else a sink, else the largest outflow. Hop-2 siblings (full 60-min fan-out, up to 10)
are listed under the path. Transaction_ID is cited with timestamp and amount because IDs are not unique.

### Example 1: `textbook_098_to_L3`

- Victim `PUNB10000251` → first mule `PUNB10000428`
- Victim payment `TXN921756220` at `2026-09-22 06:16:01` amount ₹241,424.50 (tx_key=2470)
- Hop-2 n_recv=6 ratio=0.9800000000000001 min_lag=258s (4.3 min)
- First L3 hop=1; first sink hop=3

| hop | from | to | tx_id | ts | amount | lag | flags |
|---|---|---|---|---|---|---|---|
| 1 | `PUNB10000251` | `PUNB10000428` | `TXN921756220` | 2026-09-22 06:16:01 | ₹241,424.50 | — | — |
| 2 | `PUNB10000428` | `AXIS10000755` | `TXN619632542` | 2026-09-22 06:30:39 | ₹93,025.98 | 878s (14.6 min) | L3-sender |
| 3 | `AXIS10000755` | `HDFC10001292` | `TXN697947265` | 2026-09-22 06:50:54 | ₹89,304.94 | 1215s (20.2 min) | sink |

Hop-2 siblings (60-min fan-out from the first mule):

| tx_id | to | amount | ts | lag |
|---|---|---|---|---|
| TXN737412056 | ICIC10000920 | ₹14,962.75 | 2026-09-22 06:20:19 | 258s (4.3 min) |
| TXN579768904 | ICIC10000810 | ₹56,002.98 | 2026-09-22 06:22:10 | 369s (6.2 min) |
| TXN664133134 | PUNB10000709 | ₹31,594.32 | 2026-09-22 06:22:12 | 371s (6.2 min) |
| TXN114202319 | PYTM10000635 | ₹37,898.85 | 2026-09-22 06:24:18 | 497s (8.3 min) |
| TXN706881033 | IPOS10000546 | ₹3,111.13 | 2026-09-22 06:26:57 | 656s (10.9 min) |
| TXN619632542 | AXIS10000755 | ₹93,025.98 | 2026-09-22 06:30:39 | 878s (14.6 min) |

### Example 2: `reaches_sink`

- Victim `SBIN10000294` → first mule `IPOS10000334`
- Victim payment `TXN956268943` at `2026-09-29 00:04:07` amount ₹499,823.99 (tx_key=2897)
- Hop-2 n_recv=5 ratio=0.9799999995998592 min_lag=341s (5.7 min)
- First L3 hop=1; first sink hop=3

| hop | from | to | tx_id | ts | amount | lag | flags |
|---|---|---|---|---|---|---|---|
| 1 | `SBIN10000294` | `IPOS10000334` | `TXN956268943` | 2026-09-29 00:04:07 | ₹499,823.99 | — | — |
| 2 | `IPOS10000334` | `BARB10000757` | `TXN183298817` | 2026-09-29 00:14:09 | ₹225,969.07 | 602s (10.0 min) | L3-sender |
| 3 | `BARB10000757` | `BARB10001447` | `TXN202799936` | 2026-09-29 00:21:10 | ₹216,930.31 | 421s (7.0 min) | sink |

Hop-2 siblings (60-min fan-out from the first mule):

| tx_id | to | amount | ts | lag |
|---|---|---|---|---|
| TXN599121241 | AIRP10000765 | ₹41,691.98 | 2026-09-29 00:09:48 | 341s (5.7 min) |
| TXN633214556 | SBIN10000599 | ₹58,294.45 | 2026-09-29 00:10:34 | 387s (6.5 min) |
| TXN183298817 | BARB10000757 | ₹225,969.07 | 2026-09-29 00:14:09 | 602s (10.0 min) |
| TXN386361189 | AXIS10000853 | ₹56,145.69 | 2026-09-29 00:14:25 | 618s (10.3 min) |
| TXN106109533 | AIRP10000925 | ₹107,726.32 | 2026-09-29 00:16:45 | 758s (12.6 min) |

### Example 3: `smallest_victim_not_5_lakh`

- Victim `ICIC10000184` → first mule `KKBK10000340`
- Victim payment `TXN203412789` at `2026-09-27 04:56:56` amount ₹51,698.58 (tx_key=1811)
- Hop-2 n_recv=5 ratio=0.9800000309486256 min_lag=231s (3.9 min)
- First L3 hop=1; first sink hop=3
- First mule lifetime n_tx=12 n_in=2 n_out=10

| hop | from | to | tx_id | ts | amount | lag | flags |
|---|---|---|---|---|---|---|---|
| 1 | `ICIC10000184` | `KKBK10000340` | `TXN203412789` | 2026-09-27 04:56:56 | ₹51,698.58 | — | — |
| 2 | `KKBK10000340` | `PUNB10001056` | `TXN987465728` | 2026-09-27 05:10:56 | ₹18,040.64 | 840s (14.0 min) | L3-sender |
| 3 | `PUNB10001056` | `IPOS10001304` | `TXN797411755` | 2026-09-27 05:31:49 | ₹17,319.02 | 1253s (20.9 min) | sink |

Hop-2 siblings (60-min fan-out from the first mule):

| tx_id | to | amount | ts | lag |
|---|---|---|---|---|
| TXN377197654 | AXIS10000849 | ₹14,724.94 | 2026-09-27 05:00:47 | 231s (3.9 min) |
| TXN392227439 | PYTM10000997 | ₹10,392.05 | 2026-09-27 05:01:28 | 272s (4.5 min) |
| TXN155007085 | ICIC10000792 | ₹6,862.55 | 2026-09-27 05:02:38 | 342s (5.7 min) |
| TXN222416397 | KKBK10000541 | ₹644.43 | 2026-09-27 05:07:33 | 637s (10.6 min) |
| TXN987465728 | PUNB10001056 | ₹18,040.64 | 2026-09-27 05:10:56 | 840s (14.0 min) |

## What breaks the hypothesis

| check | count | implication |
|---|---|---|
| Send-only with n_out ≠ 1 | 0 | Hypothesis said exactly one outflow |
| Victim payments with no 60-min forward | 0 | No L1/L2 layering after the first mule |
| Hop-2 lag < 0 | 0 | Time-travel (join bug or data error); expect 0 |
| Hop-2 back to first mule (self) | 0 | Self-transfer in the window |
| Hop-2 back to victim | 0 | Impossible if victims are send-only |
| Hop-3 returns to first mule | 0 | Cycle / bounce, not a clean downward chain |
| First mules with extra inflows | 0 | Not dedicated collectors of only these victims |
| First mules lifetime n_tx ≥ 50 | 0 | Look like ordinary busy accounts, not one-shot mules |
| Hop-2 out_sum > victim amount | 0 | Window captured unrelated outs, or mule mixes other funds |
| Hop-2 out_sum > 1.5× victim | 0 | Strong busy-account contamination |
| Hop-2 n_recv = 1 (pass-through, not 2–7 split) | 0 | First mule is a forwarder, not a splitter |
| Hop-2 n_recv > 7 | 0 | Wider than the PS 3–7 split |
| Hop-2 exact 0.98 ratio | 300 | Supports the 2% commission story — here it is ALL 300 |
| First mule is already an L3 sender | 129 | Cash-out device is the splitter; L3 is not a later hop |
| First mules with >1 victim | 91 | Collector-style fan-in exists (max 8) |
| Chains never reach L3 or sink | 0 | Money stays in intermediate accounts or window is too short |
| Victim amount ≥ ₹4 lakh | 71 | Only 71/300 are ~₹5 lakh; median is ₹2.85 lakh |
| Hop-2 lag < 3 min | 0 | Victim-chain hop-2 is 3–15 min only (min lag 180s) |
| Hop-3 3–7 splits | 0 | Hop-3 is 1-way pass-through, not another splitter |
| Hop-4 edges | 0 | No fourth hop; sinks do not forward |

## Implications for roles

Suggestions only — **nothing applied** to scoring or ingest.

Observed shape (every one of the 300 victim payments):

```
Victim (send-only, 1 tx, phone device, TASK/REFUND narration)
  └─▶ Hop1 first mule (129 accounts): collector fan-in 1–8 victims
        AND 3–6 way split at out/in = 0.98 after 3–15 min
        AND the split rows are L3-combo (headless + foreign + P2A)
        └─▶ Hop2 (559 accounts): 1-way pass-through at out/in ≈ 0.96
              AND those rows are L3-combo (headless + foreign + WALLET_LOAD)
              └─▶ Hop3 (385 receive-only sinks): no hop 4
```

1. **Victims (300).** Confirmed. Every send-only account has exactly one outflow.
   Amounts are large but **not** all ~₹5 lakh: min ₹51,698.58, median ₹285,009,
   71/300 ≥ ₹4 lakh, 276/300 ≥ ₹1 lakh. Narration on the victim debit is TASK/REFUND,
   device is a phone — not the L3 combo. Treat as trace starts, not mules.

2. **Hop 1 is collector AND splitter AND cash-out device — not a pure L1.**
   129 first mules; 91 receive from 2–8 victims (max 8); 38 are 1:1.
   They have **zero** inflows except these victim payments (dedicated).
   Lifetime n_tx is 4–41 (median 11), not background-busy (~169).
   After 180–898 s (3.0–15.0 min) they split **every** victim inflow 3/4/5/6 ways
   (never 1, 2, or >6) at out/in **exactly 0.98**. Those split rows are the P2A
   L3-combo. So the first mule fires L1 (fan-in), L2 (3–6 + 2% commission) and
   L3 (headless/foreign/P2A) on the **same account**. Role scores must allow
   a high L1 *and* L2 *and* L3 on hop-1; do not force a single layer.
   Guardrail 11 still holds: do not assign the role *because* it is hop 1.

3. **Hop 2 is a pass-through cash-out layer, not another 3–7 splitter.**
   559 accounts, all L3-combo senders. 1,318/1,327 inflows go to **one** sink;
   9 go to two. Commission is ~4% (median out/in = 0.96), not 2%.
   Rows are WALLET_LOAD + Linux_Script in the examples. This is L3-like
   (cash-out narration, headless, then a sink), not L2.

4. **The 688 L3-combo senders are hop1 ∪ hop2, not a third layer.**
   129 + 559 = 688, disjoint, and every L3 sender in the file sits on these chains.
   Money does **not** stop there: every chain continues to a receive-only sink at hop 3.
   M4 (cash-out) will light up both the splitter and the pass-through. That is correct
   behaviourally; it is **not** independent evidence stacked on top of hop number.
   Do not treat headless, 185/194, and P2A/WALLET_LOAD as three proofs.

5. **Sinks (385) are the terminals.** Hop-3 accounts = the full receive-only set,
   disjoint from L3 senders. They never send, so they cannot carry P2A narration.
   Freeze priority is here (holding). Keep a sink / one-way-in feature; do not
   require M4 cash-out text on an account with n_out = 0.

6. **Coverage vs ~1,500 mules.** Hops 1–4 union = **1,073** = 129 + 559 + 385.
   1,500 − 1,073 = **427 accounts not on these chains**. They are not extra hops
   of this money (hop 4 is empty). Scoring still has to find them some other way
   (or the 1,500 includes accounts this victim set never touches). Do not pad
   the flag list with busy counterparties — hop-1/2 are dedicated, not busy.

7. **Trace.** 60-min window is enough (all hop-2 fits in 3–15 min; hop-3 lags
   up to 3,450 s ≈ 57 min). Include the 3-minute floor; these victim chains have
   **no** 0–3 min hop-2 forwards. Follow amount-capped outs: hop-2 never exceeds
   the victim amount. Rank hop-1 by the 0.98 × 3–6 split; fan-in is extra, not required.

8. **What the original hypothesis got wrong**
   - Amounts are median ~₹2.85 lakh, not uniformly ~₹5 lakh.
   - First mule is a collector+splitter, not a collector that hands off to a separate L2.
   - L3-combo is used on hops 1→2 and 2→3, not only at the end.
   - There is no hop 4. Terminals are the 385 sinks.
   - Hop-3 commission is 4% (0.96), not 2%.

9. **Forbidden shortcuts remain forbidden.** Do not select mules by the 8-digit
   account band, by Linux_Script = Web_Emulator counts, or by 185.x/194.x alone.
   Hop-2 edge count happening to equal 1,327 is a generator fingerprint, not a feature.

L3-combo share of chain edges (computed after the hops, not used to build them):

| edge set | n | headless | foreign | L3-combo | P2A | WALLET_LOAD |
|---|---|---|---|---|---|---|
| victim payments | 300 | 0 | 0 | 0 | 0 | 0 |
| hop 2 | 1327 | 1327 | 1327 | 1327 | 1327 | 0 |
| hop 3 | 1337 | 1337 | 1337 | 1337 | 0 | 1337 |

## Exact SQL

CSV loaded via `audits\_common.py`: `read_csv(..., all_varchar=true)` → `%TEMP%\abhedya_t.parquet`
→ in-memory table `t`. Connection: `duckdb.connect()` (not `case.duckdb`).

### `acct`

```sql
CREATE TABLE acct AS
WITH s AS (
  SELECT src_acct AS acct,
         count(*) AS n_out,
         sum(amount) AS out_amt,
         min(ts) AS first_out,
         max(ts) AS last_out
  FROM t GROUP BY 1
), r AS (
  SELECT dst_acct AS acct,
         count(*) AS n_in,
         sum(amount) AS in_amt,
         min(ts) AS first_in,
         max(ts) AS last_in
  FROM t GROUP BY 1
)
SELECT
  coalesce(s.acct, r.acct) AS acct,
  coalesce(s.n_out, 0) AS n_out,
  coalesce(r.n_in, 0) AS n_in,
  coalesce(s.n_out, 0) + coalesce(r.n_in, 0) AS n_tx,
  coalesce(s.out_amt, 0) AS out_amt,
  coalesce(r.in_amt, 0) AS in_amt,
  least(coalesce(s.first_out, r.first_in), coalesce(r.first_in, s.first_out)) AS first_ts,
  greatest(coalesce(s.last_out, r.last_in), coalesce(r.last_in, s.last_out)) AS last_ts,
  datediff('day',
           least(coalesce(s.first_out, r.first_in), coalesce(r.first_in, s.first_out)),
           greatest(coalesce(s.last_out, r.last_in), coalesce(r.last_in, s.last_out)))
    + 1 AS days_active
FROM s FULL JOIN r ON s.acct = r.acct
```

### `victims`

```sql
CREATE TABLE victims AS
SELECT acct FROM acct WHERE n_out > 0 AND n_in = 0
```

### `sinks`

```sql
CREATE TABLE sinks AS
SELECT acct FROM acct WHERE n_in > 0 AND n_out = 0
```

### `l3_rows`

```sql
CREATE TABLE l3_rows AS
SELECT
  file_row_number AS tx_key,
  tx_id,
  src_acct,
  dst_acct,
  amount,
  ts,
  narration,
  device,
  split_part(narration, '/', 2) AS narr_cat
FROM t
WHERE is_headless
  AND is_foreign
  AND split_part(narration, '/', 2) IN ('P2A', 'WALLET_LOAD')
```

### `l3_senders`

```sql
CREATE TABLE l3_senders AS
SELECT src_acct AS acct, count(*) AS n_l3, sum(amount) AS l3_amt
FROM l3_rows
GROUP BY 1
```

### `vpay`

```sql
CREATE TABLE vpay AS
SELECT
  t.file_row_number AS tx_key,
  t.tx_id,
  t.src_acct AS victim,
  t.dst_acct AS hop1,
  t.amount,
  t.amount_paise,
  t.ts,
  t.mode,
  t.device,
  t.narration,
  t.is_headless,
  t.is_foreign
FROM t
JOIN victims v ON t.src_acct = v.acct
```

### `hop1_fanin`

```sql
CREATE TABLE hop1_fanin AS
SELECT
  hop1,
  count(*) AS n_vpay,
  count(DISTINCT victim) AS n_victims,
  sum(amount) AS in_from_victims,
  min(ts) AS first_v,
  max(ts) AS last_v
FROM vpay
GROUP BY 1
```

### `h2_edge`

```sql
CREATE TABLE h2_edge AS
SELECT
  v.tx_key AS in_tx_key,
  v.tx_id AS in_tx_id,
  v.victim,
  v.hop1 AS from_acct,
  v.amount AS in_amt,
  v.ts AS in_ts,
  t.file_row_number AS out_tx_key,
  t.tx_id AS out_tx_id,
  t.dst_acct AS to_acct,
  t.amount AS out_amt,
  t.ts AS out_ts,
  t.mode,
  t.narration,
  t.device,
  t.is_headless,
  t.is_foreign,
  datediff('second', v.ts, t.ts) AS lag_sec
FROM vpay v
JOIN t
  ON t.src_acct = v.hop1
 AND t.ts >= v.ts
 AND t.ts <= v.ts + INTERVAL 60 MINUTE
```

### `h2_agg`

```sql
CREATE TABLE h2_agg AS
SELECT
  in_tx_key,
  any_value(victim) AS victim,
  any_value(from_acct) AS hop1,
  any_value(in_amt) AS in_amt,
  any_value(in_ts) AS in_ts,
  count(*) AS n_out,
  count(DISTINCT to_acct) AS n_recv,
  sum(out_amt) AS out_sum,
  min(lag_sec) AS min_lag,
  quantile_cont(lag_sec, 0.5) AS med_lag,
  max(lag_sec) AS max_lag,
  sum(out_amt) / nullif(any_value(in_amt), 0) AS ratio
FROM h2_edge
GROUP BY in_tx_key
```

### `h3_edge`

```sql
CREATE TABLE h3_edge AS
SELECT
  e.in_tx_key AS v_tx_key,
  e.victim,
  e.from_acct AS hop1,
  e.out_tx_key AS in_tx_key,
  e.out_tx_id AS in_tx_id,
  e.to_acct AS from_acct,
  e.out_amt AS in_amt,
  e.out_ts AS in_ts,
  t.file_row_number AS out_tx_key,
  t.tx_id AS out_tx_id,
  t.dst_acct AS to_acct,
  t.amount AS out_amt,
  t.ts AS out_ts,
  t.mode,
  t.narration,
  t.device,
  t.is_headless,
  t.is_foreign,
  datediff('second', e.out_ts, t.ts) AS lag_sec
FROM h2_edge e
JOIN t
  ON t.src_acct = e.to_acct
 AND t.ts >= e.out_ts
 AND t.ts <= e.out_ts + INTERVAL 60 MINUTE
```

### `h3_agg`

```sql
CREATE TABLE h3_agg AS
SELECT
  in_tx_key,
  any_value(v_tx_key) AS v_tx_key,
  any_value(victim) AS victim,
  any_value(from_acct) AS hop2_acct,
  any_value(in_amt) AS in_amt,
  any_value(in_ts) AS in_ts,
  count(*) AS n_out,
  count(DISTINCT to_acct) AS n_recv,
  sum(out_amt) AS out_sum,
  min(lag_sec) AS min_lag,
  quantile_cont(lag_sec, 0.5) AS med_lag,
  max(lag_sec) AS max_lag,
  sum(out_amt) / nullif(any_value(in_amt), 0) AS ratio
FROM h3_edge
GROUP BY in_tx_key
```

### `h4_edge`

```sql
CREATE TABLE h4_edge AS
SELECT
  e.v_tx_key,
  e.victim,
  e.in_tx_key AS hop3_in_key,
  e.out_tx_key AS in_tx_key,
  e.out_tx_id AS in_tx_id,
  e.to_acct AS from_acct,
  e.out_amt AS in_amt,
  e.out_ts AS in_ts,
  t.file_row_number AS out_tx_key,
  t.tx_id AS out_tx_id,
  t.dst_acct AS to_acct,
  t.amount AS out_amt,
  t.ts AS out_ts,
  t.mode,
  t.narration,
  t.device,
  t.is_headless,
  t.is_foreign,
  datediff('second', e.out_ts, t.ts) AS lag_sec
FROM h3_edge e
JOIN t
  ON t.src_acct = e.to_acct
 AND t.ts >= e.out_ts
 AND t.ts <= e.out_ts + INTERVAL 60 MINUTE
```

### `h4_agg`

```sql
CREATE TABLE h4_agg AS
SELECT
  in_tx_key,
  any_value(v_tx_key) AS v_tx_key,
  any_value(victim) AS victim,
  any_value(from_acct) AS hop3_acct,
  any_value(in_amt) AS in_amt,
  any_value(in_ts) AS in_ts,
  count(*) AS n_out,
  count(DISTINCT to_acct) AS n_recv,
  sum(out_amt) AS out_sum,
  min(lag_sec) AS min_lag,
  quantile_cont(lag_sec, 0.5) AS med_lag,
  max(lag_sec) AS max_lag,
  sum(out_amt) / nullif(any_value(in_amt), 0) AS ratio
FROM h4_edge
GROUP BY in_tx_key
```

### `chain`

```sql
CREATE TABLE chain AS
WITH
h1_acct AS (
  SELECT tx_key AS v_tx_key, hop1 AS acct, 1 AS hop FROM vpay
),
h2_acct AS (
  SELECT in_tx_key AS v_tx_key, to_acct AS acct, 2 AS hop FROM h2_edge
),
h3_acct AS (
  SELECT v_tx_key, to_acct AS acct, 3 AS hop FROM h3_edge
),
h4_acct AS (
  SELECT v_tx_key, to_acct AS acct, 4 AS hop FROM h4_edge
),
nodes AS (
  SELECT * FROM h1_acct
  UNION ALL SELECT * FROM h2_acct
  UNION ALL SELECT * FROM h3_acct
  UNION ALL SELECT * FROM h4_acct
),
reach AS (
  SELECT
    n.v_tx_key,
    min(CASE WHEN l.acct IS NOT NULL THEN n.hop END) AS l3_hop,
    min(CASE WHEN s.acct IS NOT NULL THEN n.hop END) AS sink_hop
  FROM nodes n
  LEFT JOIN l3_senders l ON l.acct = n.acct
  LEFT JOIN sinks s ON s.acct = n.acct
  GROUP BY 1
)
SELECT
  v.tx_key AS v_tx_key,
  v.victim,
  v.hop1,
  v.amount,
  v.ts,
  v.tx_id,
  r.l3_hop,
  r.sink_hop,
  (a.in_tx_key IS NOT NULL) AS has_h2,
  a.n_recv AS h2_n_recv,
  a.ratio AS h2_ratio,
  a.min_lag AS h2_min_lag,
  a.out_sum AS h2_out_sum
FROM vpay v
LEFT JOIN reach r ON r.v_tx_key = v.tx_key
LEFT JOIN h2_agg a ON a.in_tx_key = v.tx_key
```

### `hop_accts`

```sql
CREATE TABLE hop_accts AS
SELECT hop1 AS acct, 1 AS hop FROM vpay
UNION
SELECT to_acct, 2 FROM h2_edge
UNION
SELECT to_acct, 3 FROM h3_edge
UNION
SELECT to_acct, 4 FROM h4_edge
```

Hop-2/3/4 metrics use the corresponding `h*_agg` / `h*_edge` tables with
`min/median/max(lag_sec)`, `out_sum/in_amt`, and `n_recv` grouped by the triggering inflow.

## How to rerun

```bat
.venv\Scripts\python.exe audits\victim_chains.py
```

Writes `audits\out_victim_chains.json` and `reports\victim_chain_report.md`.
