"""Endpoints the UI calls that we do not serve (API_CONTRACT.md).

DEFERRED / LATER: 501 until their own step. DROP: 410 Gone, never coming back
in this form. None of them reads the request body or the database.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["deferred"])

NOT_YET = "not yet available"

DEFERRED = [                                   # 501
    ("GET", "/vault/certificate/{artifact_id}"),
]

DROPPED = [                                    # 410, with what to use instead
    ("POST", "/victim/load-demo/{demo_id}", "removed: pick a victim from GET /api/victims"),
    ("POST", "/ingest-url", "removed: the system works offline"),
    ("GET", "/settings", "removed: no cloud settings"),
    ("POST", "/settings", "removed: no cloud settings"),
    ("POST", "/settings/test-connection", "removed: no cloud settings"),
    ("POST", "/assistant/chat", "removed: no cloud assistant"),
]


def _refuse(status: int, detail: str):
    def endpoint():
        raise HTTPException(status, detail)
    return endpoint


for _method, _path in DEFERRED:
    router.add_api_route(_path, _refuse(501, NOT_YET), methods=[_method], status_code=501)
for _method, _path, _detail in DROPPED:
    router.add_api_route(_path, _refuse(410, _detail), methods=[_method], status_code=410)
