"""FastAPI app. Start with:

    .venv\\Scripts\\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import logging

from fastapi import FastAPI

from api import middleware
from api.routers import entities, mules, profiles, status, trace, transactions, victims

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
                profiles.router, transactions.router):
    app.include_router(_router, prefix=API_PREFIX)
