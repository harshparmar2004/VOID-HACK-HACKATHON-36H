"""FastAPI app. Start with:

    .venv\\Scripts\\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000

or run.bat. /api/* is the API; every other path serves the built UI (ui\\dist).
"""
from __future__ import annotations

import logging

from fastapi import FastAPI

from api import middleware, ui
from api.routers import (
    benchmark, cases, deferred, entities, legal, mules, profiles, scanner, status, templates,
    trace, transactions, victims)

API_PREFIX = "/api"

_log = logging.getLogger("api")
_log.setLevel(logging.INFO)
if not _log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s api %(message)s"))
    _log.addHandler(_handler)

app = FastAPI(title="Abhedya-Chakra API", version="0.1.0",
              docs_url=f"{API_PREFIX}/docs", openapi_url=f"{API_PREFIX}/openapi.json")
middleware.install(app)

for _router in (status.router, victims.router, mules.router, entities.router, trace.router,
                profiles.router, transactions.router, scanner.router, templates.router,
                benchmark.router, cases.router, legal.router, deferred.router):
    app.include_router(_router, prefix=API_PREFIX)
ui.install(app, API_PREFIX)        # last: the API routes match first
