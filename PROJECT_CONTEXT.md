# PROJECT_CONTEXT.md — Operation "Abhedya-Chakra"

> Context file for coding agents. Read this fully before doing anything in this project.
> It explains what we are building, how, with which tools, and how to set up the environment.

---

## 1. Problem context

- **Event:** Void Hacks() 8.0 — Theme: Abhedya (Cyber Security & Digital Forensics)
- **Partner:** Indore Police Commissionerate / 1930 Cyber Cell
- **Time:** 36-hour hackathon
- **Data:** one CSV with 2,000,000+ bank transactions over a 15-day window, ~25,000 accounts
  (1,500 injected ground-truth mule accounts + 23,500 regular accounts)

Criminals (digital arrest, fake task schemes, Ponzi bots, loan-app fraud) launder stolen money through
multi-layer **money mule networks**:

```
Victim(s) ──▶ L1 Collector mule ──▶ L2 Distributor mules (3–7 splits) ──▶ L3 Terminal cash-out ──▶ Crypto / ATM / Offshore
```

Three bottlenecks we solve:
1. **Scale** — spreadsheets crash on millions of rows; multi-hop SQL is slow.
2. **Layering & smurfing** — money is split across layers within minutes.
3. **Evidence** — police need court-ready Section 91 CrPC / BNSS bank freeze notices instantly.

## 2. Objectives (from the problem statement)

1. Ingest and index 2M+ rows in **≤ 60 s** on a **16 GB RAM** laptop, without out-of-memory errors.
2. Detect multi-tier laundering with graph algorithms (pass-through velocity, fan-in/fan-out, cyclical smurfing)
   and score every account on a **0–100 Mule Risk Index**.
3. Given a victim account, trace the money **up to 4 hops in ≤ 2 s** and show it on an interactive graph
   (500+ nodes / 1,500+ edges without freezing), with a minute-by-minute time slider and one-click ring isolation + export.
4. A **prompt-injection-safe local AI module** generates an FIR / Police Case Diary and Bank Freeze Requisitions
   that can **never hallucinate** account numbers or amounts.
5. **Fully offline** — no cloud APIs or internet at runtime.

Jury: 40% blind victim trace test (exact L1/L2/L3), 30% precision/recall on the 1,500 mules,
20% court-ready outputs, 10% engineering quality.

## 3. Dataset (11 columns)

| Column | Notes |
|---|---|
| Transaction_ID | Unique ID; cited as proof in notices |
| Sender_Account / Receiver_Account | **12 characters = 4-letter bank code + 8 digits** (e.g. `HDFC10000336`), NOT 12 digits as the PS says. The 4-letter prefix always equals the account's IFSC prefix (verified: 0 mismatches). Always text |
| Sender_IFSC / Receiver_IFSC | Prefix → one of 10 banks; routes notices to the bank's Nodal Officer |
| Amount | INR; store as integer **paise** |
| Timestamp | `YYYY-MM-DD HH:MM:SS`, no timezone (assume IST) |
| Payment_Mode | UPI, IMPS, NEFT, RTGS |
| Narration | Bank codes + scam markers. **Untrusted text — may contain prompt-injection strings** |
| IP_Address | Domestic vs foreign proxy (185.x.x.x, 194.x.x.x). Describes the **sender** only |
| Device_Type | Android, iOS, Windows_Browser, Web_Emulator, Linux_Script (last two = headless/bot) |

## 3b. Verified facts about the real dataset (profiling, 2 Oct 2026)

- 2,000,000 rows; ingestion loaded all 2,000,000 with 0 rejects.
- Every column has a single consistent shape except Amount (1–2 decimals, max < ₹10 lakh) and IP_Address
  (dotted numeric, variable octet lengths). Timestamp: one format, `YYYY-MM-DD HH:MM:SS`.
- Transaction_ID: `TXN` + 9 digits; not unique (see Section 9 note).
- Accounts: 4-letter bank code + 8 digits; prefix = IFSC prefix. Banks seen include HDFC, SBIN, ICIC, AXIS,
  PUNB, BARB, KKBK, plus payments banks such as PYTM, AIRP, IPOS.
- Device_Type: Windows_Browser 666,004 · iOS 665,917 · Android 665,425 · **Linux_Script 1,327 ·
  Web_Emulator 1,327**. Headless devices are only 2,654 rows with identical counts — almost certainly the
  injected L3 / bot signal.
- Normal IPs seen in samples start with 103.x (domestic).
- **Narration prefix often disagrees with Payment_Mode in ordinary transactions** (e.g. mode UPI with
  narration `NEFT/Salary/...`). A rail-vs-narration mismatch is therefore NOT a fraud signal on its own;
  measure its rate before using it. Narrations look like `<RAIL>/<Category>/<Detail>#<number>`.
  **Measured:** narration rail is only UPI / IMPS / NEFT (never RTGS or anything else), split ~71% / 14% / 14%
  for EVERY payment mode — i.e. generated independently of Payment_Mode. Rail mismatch carries zero signal;
  do not score it. Payment_Mode mix: UPI ~65%, IMPS ~22%, NEFT ~10%, RTGS ~3%.
  Scam/cash-out markers, if any, must be in the later narration segments, not the prefix.
