"""The built UI (ui\\dist) on the API's own port: every path outside /api
serves a built file, or index.html for the UI's client-side routes."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

UI_DIST = Path(__file__).resolve().parents[1] / "ui" / "dist"
INDEX = UI_DIST / "index.html"


def install(app: FastAPI, api_prefix: str) -> None:
    """Add the UI routes. Call after the API routers so they match first.
    Without a build (no ui\\dist\\index.html) the app stays API-only."""
    if not INDEX.is_file():
        return
    api_root = api_prefix.strip("/")

    @app.get("/{path:path}", include_in_schema=False)
    def ui(path: str):
        if path == api_root or path.startswith(api_root + "/"):
            raise HTTPException(404, "Not Found")          # unknown API path: JSON, not the UI
        target = (UI_DIST / path).resolve()
        if target.is_file() and target.is_relative_to(UI_DIST):
            return FileResponse(target)
        # index.html names hashed assets: never serve a cached copy of it.
        return FileResponse(INDEX, headers={"Cache-Control": "no-cache"})
