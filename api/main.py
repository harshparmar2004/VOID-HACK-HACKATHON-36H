"""FastAPI app. Start with:

    .venv\\Scripts\\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000

or run.bat. /api/* is the API; every other path serves the built UI (ui\\dist).
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api import middleware, ui
from api.routers import (
    benchmark, cases, deferred, entities, legal, mules, profiles, scanner, status, templates,
    trace, transactions, upload, victims)
from api.services import legal as legal_service

API_PREFIX = "/api"

_log = logging.getLogger("api")
_log.setLevel(logging.INFO)
if not _log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s api %(message)s"))
    _log.addHandler(_handler)



def _warm_model() -> None:
    r = legal_service.diary.warm_model()
    _log.info("diary model %s (%.1f s)", r["status"], r["seconds"])


@asynccontextmanager
async def _lifespan(_: FastAPI):
    # Load the diary model now (legal\\config.yaml: llm), without holding up the start.
    threading.Thread(target=_warm_model, name="warm-model", daemon=True).start()
    yield


app = FastAPI(title="Abhedya-Chakra API", version="0.1.0", lifespan=_lifespan,
              docs_url=f"{API_PREFIX}/docs", openapi_url=f"{API_PREFIX}/openapi.json")
middleware.install(app)

for _router in (status.router, victims.router, mules.router, entities.router, trace.router,
                profiles.router, transactions.router, scanner.router, templates.router,
                benchmark.router, cases.router, legal.router, upload.router, deferred.router):
    app.include_router(_router, prefix=API_PREFIX)
ui.install(app, API_PREFIX)        # last: the API routes match first
