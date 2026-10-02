# API_CONTRACT.md — Our API for their frontend (Step 6)

Source frontend: github.com/harshparmar2004/VOID-HACK-HACKATHON-36H, `frontend/` (commit 50620ee),
copied into our project as `ui\`. API base used by the UI: `http://127.0.0.1:8000/api` (keep).
**Our database decides the frontend, never the reverse.**
- The API never writes the engine database: it opens `data\case.duckdb` with `read_only=True`, creates no
  tables, adds no columns, writes no rows. The engine (ingest → features → scoring → links → cells → graph)
  is the only thing that writes it.
- Since Step 8d the API writes ONE file: the case store `data\cases.db` (`engine\case_store.py`), and only
  by appending rows (cases, case_events, case_outputs + the stored HTML, freeze_actions).
  `ABHEDYA_CASES_DB` points it at another file (audits use a scratch file in %TEMP%).
- If the UI expects a field our tables do not have, the API returns it as `null` (or omits it) and the
  UI is adapted in Step 7. Never add a table/column or compute a fake value to satisfy the UI.
- Other endpoints that would WRITE (upload pipeline, profile save/activate, vault certificate) are
  DEFERRED and return HTTP 501 "not yet available" until their own step.
- Keep their paths/field names where they fit our engine; add our fields; never fake data. Every response comes from our engine (tables: scores, features, layer_links, cells, tx,
accounts, ingest_meta, scoring_profiles) via `engine\victim_trace.py` and SQL. Pydantic models for all
responses. No mock fallbacks: on failure return a proper HTTP error.

## Decisions per endpoint

| UI call (their path) | Decision | Our implementation | Batch |
|---|---|---|---|
| GET /status | KEEP | latest ingest_meta (rows, load_seconds, file_sha256), counts: accounts, flagged, roles, victims, cells, active profile_id | B1 |
| GET /victims, GET /detected-victims | KEEP (same data) | accounts with role VICTIM: account, bank, amount paid, timestamp, victim_score, cell_ids | B1 |
| GET /mules?limit,role_filter,min_risk,min_amount,bank_filter | KEEP + ADD | from scores: role, final/mule/trust, band, role_confirmed, freeze_recommended, holding, reasons, cell_ids; min_risk filters final_index | B1 |
| GET /entities?limit,bank_filter,min_amount | KEEP | accounts + features + scores summary; bank_stats per bank | B1 |
| GET /trace/{victim}?max_hops,time_window,... | KEEP + CHANGE | trace_victim(); max_hops ≤ profile max; time_window IGNORED (windows come from the profile; return the profile values used); min_amount/bank_filter/keyword filter the RETURNED nodes/links only, never the trace logic; custom_rules DROPPED | B2 |
| (new) POST /trace/batch, GET /cells, GET /cells/{id}, GET /cells/{id}/victims, GET /network | ADD | trace_victims, cell_summary, reverse_trace_cell, network summary | B2 |
| POST /parameters/simulate | CHANGE (split) | NOW (read-only, B3): GET /profiles/active, GET /profiles/{id}, POST /profiles/preview (re-scores IN MEMORY from features, returns impact, writes nothing), GET /transactions/search (whitelisted fields, bound params). DEFERRED (writes): POST /profiles (new version), POST /profiles/{id}/activate → 501 | B3 / later |
| GET /scanner/summary, GET /scanner/problematic-transactions | CHANGE | transaction explorer over layer_links and flagged transfers (filters: link_type, bank, min_amount, keyword on narration category); no "whales", no invented fields | B4 |
| POST /scanner/run-60s-benchmark | CHANGE (read-only) | honest timings: latest ingest_meta + graph manifest build time + a live timed trace sample; never re-runs ingestion, never fabricated speed-ups | B4 |
| POST /jury/blind-test | CHANGE | trace N random victims (default 20), check each against the structural chain (audits logic), return correctness + time per trace; NO ground truth | B4 |
| POST /upload | DEFERRED (writes) | later: local file only → full engine pipeline; returns ingest_meta + counts. Until then 501 | later |
| GET /templates/{file} | KEEP (read-only) | static CSV template with the 11 columns | B4 |
| (new) POST /cases/{id}/close | ADD (writes cases.db) | body `officer`, `note?` → appends CLOSED, returns the case. Afterwards every write on the case (notices, diary, summary, FIR, freeze, unfreeze, close) answers 409; reads still work | 8d |
| (new) GET /cases/{id}/outputs, GET /cases/{id}/outputs/{output_id} | ADD (read-only) | list: the case's case_outputs rows with `stored`. Page: the stored HTML byte for byte (`text/html`, header `X-Content-SHA256`). Both re-hash the stored pages first; a mismatch answers 409 with the vault error | 8d |
| (new) POST /cases, GET /cases, GET /cases/{id} | ADD (writes cases.db) | POST body `victims[]`, `officer`, `fir_number?`, `complainant?` → 201, the case with its OPENED event, dataset SHA-256 and active profile. Detail carries `events`, `outputs`, `freeze_actions`; `status` = latest event | 8d |
| POST /scanner/emergency-freeze, GET /scanner/frozen-accounts?case_id, POST /scanner/unfreeze | CHANGE (writes cases.db) | body `case_id`, `accounts[]`, `officer?`, `note?`. Records REQUESTED / WITHDRAWN rows only; accounts must be reached by the case's traces (else 422); amount = the trace's holding. Every answer has `bank_notified: false`. frozen-accounts = latest action is REQUESTED | 8d |
| GET /legal/notices/{victim}?case_id | CHANGE (writes cases.db) | one validated notice per bank: `notices[]` of `{bank, bank_name, output_id, version, file_name, sha256, generator, html, ...}`; each stored in case_outputs; adds NOTICES_GENERATED. `case_id` required; the victim must be one of the case's | 8d |
| GET /legal/case-diary/{victim}?case_id, GET /legal/case-diary/{victim}/summary?case_id | CHANGE (writes cases.db) | diary: the template page at once (model not asked, generator `TEMPLATE`), stored, DIARY_GENERATED. Labels: `TEMPLATE` = model not asked, `TEMPLATE_FALLBACK` = asked and answer not used, `LLM+VALIDATED` = answer used. summary: asks the local model (up to `llm.timeout_seconds`); only a validated answer returns `summary` / `entries` and stores the diary as the next version; otherwise `summary: null` with `llm.status` | 8d |
| (new) POST /legal/fir | ADD (writes cases.db) | body `case_id`, `victim`, `complainant{name, address?, phone?, email?}`, `offence_summary`, `sections_of_law?`, `police_station?`, `officer?` → validated FIR draft (officer text as typed + code-filled annexures), stored, FIR_GENERATED | 8d |
| GET /vault/artifacts, POST /vault/verify | CHANGE | artifacts: every case_outputs row with its sha256 and chain hash, plus the dataset SHA-256. verify (read-only): hash chain of every case-store table, triggers, and every stored document re-hashed; `ok`, `problems[]` | 8d |
| GET /vault/certificate/{id} | LATER (Step 9) | until built: HTTP 501; certificate is a draft for officer signature | Step 9 |
| POST /victim/load-demo/{id} | DROP → REPLACE | replaced by "pick a sample victim" from GET /victims (real data) | B1 |
| POST /ingest-url | DROP | internet ingestion breaks offline rule | — |
| GET/POST /settings, POST /settings/test-connection | DROP | cloud LLM keys | — |
| POST /assistant/chat | DROP (maybe later) | cloud LLM; optional local-Qwen copilot only after Step 8 | — |