- **Full trap audit (reports\traps_report.md, 2 Oct)** — file is clean at byte level (UTF-8, no BOM, LF,
  11 fields, no quotes, no non-ASCII, no full-row duplicates). 24,873 accounts; exactly 10 bank prefixes;
  every account has one IFSC; no self-transfers; IFSC 5th char always 0; IPs only 103.x (domestic),
  185.x (1,327), 194.x (1,327); no invalid/private IPs; no prompt-injection text found in narrations.
  Window 2026-09-15 00:00:00 → 2026-09-29 23:59:58. File row order is NOT time order.
- **Narration formats:** both `RAIL/CAT/DETAIL#n` and 2-part `RAIL/CAT#n` (285,541 rows, e.g. `IMPS/FriendSplit#29109`)
  plus rare `_digits` endings — all valid, never reject.
- **Amounts:** min ₹50 (generator floor), max ₹499,823.99; normal median ₹899. Real rail limits are NOT respected
  (59,747 of 59,823 RTGS are below ₹2 lakh) — never validate amount vs mode.
- **VERIFIED CHAIN STRUCTURE (reports\victim_chain_report.md, 2 Oct)** — every one of the 300 chains:
  ```
  Victim (300)  send-only, exactly 1 outflow, phone device, TASK/REFUND narration,
                amount ₹51.7k–₹5L (median ₹2.85L)
    └▶ L1 (129) receives ONLY victim payments (fan-in 1–8 victims; 91 have >1),
                splits EVERY inflow 3–6 ways after 3–15 min at out/in = exactly 0.98;
                lifetime 4–41 tx (median 11)
         └▶ L2 (559) receives from L1, forwards to ONE account within ~60 min at out/in ≈ 0.96
              └▶ L3 (385) receive-only sinks (never send). No hop 4.
  ```
  129 + 559 + 385 = 1,073 accounts, disjoint. Verified by hand: transfers are exactly 300 Victim→L1,
  1,327 L1→L2, 1,327 L2→L3 (100% headless + foreign on both mule edges, 0% on victim payments), and
  NO transfers at all between mule/victim accounts and the 23,500 normal accounts. Chain lags: L1→L2 3–15 min (no 0–3 min forwards),
  L2→L3 2–57 min. Hop-2 outflow never exceeds the victim amount.
