# Venv package install (Task 1)

| Field | Value |
|---|---|
| Date | 2026-10-02 |
| Interpreter | `C:\Users\ROG\Cyber_svvv_project\.venv\Scripts\python.exe` (confirmed) |

## Installed (local wheels under `abhedya\wheels`, read-only `--find-links`)

PyPI `pip install matplotlib scipy igraph networkx scikit-learn polars` failed with:

```
ReadTimeoutError HTTPSConnectionPool(host='pypi.org', port=443)
ERROR: No matching distribution found for matplotlib
```

One fix: install the four packages that already exist as wheels, no index.

| Package | Version | Import check |
|---|---|---|
| igraph | 1.0.0 | ok |
| scikit-learn | 1.9.1 | ok |
| scipy | 1.18.1 | ok |
| polars | 1.44.2 | ok |

These versions are in root `requirements.txt`.

## Not installed

| Package | Target file | What happened |
|---|---|---|
| matplotlib | `requirements-dev.txt` | Metadata for `matplotlib-3.11.2-cp314-cp314-win_amd64` resolved, then PyPI read timed out. Hung pip was killed on request. |
| networkx | `requirements-dev.txt` | `No matching distribution found for networkx` (PyPI index timeout). |

Neither is in `.venv`. Re-run when the network is up:

```bat
.venv\Scripts\pip.exe install --default-timeout=300 matplotlib networkx
```

Then pin the printed versions into `requirements-dev.txt`.

Victim-chain analysis did not need matplotlib or networkx (DuckDB SQL only).
