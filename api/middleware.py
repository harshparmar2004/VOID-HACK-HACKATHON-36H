"""CORS, request timing (header + log line) and clean JSON errors."""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("api")

# The Vite dev server, under either name of the local machine.
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
TIMING_HEADER = "X-Process-Time-Ms"


def _error(status: int, message: str, path: str, errors: list | None = None) -> JSONResponse:
    body = {"detail": message, "status": status, "path": path}
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(body, status_code=status)


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        return _error(exc.status_code, str(exc.detail), request.url.path)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]}
                  for e in exc.errors()]
        return _error(422, "Invalid request parameters", request.url.path, errors)

    @app.middleware("http")
    async def timing(request: Request, call_next):
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # Caught here (not in an exception handler) so the 500 still gets
            # the timing header and the CORS headers of the outer middleware.
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            response = _error(500, "Internal server error", request.url.path)
        ms = (time.perf_counter() - t0) * 1000.0
        response.headers[TIMING_HEADER] = f"{ms:.1f}"
        log.info("%s %s -> %d in %.1f ms", request.method, request.url.path,
                 response.status_code, ms)
        return response

    # Added last so it is the outermost layer and also covers error responses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[TIMING_HEADER, "X-Content-SHA256"],
    )
