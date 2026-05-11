from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import api, backup, config, watchdog

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mc-panel")


@contextlib.asynccontextmanager
async def lifespan(_app):
    tasks: list[asyncio.Task] = []
    if not config.DISABLE_BACKGROUND_LOOPS:
        tasks.append(asyncio.create_task(watchdog.loop()))
        tasks.append(asyncio.create_task(backup.loop()))
    else:
        log.info("background loops disabled (MC_DISABLE_BACKGROUND_LOOPS=true)")
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t


app = FastAPI(title="mc-panel-v2", lifespan=lifespan)
app.include_router(api.router)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


# Serve the Vite-built SPA bundle. The Dockerfile copies dist into web_dist;
# in local dev (vite dev server on :5173) this directory may not exist yet,
# so the fallback returns a friendly hint instead of crashing on startup.
WEB_DIST = Path(__file__).parent / "web_dist"
ASSETS_DIR = WEB_DIST / "assets"
INDEX_HTML = WEB_DIST / "index.html"

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


@app.get("/{full_path:path}")
def spa_fallback(full_path: str, request: Request):
    """Serve index.html for any non-API path so client-side routing works.

    Cache-Control: no-cache, must-revalidate on index.html (and any other
    top-level web_dist file) is load-bearing. The Vite build is content-
    addressed — `index.html` references hashed assets like
    `assets/index-abc123.js`, and a stale heuristically-cached index.html
    sends Chrome at long-deleted hashed bundles after a deploy. Hashed
    files under /assets/* (mounted above) are safe to cache aggressively
    because their URL changes every build."""
    if full_path.startswith("api/") or full_path == "healthz":
        raise HTTPException(404)
    headers = {"Cache-Control": "no-cache, must-revalidate"}
    candidate = WEB_DIST / full_path
    if full_path and candidate.is_file() and candidate.resolve().is_relative_to(WEB_DIST.resolve()):
        return FileResponse(candidate, headers=headers)
    if INDEX_HTML.is_file():
        return FileResponse(INDEX_HTML, headers=headers)
    return {
        "error": "SPA bundle not built",
        "hint": "run `npm run build` in web/, or use the Vite dev server on :5173",
    }