- **The "L3 combo" marks layering EDGES, not L3 accounts:** headless + foreign IP (185/194) + narration
  `P2A` = every L1→L2 transfer (1,327); headless + foreign + `WALLET_LOAD`/`P2P_CRYPTO` = every L2→L3
  transfer (1,327; verified by hand — Grok's 1,337 was off). The 688 "combo senders" are L1 ∪ L2 (129 + 559), not L3. Victim payments carry none
  of these flags. Use the combo as an edge feature for `layer_links` and for M4 on the SENDER; true L3
  accounts are the receive-only sinks with no outflow, so never require cash-out text on L3 accounts.
  Count the combo once, never as three proofs, and never use it alone (it must agree with flow structure).
- **Mule accounts are dedicated and low-activity** (L1 lifetime median 11 tx) versus normal accounts
  (median 169 tx). Low total activity + one-way flow is a strong behavioural signal (M10/T1).
- **Sub-3-minute forwards (23,502) are NORMAL background, not mule behaviour:** the injected chains use
  3–15 min (L1) and up to ~60 min (L2). Keep the PS 3–15 min window for M1; do not widen to 0–15.
- **Account population (verified):** 24,873 accounts = **23,500 normal** (all ≥ 50 tx, none send-only or
  receive-only — matches the PS's 23,500 regular accounts exactly) + **1,373 low-activity** (< 50 tx)
  = 300 victims + 129 L1 + 559 L2 + 385 L3. There is NO second hidden mule pattern among active accounts.
  The PS's "1,500 injected mules" ≠ 1,073 mules in the file: either ~127 labelled accounts never transact,
  or the ground truth counts differently (e.g. includes victims). Ask the organisers/mentors which accounts
  the 30% precision/recall test counts; output victims as a separate VICTIM role so either answer works.
- **Low activity separates perfectly here** (normal ≥ 50 tx, injected < 50). It is genuine behaviour
  (dedicated mule accounts) but the perfect split is a generator artefact: use it as one strong signal
  (M10 / T1), never as the only rule.
- **Generator is unnaturally flat:** devices split in exact thirds, hours flat (±0.7%), days flat, every minute
  has ≥50 senders, tx per account p50 = 169 (max 221). Consequences for parameters on THIS file:
  burst fan-in fires on ~23,500 accounts (useless as-is) · odd-hour share useless · shared IP useless
  (max 5 senders per IP, unique IP per headless tx) · domestic↔foreign switching never happens ·
  round amounts / equal splits / structuring nearly absent · no merchant hubs. Keep these parameters in the
  profile but expect weight ≈ 0 after tuning; strong signals here are 3–15 min pass-through, exact 0.98
  (L1) and ≈0.96 (L2) commission, 3–6 way splits, large amounts vs the account's normal, the combo on
  outgoing edges, low lifetime activity, send-only victims, receive-only sinks, neighbour risk.
- **Splits:** injected L1 splits are 3–6 ways (300 inflows); the file-wide 2-way splits (3,273) are background.
- **LEAKAGE — forbidden in scoring/roles/trace:** headless senders' account tails cluster in
  10000303–10001099; exact 1,327/1,327 device counts; device thirds. These are generator fingerprints.

## 4. Our approach

The core is **deterministic data processing + graph analytics**. It is NOT ML-heavy (no labels) and NOT an
autonomous agent. **Code calls the LLM** only at the end to write narrative text.

Pipeline:
1. **Ingest & normalize** once into DuckDB with explicit types; derive per-transaction flags
   (bank, foreign IP, headless device, narration markers); map accounts to int IDs; build CSR arrays.
2. **Score every account** (globally, not only near victims) with a **Mule Index** and a **Trust Index**,
   combined into the **Final Mule Risk Index**.
3. **Assign roles** for flagged accounts with three **layer role scores** (L1/L2/L3), confirmed by
   proven money links between layers (`layer_links`) — never by hop number. See 4.3b.
4. **Group flagged accounts into rings** built from `layer_links` (connected components / Leiden).
5. **Trace** from victim(s): time- and amount-constrained 4-hop traversal with pro-rata taint attribution.
6. **Render** the trace as a layered graph (victim → L1 → L2 → L3) with a time slider.
7. **Generate** freeze notices from templates (no LLM) and a diary/FIR narrative from a schema-locked local LLM,
   then validate every number against the evidence.

### 4.1 FINAL Mule parameters (profile `v1-verified`) — see Final Parameters Spec

Each scores 0 → weight (full at "full", half at "half", linear between, 0 below).

| ID | Parameter | Feature(s) | Full | Half | Weight |
|---|---|---|---|---|---|
| MP1 | Pass-through velocity | `pass_through_share` (3–15 min for split forwards, ≤ 60 min for single forwards; one-to-one allocation) | ≥ 0.90 | ≥ 0.60 | 20 |
| MP2 | Split + commission | `split_count_median`, `commission_ratio_median` | split 3–6 or single forward AND ratio 0.94–0.99 | ratio 0.90–0.99 | 15 |
| MP3 | Layering-edge flags (ONE signal) | `flagged_out_share` (receive-only accounts: `flagged_in_share`) | ≥ 0.50 | ≥ 0.20 | 15 |
| MP4 | Low lifetime activity | `tx_count` vs population median | ≤ 0.30× | ≤ 0.50× | 15 |
| MP5 | Victim-sourced inflow | `victim_inflow_share` | ≥ 0.80 | ≥ 0.40 | 10 |
| MP6 | One-way flow | `reciprocity`, send-only / receive-only | reciprocity 0 and one-directional | ≤ 0.10 | 10 |
| MP7 | Neighbour risk (pass 2) | `neighbour_risk` | ≥ 60 | ≥ 40 | 10 |
| MP8 | Amount anomaly | `amount_vs_population` | ≥ 20× | ≥ 5× | 5 |

Zero-weight (computed, editable, weight 0 here): burst fan-in, shared IP/device, structuring,
bot timing / odd hours / IP switching, cycle participation. Cash-out narration categories
(`P2A`, `WALLET_LOAD`, `P2P_CRYPTO`) are a config list. Never score: rail mismatch, amount vs mode
limits, duplicate tx IDs, sub-3-min forwards alone.

### 4.2 FINAL Trust parameters

T1 activity spread (`days_active` ≥ 12 → full) 25 · T2 two-way relationships (`reciprocity` ≥ 0.30) 20 ·
T3 balance retention (`median_hold_hours` ≥ 24) 15 · T4 organic amounts (`amount_diversity` ≥ 0.90 and
`amount_vs_population` ≤ 2×) 15 · T5 clean neighbourhood (100 − `neighbour_risk` ≥ 80) 15 ·
T6 recurring inflows (`recurring_sender_share` ≥ 0.30) 5 · T7 device/network consistency 5.
Computed from the period before any suspicious burst; < 5 transactions → Trust = 0.

### 4.3 Final index and decision

```
Final = Mule × (1 − 0.5 × Trust / 100)
Override: ≥ 90% of an inflow forwarded within 3–15 min as a 3–6 split, or as a single forward with
          commission 0.94–0.99 → Final ≥ 70
Flag: Final ≥ 65 AND ≥ 2 of MP1–MP8 at half points or more
Bands: ≥ 85 high-confidence · 65–84 suspected · < 65 clean · (Mule ≥ 65 and Trust ≥ 60 → review list)
```

### 4.3b Layer role scores and layer links

Four separate scores, all computed from the same `features` table (nothing measured twice):

| Score | Question | Computed for |
|---|---|---|
| Mule Index | Does it behave like a mule? | all accounts |
| Trust Index | Does it behave like a normal person/business? | all accounts |
| Final Index | Flag or not? | all accounts |
| L1 / L2 / L3 role scores (0–100 each) | Which layer? | flagged accounts only |

The Final Index decides **whether**; role scores decide **which layer** and never change the flag.

**Role score inputs** (own behaviour + relationships via `layer_links`):

| Role | Own behaviour | Relationships |
|---|---|---|
| L1 | inflows only from victim-like senders (fan-in 1–8), splits each inflow 3–6 ways in 3–15 min, out/in ≈ 0.98, combo (P2A) on outgoing edges, low lifetime activity | inflow from victims; outflow to L2-like accounts |
| L2 | single inflow source(s) from L1, forwards to ONE account within ~60 min, out/in ≈ 0.96, combo (WALLET_LOAD) on outgoing edges | inflow from L1; outflow to L3-like accounts |
| L3 | receive-only sink (never sends), inflows are combo edges | inflow from L2; no outflow |

**Layer link** = a specific transaction that proves money moved between layers:
direction (upper → lower layer) · timing (after money arrived at the sender, within the pass-through window) ·
amount (fits within what arrived). Link types: Victim → L1 (L1 edge score), L1 → L2, L2 → L2 (extra layering hop), L2 → L3.

**Role decision:**
1. Pass 1: behaviour-only candidate roles for flagged accounts.
2. Build `layer_links` between victims and candidates.
3. Pass 2: relational features (upstream/downstream role share) → final L1/L2/L3 role scores.
4. Assign the highest role score if ≥ 50 **and** at least one confirming link to the layer above or below.
5. Otherwise, or if the top two role scores are within 10 points → role = `UNCLASSIFIED_MULE`
   (keep both candidate roles for display).
6. Role rules, thresholds and weights live in the scoring profile (editable), not in code.
7. Many flagged accounts low on all three role scores = evidence of a pattern outside L1/L2/L3 (e.g. an "L4").

Display example: `Final 84 (Mule 90, Trust 14) · Role L2 confirmed (L1 31, L2 82, L3 40)`.

**FINAL role score weights (v1-verified):**
- L1: victim-sourced inflow 30 · split 3–6 per inflow 25 · commission 0.97–0.99 20 · lag 3–15 min 15 · flagged outgoing 10
- L2: inflow from L1 candidates 30 · single forward per inflow 25 · commission 0.94–0.97 20 · lag ≤ 60 min 15 · flagged outgoing 10
- L3: receive-only 40 · inflow from L2 candidates 30 · flagged incoming 20 · low activity 10
- VICTIM (unflagged accounts only; a role, not a mule): send-only 35 · single/few outflows ≥ 5× population median 30 ·
  payee has high L1 score 25 · low activity 10. Victim score ≥ 60 → role VICTIM.

### 4.6 Feature rules decided after the features review (2 Oct)

- **NULL = not applicable**, never 0: send-only accounts have no inflow features, receive-only accounts
  have no outflow features, flow features are NULL when no inflow was ever forwarded. Scoring: a NULL
  feature gives 0 points and never counts toward the two-signal rule.
- **Allocation → episodes:** mules may forward out of order (verified: an L2 receives ₹65,008 then ₹38,052,
  and forwards 0.96 × ₹38,052 first, then 0.96 × ₹65,008). One-to-one earliest-first allocation drops such
  outflows. Rule: group inflows whose forwarding windows overlap into one **episode**; allocate outflows inside
  the episode window to the episode as a whole (an outflow may span several inflows); compute
  `pass_through_share` and `commission_ratio_median` from episode totals (out ÷ in per episode, never > 1.0).
  `split_count_median` = distinct receivers per episode ÷ inflows in it, rounded (or per inflow when the
  episode has one inflow).
- **median_hold_hours:** NULL when the account never forwards (no imputed end-of-data timestamp), so sinks
  can never earn balance-retention trust.
- **device_consistency:** spec boolean — 1 only if one device family AND only domestic IPs, else 0
  (no modal-share ratios; per-account device ratios reflect the generator's device thirds = fingerprint).
- **recurring_sender_share:** senders seen on ≥ 3 different DAYS (not ≥ 3 transactions).
- **split_count_median:** distinct receivers per inflow.
- **All cut-offs in the profile** (victim-like max outflows, recurring days, odd-hour range, round unit) —
  none hard-coded.
- **measure_before_burst:** trust features use the pre-burst period where a burst exists; if not yet
  implemented, document as a limitation (low impact here: mules have no pre-burst history).
- **Reciprocity gate (closed on this dataset):** normal accounts' median reciprocity is 0 (random
  counterparties). Gate rule: reciprocity is informative only if the normal-population median > 0.05.
  When closed: **T2 weight 0, its 20 points move to T1 (+10, total 35) and T5 (+10, total 25)**;
  **MP6 = full points if send-only or receive-only, else 0** (no reciprocity component).
- `features.py` takes an optional `--db` path (default data\case.duckdb) so reviewers can run it on a copy.
- Zero-weight extras still to add: `burst_fan_in`, `ip_churn`; `in_cycle` stays NULL until the graph step.
- **More closed gates on this dataset:** normal accounts' median `recurring_sender_share` = 0 and median
  `median_hold_hours` = 0.5 h, so **T6 (recurring inflows) and T3 (balance retention) carry no signal here**.
  Gate rule: T3 informative only if the normal-population median hold ≥ 6 h; T6 only if the normal median
  recurring share ≥ 0.05. When closed, their weight moves to T1 / T4 / T5 proportionally. On this dataset
  Trust rests on T1 (activity spread), T4 (organic amounts) and T5 (clean neighbourhood).
- **Forbidden (new fingerprint):** the generator writes each mule inflow and its forward on ADJACENT CSV rows
  (e.g. tx_key 1676 → 1677). Never use tx_key order/adjacency to link transactions; match by time and amount only.
- **Forbidden (verified 2 Oct): file position.** ALL injected rows sit in one block at the START of the CSV:
  tx_key 1–2,954 = the 300 victim payments + 2,654 mule transfers; every normal row has tx_key ≥ 2,955.
  Never use tx_key / row position in any way for scoring, roles, links, tracing, sampling or demos
  (tx_key is only a unique key; tie-breaks on it are allowed but must not change results).
- **Forbidden: IP prefix as a role label.** 185.x (1,327 rows) and 194.x (1,327 rows) each map to one transfer
  type; use "foreign IP" as one combined flag only, never 185 vs 194 to tell L1→L2 from L2→L3.
- **Checked, NOT fingerprints:** Transaction_ID number ranges (overlap fully), amount decimal precision
  (~10% one-decimal in all groups), timestamp seconds (~2% at :00 in all groups).
- **Real signal, not decisive:** mule transfers are rarely under ₹1,000 (1.7% vs 53.9% of normal rows) but
  small chains exist (smallest mule transfer ₹96.85; one L2 forwarded ₹251 → ₹241). MP8 stays a 5-point
  supporting signal; amount must never decide a flag or a role on its own.

### 4.4 Victim trace

- Step 0: score each victim outgoing transfer (L1 edge score: onward forwarding 40%, burst fan-in 20%,
  first-time payee + amount anomaly 15%, downstream L2 pattern 15%, narration/device 10%).
- Follow only outflows **after** money arrived, within a short window; rank by receiver risk; follow until
  ~90% of the tainted amount is covered; stop at 4 hops or L3; sum taint when money recombines.
- Per-victim taint when several victims share mules. Reverse trace from a ring finds all its victims.
- Output per node: role, hop, tainted in/out, **holding amount** (freeze priority), bank, Transaction_IDs.
- Trace window starts at 60 min (wider than the PS 3–15 min velocity rule); tune on real data.
- The trace follows `layer_links` first, then falls back to the general rules. Hop limit configurable (default 4).
- **Per-hop summary:** accounts, transfers, amount moved, time since previous hop (e.g. "₹4.5L across 3 hops in 22 min").
- **Findings:** each detected pattern as {pattern, confidence, evidence sentences, accounts, tx_ids, hop range}.
  Multi-account patterns: **Scatter-Gather** (split out, reconverge at the same account within a short window),
  **Funnel/consolidation** (fan-in from other mules, distinct from L1 fan-in from victims), cycles, rapid pass-through.
  Per-account patterns (fan-in, fan-out, pass-through, cycles, dormancy, structuring) are READ from `features`,
  never recomputed differently in the investigation view.
- **Fingerprint:** SHA-256 of the sorted tx_ids in a trace or ring; same evidence → same hash. Printed on notices.
- **Who / How / Why / When** structure for the account panel and the case diary.
- Edge cases to handle: unknown account (clean "no transaction graph found"), sparse graph, very connected
  account, deep paths, no cycle.

### 4.4b Multiple victims, rings and cases

- Scoring and rings are **global** (all accounts at ingestion); only the trace starts from a victim.
- **Multi-victim trace:** merge several victims into one graph; shared mules appear once.
- **Per-victim taint:** track each victim's share through shared mules (pro-rata).
- **Reverse trace:** from a ring's L1s back to every likely victim.
- **Case** = set of victims and/or rings; FIR, diary and notices are generated per case.
- **Rings overview:** victim count, total amount, mules by layer, recoverable amount.
- Planned endpoints: `POST /trace/batch`, `GET /ring/{id}/victims`, `POST /case`, `POST /report/case/{case_id}`.

### 4.5 AI officer guardrails

- Freeze notices: Jinja2 template per bank, filled **only by code**.
- Diary/FIR: LLM sees tokenised evidence only (ACC_n, AMT_n); Pydantic JSON schema restricts account fields
  to existing tokens; code substitutes real values; validator checks every 12-digit number and ₹ amount.
- Raw Narration text **never** enters a prompt. Outputs are drafts for officer review.
- **FIR draft is in scope** (PS: "Automated FIR & Case Diary Generation"): officer-entered complainant details,
  offence summary, total lost, traced accounts as annexure — same evidence builder and validator.
- Diary must list **layer-wise accounts with exact timestamps and amounts**, not generic descriptions.
- Legal references (confirm with police mentors): CrPC 91 ≈ BNSS 94; freezing/seizure CrPC 102 ≈ BNSS 106;
  case diary CrPC 172 ≈ BNSS 192. Never claim a notice was "dispatched" or "cryptographically verified".
- Bank Nodal Officer directory: static file mapping the 10 IFSC prefixes to bank name + address block.

## 5. Tech stack

| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Storage & analytics | DuckDB (embedded, file-backed, memory_limit 3 GB) |
| Columnar format | Apache Arrow / Parquet |
| Graph access | NumPy CSR arrays |
| Graph algorithms | igraph (python-igraph) |
| Optional anomaly ranking | scikit-learn Isolation Forest |
| API | FastAPI + Uvicorn |
| Frontend | React + Vite |
| Graph rendering | Cytoscape.js + cytoscape-dagre |
| Local LLM | Ollama, `qwen2.5:7b` (Q4, ~5 GB RAM) |
| Structured output | Pydantic |
| Documents | Jinja2 + WeasyPrint (HTML → PDF) |
| Packaging | `run.bat` (Windows) or Docker Compose |

## 6. Repository layout

Project root on the dev machine: `C:\Users\ROG\Cyber_svvv_project` (Windows).

```
Cyber_svvv_project/
├── .venv/              # Python virtual environment (always use this)
├── data/               # VoidHacks8_MuleAccount_2M_Transactions.csv, case.duckdb, *.npy (never commit)
├── notebooks/          # Jupyter exploration only — app code never imports from here
├── engine/
│   ├── sql/schema.sql      # CREATE TABLE IF NOT EXISTS for up-front tables
│   ├── sql/features.sql    # per-account features
│   ├── ingest.py           # validation, rejects, accounts, tx, ingest_meta
│   ├── scoring.py          # Mule, Trust, Final, bands, roles, rings
│   ├── graph.py            # CSR build/load, rings, cycles
│   ├── trace.py            # L1 edge score, constrained 4-hop trace
│   └── config.yaml         # default scoring profile (seeds scoring_profiles)
├── legal/              # evidence.py, schema.py, llm.py, validator.py, templates/
├── api/                # main.py (FastAPI, serves ui/dist)
├── ui/                 # React + Vite + Cytoscape
├── bench/              # synthetic data generator, timing and precision tests
├── cases/              # generated outputs per case
├── wheels/             # offline copies of Python packages
├── requirements.txt    # runtime only
├── requirements-dev.txt# jupyter etc.
├── run.bat
└── PROJECT_CONTEXT.md
```

Note: an `abhedya/` subfolder was created by an earlier setup step. It is NOT the working layout.
Do not create files in it or delete it — ask the user before moving anything.

## 7. Environment (Windows)

- OS: Windows. Give Windows commands (cmd or PowerShell), never Linux-only ones.
- Python: always `.venv\Scripts\python.exe` and `.venv\Scripts\pip.exe`.
  Activate with `.venv\Scripts\activate.bat` (cmd) or `.venv\Scripts\Activate.ps1` (PowerShell).
- Dataset: `data\VoidHacks8_MuleAccount_2M_Transactions.csv`. Database: `data\case.duckdb`.
- **DuckDB allows one writer at a time.** Before running a script that writes `case.duckdb`,
  make sure no notebook kernel or other process has it open. Notebooks should connect with
  `read_only=True` while scripts or the API are running. Always `con.close()` at the end of scripts.
- In SQL string paths, use forward slashes (`data/...`) on Windows.

**Python packages** (installed in `.venv`):

```
duckdb pyarrow polars numpy pandas igraph scikit-learn fastapi "uvicorn[standard]"
pydantic jinja2 weasyprint ollama python-multipart pyyaml orjson
```

- WeasyPrint needs GTK/Pango on Windows (official WeasyPrint Windows instructions); only needed for the PDF step.
- `pip freeze > requirements.txt` and `pip download -r requirements.txt -d wheels` for offline reinstall.

**Frontend** (in `ui/`): Vite React (JavaScript) template, plus `cytoscape cytoscape-dagre`.

**Local LLM:** Ollama for Windows with `qwen2.5:7b` installed and tested (chat + JSON-schema
structured output both work). `qwen2.5:3b` is the optional faster fallback. The Python `ollama`
package is only a client talking to `localhost:11434`; it never downloads models.

## 8. Rules for agents working on this project

1. **Everything must run offline** at runtime. No cloud APIs, no CDN links in the UI, no telemetry calls.
2. **Never loop over transactions in Python.** Use DuckDB SQL or vectorised NumPy.
3. **Account numbers are text**, amounts are integer paise, timestamps are parsed explicitly.
4. **Never send raw Narration text to the LLM.** Never let the LLM produce account numbers or amounts.
5. All weights and thresholds live in the `scoring_profiles` table (seeded from `engine/config.yaml`), never hard-coded.
6. Keep memory under control: DuckDB `memory_limit='3GB'`; load the LLM only when generating reports.
7. Do not modify files outside the project root without asking.
8. Only do what the current task asks — do not build features that were not requested.

### Implementation guardrails (from reviewing an earlier prototype — never break these)

9. **Never read ground-truth labels** in scoring, role assignment or tracing. Ground truth is used only by the
   offline evaluation script. Copying labels fakes precision/recall; the jury dataset will not include them.
10. **Keep the original Transaction_ID** from the file. Never regenerate IDs — notices must cite real IDs.
    Transaction_ID is NOT unique in this dataset: join on `tx_key`, never on tx_id alone.
11. **Never assign roles by hop number** and never give unscored accounts a default risk score.
12. **Trace only victim → L1 transfers** (L1 edge score) and risk-ranked, amount-capped outflows — not every payment.
13. **No cloud LLMs or external APIs** (no Gemini/OpenAI/Groq). Local Ollama only.
14. **No mock-data fallback** in the UI. On API failure, show an error.
15. **Quarantine bad rows** in a `rejects` table with a reason. Never fill missing timestamps with a fake date,
    never force amounts positive with ABS, never silently drop rows, never pad account numbers to "fix" them.
16. Velocity windows must not double-count overlapping outflows; pass-through share stays within 0–100%.
17. No hard-coded personal paths; never commit data files or ground-truth files.
18. **How agents must read the data:** never open, `cat`, `type` or read the CSV into your own context
    (at most `head`-style 5 lines to see the header). Always analyse it by running DuckDB through
    `.venv\Scripts\python.exe`: `read_csv(..., all_varchar=true)`, an in-memory connection
    (`duckdb.connect()`) for exploration so `case.duckdb` is never locked, and print only aggregated or
    LIMIT-ed results (no more than ~50 rows). No pandas `read_csv` on the full file.

## 9. Database (DuckDB) — 12 tables

All tables live in one file, `data\case.duckdb`. No PostgreSQL or other server.
Two creation styles:
- **Derived tables** (`accounts`, `tx`, `rejects`, `features`):
  `CREATE OR REPLACE TABLE ... AS SELECT ...` so each step can be rerun safely.
- **Fixed-schema tables** (`ingest_meta`, `scoring_profiles`, `scores`, `layer_links`, `rings`, `cases`,
  `case_outputs`, `bank_directory`): `CREATE TABLE IF NOT EXISTS` in `engine/sql/schema.sql`.
  The API and UI depend on their columns, so they never change shape. `scoring.py` refills `scores`,
  `layer_links` and `rings` per profile with `DELETE ... WHERE profile_id = ?` then `INSERT`.

| # | Table | Grain | Columns |
|---|---|---|---|
| 1 | `ingest_meta` | one per load | load_id, file_name, file_sha256, rows_total, rows_loaded, rows_rejected, load_seconds, loaded_at |
| 2 | `rejects` | one per bad input row | row_number, raw values (text), reason |
| 3 | `accounts` | one per account (~25K) | acct_id INT, acct_no VARCHAR (4-letter bank code + 8 digits), ifsc, bank (IFSC first 4), first_seen, last_seen |
| 4 | `tx` | one per transaction (2M) | tx_key BIGINT (unique internal key = source CSV row number, stable across reloads), tx_id (ORIGINAL Transaction_ID — NOT unique, see note), is_dup_tx_id BOOLEAN, src, dst (acct_id), amount_paise BIGINT, ts TIMESTAMP, ts_sec INT, mode, narration, ip, device, is_foreign_ip, is_reserved_ip, is_headless, narr_flags (bitmask), utr |
| 5 | `features` | one per account | one column per raw measurement (pass_through_share, median_hold_min, burst_fan_in, victimlike_sender_share, split_count, commission_share, foreign_ip_share, headless_share, cashout_narr_share, shared_ip_cluster_size, in_cycle, structuring_share, timing_regularity, ip_churn, odd_hour_share, days_active, burst_compression, reciprocity, amount_diversity, recurring_inflows, device_consistency, is_merchant, tx_count, …) |
| 6 | `scoring_profiles` | one per profile version | profile_id PK, created_at, is_active, is_locked, definition JSON |
| 7 | `scores` | one per account per profile | acct_id, profile_id, mp1…mp8, t1…t7, mule_index, trust_index, final_index, band, is_flagged, override_applied BOOLEAN, l1_score, l2_score, l3_score, victim_score, role (L1 / L2 / L3 / UNCLASSIFIED_MULE / VICTIM / NULL), role_confirmed BOOLEAN, candidate_roles (text list), upstream_role_share JSON, downstream_role_share JSON, param_points JSON (points per parameter ID, so parameters added later fit without schema changes), reasons (text list), ring_id |
| 8 | `layer_links` | one per proven inter-layer transfer per profile | profile_id, tx_key (PK with profile_id), tx_id, from_acct, to_acct, from_role, to_role, link_type (VICTIM_L1 / L1_L2 / L2_L2 / L2_L3), lag_seconds, amount_paise, share_of_inflow, ring_id |
| 9 | `rings` | one per ring per profile | profile_id, ring_id, size, l1_count, l2_count, l3_count, unclassified_count, victim_count, total_in_paise, holding_paise, first_ts, last_ts, patterns (text list: SCATTER_GATHER, FUNNEL, CYCLE, …), fingerprint (SHA-256) |
| 10 | `cases` | one per investigation | case_id PK, created_at, profile_id, dataset_sha256, victim_accts VARCHAR[], ring_ids INTEGER[], status |
| 11 | `case_outputs` | one per generated document | case_id, doc_type (FIR / diary / notice), bank, file_path, validated BOOLEAN, created_at |
| 12 | `bank_directory` | one per bank | bank_prefix PK, bank_name, nodal_officer_title, address_block |

**Transaction_ID is not unique in the real dataset:** 2,250 IDs repeat across 4,502 rows (2,248 IDs twice,
2 IDs three times). Verified as random collisions, not a fraud pattern: across 2,254 pairs, 0 share sender,
receiver or amount; median gap ~4.3 days; headless devices involved in 5 pairs (≈ chance). Not a scoring signal. Rules: keep both rows (never reject or merge them); use `tx_key` as the only
join/primary key everywhere (tx, layer_links, CSR `*_tx.npy` arrays, evidence objects); flag both rows with
`is_dup_tx_id`; anything shown to officers or printed on notices cites the original tx_id **together with**
timestamp, amount, sender and receiver so a duplicated ID is unambiguous; the diary/notice notes when a cited
ID is duplicated in the source data. Check during profiling whether duplicated IDs correlate with mule activity.

**Not tables:** CSR graph arrays beside the DB (`out_ptr.npy`, `out_dst.npy`, `out_tx.npy`, `in_ptr.npy`,
`in_src.npy`, `in_tx.npy`, `edge_ts.npy`, `edge_amt.npy`), rebuilt from `tx` on every load.
Trace results are computed on demand; a case's trace snapshot is saved as JSON in `cases\<case_id>\`.

**Build order:** schema.sql → ingest_meta, rejects, accounts, tx (ingest.py) → features → scoring_profiles →
scores pass 1 (mule/trust/final, candidate roles) → layer_links → scores pass 2 (role scores, confirmation,
neighbour risk) → rings (from layer_links) (scoring.py) → cases, case_outputs, bank_directory (API / legal step).

**Validation rules at ingestion** (failures go to `rejects`, never fixed or defaulted):
sender and receiver accounts match `^[A-Z]{4}[0-9]{8}$` · IFSC matches `[A-Z]{4}0[A-Z0-9]{6}` · timestamp parses as
`%Y-%m-%d %H:%M:%S` · amount numeric and > 0 · Payment_Mode in (UPI, IMPS, NEFT, RTGS) · non-empty Transaction_ID.
Read the CSV with `all_varchar=true` first; convert types only after validation.

## 10. Editable parameters and the frontend JSON pipeline

- Features are computed once (heavy); scoring 25K accounts from `features` takes < 1 s, so parameters
  can be changed from the UI and everything re-scored instantly.
- Each parameter is a record in the active profile: id, name, index (mule/trust), feature column,
  rule (e.g. `{"full_at": 0.90, "half_at": 0.50}`), weight, enabled.
- The UI may enable/disable parameters, change weights/thresholds, and add parameters **only over
  existing feature columns**. No free-typed SQL from the UI.
- Every saved change creates a new profile version; cases record their `profile_id`. A locked default
  profile is used for the jury evaluation. Validation: no negative weights, ≥ 2 parameters enabled,
  two-signal rule always on.
- Data flow: DuckDB → FastAPI (Pydantic models) → JSON over HTTP → React. React never touches DuckDB.
- The UI is data-driven: it renders whatever parameter list the API returns; no hard-coded parameter names.
- **Reliability gates:** gated parameters (rail mismatch, amount vs mode limits, odd-hour activity, shared IP,
  structuring) are scored ONLY if the loaded dataset shows the field is informative (e.g. rail-mismatch rate
  < 5%, limit violations < 1%, uneven hourly activity, IP reuse present). Gate thresholds live in the profile;
  gate results are computed after ingestion (later by the Data Audit module, table `audit_results`) and the
  reason is shown when a gate disables a parameter. On this dataset all of these gates are closed.
- Planned endpoints: `GET /profiles/active`, `POST /profiles/preview` (impact without saving),
  `POST /profiles` (save new version), `POST /profiles/{id}/activate`.

## 11. Graph model

Directed, weighted, temporal multigraph: nodes = accounts, edges = transactions (amount + timestamp),
multiple edges per pair allowed. Patterns: in-star (L1), out-star 3–7 (L2), fast in→out (pass-through),
time-respecting paths (trace), directed cycles (M6), neighbour aggregation (M7/T7), components/Leiden (rings),
sinks (L3). Degrees and flows in SQL; trace over CSR arrays; cycles and rings with igraph on small subgraphs.

## 12. Verifying our assumptions (before tuning)

Assumptions (L1/L2/L3 exist, 3–15 min timing, 3–7 splits, downward chains) must be checked on the real data:
- `SUMMARIZE` / pandera: data matches the PS schema.
- Log-scale histograms of features over all accounts: a separate mule bump (~1,500) with a gap.
- Hold-time and split-count histograms over candidates: peaks at 3–15 min and 3–7 receivers.
- Clustering flagged accounts (scikit-learn KMeans/HDBSCAN, UMAP to view): clusters matching L1/L2/L3 profiles;
  a clean extra cluster = candidate new role.
- Counts of transfers between candidate groups: mostly downward (L1 → L2 → L3).
- Precision/recall only on synthetic data with known injected mules.
Record each result and the threshold chosen in a notebook Markdown cell. Dev-only packages go in requirements-dev.txt.

## 13. Current status

- Done: environment and venv, Jupyter (dev only), DuckDB exploration on the real CSV, Ollama `qwen2.5:7b`
  tested including JSON-schema output.
- In progress: `engine/sql/schema.sql` + `engine/ingest.py` (ingest step).
- Done: fixed-schema tables `scores`, `layer_links`, `rings` in schema.sql (verified).
- DONE (verified 2 Oct, 24/24 checks): tx_key + is_dup_tx_id, explicit account rule, layer_links PK
  (profile_id, tx_key), scores aligned to the final spec (mp1..mp8, victim_score, override_applied,
  param_points), exploration tables dropped, v1-verified profile seeded. Project is a git repo
  (.gitignore excludes data\, .venv\, wheels\, abhedya\, data files).
- Step 3 features: BUILT (2.5 s), structure verified (groups separate cleanly). Fixes pending — see 4.6.
- NEXT: apply the 4.6 feature fixes, re-verify, commit; then Step 4 scoring.