## Core response shapes (match their field names; extras are additive)

**GET /trace/{victim}** — their UI reads:
- `nodes[]`: `id` (account), `hop` (display only), `role`, `bank`, `ifsc`, `risk_score` (= our final_index;
  victim_score for VICTIM), `holding_amount`, `tainted_received`, `tainted_forwarded`, `device_type`, `ip_address`
- `links[]`: `source`, `target`, `amount`, `timestamp`, `txn_id`, `payment_mode`
- top level: `total_siphoned_inr`, `recoverable_holding_inr`
- ADD: `found`, `fingerprint`, `per_hop`, `findings`, `summary` (who/how/why/when), `freeze_candidates`,
  `reconcile`, `cells`, `profile` (id + windows used), per node `final_index`, `mule_index`, `trust_index`,
  `reasons`, `role_confirmed`, `freeze_recommended`, `cell_ids`; per link `tx_key`, `link_type`, `lag_seconds`
- Unknown account: `{"found": false, "message": "No transaction graph found"}` with HTTP 200 (UI shows empty state)

**GET /mules** — their UI reads per item: `account`/`account_id`, `bank`, `ifsc`/`bank_ifsc`, `role`,
`risk_index`/`risk_score`, `risk_band`, `forensic_reason`/`forensic_reasons`/`reasons`, `distinct_senders`,
`distinct_receivers`, `total_incoming_amt`, `total_outgoing_amt`, `current_holding_balance`/`holding_amount`.
Map `risk_index` = final_index, `risk_band` = band, reasons = our reasons list (also joined string).

**GET /status** and **POST /upload** — UI reads: `records_loaded`/`records_parsed`, `ingestion_seconds`/
`load_duration_seconds`, `hash`, `high_risk_mules`, `foreign_ip_txns`, `unique_receivers`, `victims`.

## UI changes required in Step 7 (not in the API batches)

Remove every `mockData` import and DEFAULT_* fallback (App.jsx, NetworkGraphView, EndpointTrailView,
MuleDossierView, RealtimeFraudScannerView) → show loading/error/empty states. Remove Settings modal and
assistant chat (cloud). Replace the Parameters Studio with the profile editor. Show Final/Mule/Trust,
reasons, role confirmation, findings and freeze list. Jury page shows only measured numbers.
