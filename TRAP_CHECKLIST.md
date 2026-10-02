# TRAP_CHECKLIST.md — Dataset traps, inconsistencies and wrong data to test

Dataset: `data\VoidHacks8_MuleAccount_2M_Transactions.csv` (2,000,000 rows, 11 columns).
Read `PROJECT_CONTEXT.md` Section 3b first: facts already verified there are marked **[KNOWN]** below —
re-confirm them quickly with one query, do not re-investigate in depth.

For every check record: **result**, **count of affected rows/accounts**, **up to 5 example rows**, and a
**verdict**: `CLEAN` · `TRAP` (bad/inconsistent data to handle) · `SIGNAL` (likely injected fraud pattern) ·
`NOISE` (generator artefact, ignore) · `INCONCLUSIVE`. Add a one-line **recommended handling**.

---

## A. File-level

| ID | Check |
|---|---|
| A1 | File encoding is UTF-8; presence of a byte-order mark (BOM) at the start |
| A2 | Header names exactly match the 11 expected column names (spelling, case, spaces, hidden characters) |
| A3 | Every row has exactly 11 fields (count rows with more/fewer) |
| A4 | Physical line count vs parsed row count (embedded newlines inside quoted fields) |
| A5 | Line endings (CRLF vs LF, mixed) and trailing empty lines |
| A6 | Quoted fields containing commas or quotes; parsing stays aligned |
| A7 | Non-UTF-8 or control bytes anywhere in the file |
| A8 | Fully identical duplicate rows (all 11 columns equal) |

## B. Transaction_ID

| ID | Check |
|---|---|
| B1 | [KNOWN] Duplicated IDs: 2,250 IDs over 4,502 rows, 2 IDs three times — confirm counts only |
| B2 | Leading/trailing spaces, lowercase `txn`, other prefixes |
| B3 | Format `TXN` + 9 digits for all rows |
| B4 | Does ID order correlate with timestamp order? (sequential IDs vs random) |
| B5 | Do ID numeric ranges correlate with suspicious rows (headless/foreign)? → possible leakage |

## C. Accounts (Sender_Account / Receiver_Account)

| ID | Check |
|---|---|
| C1 | [KNOWN] Format `^[A-Z]{4}[0-9]{8}$`, prefix = IFSC prefix — confirm only |
| C2 | Whitespace or lowercase variants of the same account |
| C3 | One account appearing with more than one IFSC (branch changes) — as sender, receiver and across both |
| C4 | Self-transfers (sender = receiver) |
| C5 | Number of distinct accounts (expect ~25,000); accounts that only send, only receive, or do both |
| C6 | Lookalike accounts differing by one digit (possible typo/decoy pairs) — sample-based is fine |
| C7 | Distribution of accounts and transactions by bank prefix; are payments banks (PYTM, AIRP, IPOS…) over-represented in headless/foreign rows? |
| C8 | Do account number ranges (the 8 digits) separate unusual behaviour? (e.g. all headless senders above some number) → possible leakage |
| C9 | Transactions per account: distribution, top 20 most active accounts, accounts with exactly 1 transaction |

## D. IFSC

| ID | Check |
|---|---|
| D1 | Format `^[A-Z]{4}0[0-9A-Z]{6}$`; 5th character always `0` |
| D2 | List of distinct bank prefixes and counts (PS says 10 banks — how many really?) |
| D3 | Number of distinct branch codes per bank; same branch code reused across banks |
| D4 | Sender_IFSC vs Receiver_IFSC same bank share (intra-bank vs inter-bank) |

## E. Amount

| ID | Check |
|---|---|
| E1 | Non-numeric values, commas, currency symbols, spaces |
| E2 | Zero or negative amounts |
| E3 | More than 2 decimal places; amounts ending in `.0` vs `.00` formatting |
| E4 | Min, max, median, p90, p99, p99.9; extreme outliers |
| E5 | Share of round amounts (multiples of 100, 500, 1,000, 10,000) overall and by device/IP type |
| E6 | Clusters just below limits: 9,999 · 49,999 · 99,999 · 1,99,999 · 4,99,999 · 9,99,999 (±1%) |
| E7 | Most frequent exact amounts (top 30) — repeated identical values |
| E8 | Payment-mode limits: UPI > ₹1,00,000 · RTGS < ₹2,00,000 · IMPS > ₹5,00,000 (count each) |
| E9 | First-digit distribution vs Benford's law (generator artefact check) |
| E10 | Amount distribution for headless-device rows vs normal rows |

## F. Timestamp

| ID | Check |
|---|---|
| F1 | [KNOWN] Single format `YYYY-MM-DD HH:MM:SS` — confirm parse failures = 0 |
| F2 | Min/max; rows outside the main ~15-day window; future dates |
| F3 | Impossible values that still parse oddly (e.g. second = 60, hour = 24) |
| F4 | Transactions per day and per hour of day; missing hours/days; abnormal spikes |
| F5 | Seconds field always `00` or other unnatural precision patterns |
| F6 | Many rows sharing the exact same timestamp (top 10 timestamps by count) |
| F7 | Minutes with unusually many transfers from different accounts (coordinated bursts) |
| F8 | Is file row order sorted by time? (affects tx_key meaning) |

