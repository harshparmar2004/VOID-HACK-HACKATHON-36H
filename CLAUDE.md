# Project rules (read automatically)
- Source of truth: PROJECT_CONTEXT.md. Read ONLY the sections a task names.
- Progress log: BUILD_LOG.md. Read only its LAST entry at the start of a task.
- Windows only. Python: .venv\Scripts\python.exe. Never use other Pythons.
- Database: data\case.duckdb. Close connections in a finally block.
- Never read the CSV into context. Never search data\, .venv\, wheels\,
  abhedya\, reports\ or notebooks\. Search only engine\ and audits\ unless told.
- Do not read PDFs unless told. Do not edit PROJECT_CONTEXT.md.
- Weights, thresholds, windows, gates: read from the active scoring profile.
  Never hard-code them.
- Join on tx_key / acct_id only. Never use tx_id as a key.
- FORBIDDEN: ground-truth files; account-number ranges; device counts or
  device thirds; row position or adjacency (tx_key order); 185 vs 194 as a
  role label; the 50-transaction cut-off as a hard rule; roles by hop number.
- No Python loops over transactions. No network calls. No mock data.
- NULL feature = not applicable: 0 points, never counts toward two-signal.
- Keep reports short: runtime, summary table, failures only.
- End every task by appending a BUILD_LOG.md entry (max 25 lines: date,
  step, files, key names, results, deviations). Then stop.