## G. Payment_Mode

| ID | Check |
|---|---|
| G1 | Exact distinct values and counts; case/whitespace variants |
| G2 | [KNOWN] Narration rail is independent of Payment_Mode (~71/14/14 for every mode) — confirm only |

## H. Narration

| ID | Check |
|---|---|
| H1 | Structure: share matching `(UPI|IMPS|NEFT)/<Category>/<Detail>#<number>`; list non-matching patterns |
| H2 | Category segment (2nd part) counts sorted rarest first — rare categories are candidate scam/cash-out markers |
| H3 | Keyword scan: crypto, usdt, p2p, binance, wazirx, wallet, gateway, atm, cash, withdraw, offshore, task, bonus, invest, ipo, kyc, customs, arrest, cbi, police, loan, refund, betting, hawala, mule |
| H4 | Prompt-injection-like text: ignore, previous, instruction, system, assistant, prompt, override, `{{`, `${`, `<script`, `</`, SQL fragments (`' OR`, `DROP`, `--`, `;`) |
| H5 | Non-ASCII characters, zero-width characters, homoglyphs; very long narrations (length distribution) |
| H6 | Account numbers, IFSCs or amounts embedded in the narration that do NOT match the row (decoys) |
| H7 | The `#<number>` reference: duplicates, format, does it ever equal another row's Transaction_ID? |
| H8 | Narration categories vs device/IP: which categories co-occur with headless devices or foreign IPs? |

## I. IP_Address

| ID | Check |
|---|---|
| I1 | Full list of shapes (no LIMIT); invalid octets > 255; leading zeros; empty octets |
| I2 | IPv6 or non-IP values |
| I3 | Private/reserved/loopback/multicast ranges (10.x, 172.16–31.x, 192.168.x, 127.x, 0.x, 224+) |
| I4 | First-octet distribution; counts for 185.x and 194.x; any other non-103 octets |
| I5 | One IP used by many different sender accounts (top 20 IPs by distinct senders) |
| I6 | Distinct IPs per sender account; accounts switching between domestic and foreign IPs |
| I7 | Foreign-IP rows: which devices, payment modes, narration categories, amounts |

## J. Device_Type

| ID | Check |
|---|---|
| J1 | [KNOWN] 5 values; Linux_Script 1,327 and Web_Emulator 1,327 — confirm exact values and case |
| J2 | Devices per sender account; accounts mixing phone and headless devices |
| J3 | Headless rows: which accounts send them (how many distinct), time-of-day, amounts, IPs, narrations |
| J4 | Co-occurrence matrix: headless × foreign IP × cash-out narration × odd hours (1–5 AM) |

## K. Cross-column consistency

| ID | Check |
|---|---|
| K1 | Account prefix vs IFSC prefix [KNOWN 0 mismatches] — confirm only |
| K2 | Same account → different bank prefix across rows (should be impossible) |
| K3 | Amount vs Payment_Mode limits (see E8) — does the generator respect real rules? |
| K4 | Device vs IP plausibility (e.g. iOS with foreign proxy IP) |

## L. Graph and behaviour traps

| ID | Check |
|---|---|
| L1 | Decoy merchants: high distinct-sender count, active most of the 15 days, little outflow |
| L2 | Lookalike pass-through: accounts forwarding ≥90% within 15 min but with long, steady history |
| L3 | Accounts forwarding money faster than 3 minutes, or at 0 seconds, after an inflow |
| L4 | Fan-out per inflow: distribution of distinct receivers within 15 min of an inflow; how many > 7 |
| L5 | Commission pattern: out ≈ in × 0.95–0.99 within 60 min; how many accounts |
| L6 | Equal-sized splits (outflows of near-identical amounts after one inflow) |
| L7 | Money out before money in: accounts whose cumulative outflow exceeds cumulative inflow early in the window |
| L8 | Accounts that send but never receive (likely victims or external sources) and receive but never send (sinks) |
| L9 | Reciprocal pairs (A→B and B→A) and short cycles (2–4 hops) among normal-looking accounts |
| L10 | Accounts active only within a very short window (e.g. < 2 hours total) and silent otherwise |
| L11 | Dormant-then-burst accounts (no activity for days, then many transfers) |
| L12 | Victim-like accounts (one large outflow to a first-time payee) that also receive large inflows later |
| L13 | Paths that only work if time is ignored (A→B after B→C) — sample a few candidate chains |
| L14 | Estimated mule population: accounts meeting at least two of {fast pass-through, burst fan-in, 3–7 split, headless/foreign} — compare with the expected ~1,500 |

## M. Leakage and generator hints

| ID | Check |
|---|---|
| M1 | Any narration, ID or field containing words like mule, victim, fraud, layer, L1/L2/L3, test, fake, injected |
| M2 | Do account-number ranges, ID ranges or bank prefixes cleanly separate suspicious rows? (report only — such shortcuts must NOT be used in scoring) |
| M3 | Uniform/unnatural distributions (perfectly even device thirds, flat hourly counts) that reveal how normal vs injected data were generated |

## N. Already-decided items (do not change, only confirm)

- Transaction_ID is not unique → handled with `tx_key`.
- Accounts are 4 letters + 8 digits.
- Narration rail vs Payment_Mode mismatch is noise.
