"""JSON API for the v2 SPA. Mirrors v1's HTTP surface but returns JSON
instead of HTML / HTMX fragments. The underlying business logic (world
filesystem, docker container management, backups) is reused verbatim from
the helper modules — this router is mostly serialization."""
from __future__ import annotations

import asyncio
import logging
import subprocess
import time
from datetime import datetime
from typing import AsyncIterator, Iterator

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import admin_config, backup, config, docker_client as dc, jobs, permissions, players, rcon, usage, world
from .permissions import ADMIN, OPERATOR, USER, current_role, require_role

log = logging.getLogger("mc-panel.api")

router = APIRouter(prefix="/api/v1")


# ---------------------------------------------------------------------------
# Auth — same as v1: trust the Remote-User header set by Authelia
# ---------------------------------------------------------------------------

def remote_user(request: Request) -> str:
    return request.headers.get("Remote-User", "").strip()


def require_user(request: Request) -> str:
    """Read-only access (mc-user, mc-operator, or mc-admin). Endpoints that
    mutate must use `require_role(OPERATOR, request)` or higher instead."""
    return require_role(USER, request)


# ---------------------------------------------------------------------------
# Server-wide policy keys forced on every world.
# RCON keys are load-bearing: backups call save-off/save-all flush via RCON,
# and the Console page sends commands over it. With SKIP_SERVER_PROPERTIES=
# true the itzg env vars (ENABLE_RCON, RCON_PASSWORD) are dead letters —
# the world's server.properties file is the only thing that switches RCON
# on, and vanilla's default is off. Force-write here.
# ---------------------------------------------------------------------------

def _policy_props() -> dict[str, str]:
    return {
        "enforce-whitelist": "true",
        "white-list": "true",
        "pause-when-empty-seconds": "0",
        "enable-rcon": "true",
        "rcon.port": str(config.RCON_PORT),
        "rcon.password": config.RCON_PASSWORD,
        "broadcast-rcon-to-ops": "false",
    }


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def _world_summary(w: world.World) -> dict:
    banner = world.banner_path(w.name)
    banner_url = f"/api/v1/worlds/{w.name}/banner?v={int(banner.stat().st_mtime)}" if banner else None
    return {
        "name": w.name,
        "container_name": w.container_name,
        "port": w.port,
        "status": w.status,
        "awake": w.awake,
        "version": w.version,
        "resolved_version": world.resolved_version(w.name),
        "motd": w.motd,
        "memory_gb": w.memory_gb,
        "banner_url": banner_url,
    }


def _resolve_hostname(request: Request) -> str:
    """Explicit MC_GAME_HOSTNAME / MINECRAFT_HOSTNAME wins; otherwise fall
    back to whatever the user typed into their browser, with a final
    'localhost' default for the edge case of no Host header at all."""
    if config.GAME_HOSTNAME:
        return config.GAME_HOSTNAME
    host = request.headers.get("Host", "").strip()
    if host:
        return host.split(":", 1)[0]
    return "localhost"


def _world_detail(w: world.World, request: Request) -> dict:
    name = w.name
    return {
        **_world_summary(w),
        "properties": world.read_properties(name),
        "whitelist": world.read_name_list(name, "whitelist.json"),
        "ops": world.read_name_list(name, "ops.json"),
        "backups": backup.list_backups(name),
        "retention_days": config.BACKUP_RETENTION_DAYS,
        "game_hostname": _resolve_hostname(request),
    }


def _spawn_job(kind: jobs.JobKind, target: str, fn, *args, **kwargs) -> JSONResponse:
    """Submit a Job and kick off `fn(*args, **kwargs)` in a threadpool.
    Returns 202 with the job id, or 409 if another job for the same target
    is already in flight."""
    try:
        job = jobs.submit(kind, target)
    except jobs.SingleFlightError as e:
        return JSONResponse(
            status_code=409,
            content={
                "detail": f"another {e.existing.kind} on {e.existing.target} is already in flight",
                "job_id": e.existing.id,
            },
        )
    asyncio.create_task(jobs.execute(job.id, fn, *args, **kwargs))
    return JSONResponse(status_code=202, content={"job_id": job.id})


def _host_info(request: Request) -> dict:
    return {
        "game_hostname": _resolve_hostname(request),
        "port_range": [config.PORT_RANGE_START, config.PORT_RANGE_END],
        "default_version": config.DEFAULT_VERSION,
        "default_type": config.DEFAULT_TYPE,
        "awake_count": dc.count_awake_managed(),
        "editable_props": config.EDITABLE_PROPERTIES,
    }


# ---------------------------------------------------------------------------
# Bootstrap — one call powers TopBar host info, LeftRail world list, Home hero
# ---------------------------------------------------------------------------

@router.get("/me")
def me(request: Request) -> dict:
    """Identity + effective role + permission flags. The SPA hides UI for
    things the user can't do; this is the read side of that. The backend
    decorators stay the source of truth — these flags are just convenience.

    Returns 401 with no Remote-User (Authelia misconfig) and 403 if the
    user is authenticated but in none of the panel groups (the "no access"
    wall — show the request-access page on the SPA side)."""
    user = require_user(request)  # 401 / 403 baked in
    role = current_role(request)
    return {
        "user": user,
        "role": role,
        "can": {
            "mutate": role in (OPERATOR, ADMIN),
            "delete_world": role == ADMIN,
            "admin": role == ADMIN,
        },
    }


@router.get("/state")
def state(request: Request) -> dict:
    user = require_user(request)
    return {
        "user": user,
        "worlds": [_world_summary(w) for w in dc.list_worlds()],
        "imports": world.list_imports(),
        "host": _host_info(request),
    }


@router.get("/worlds")
def list_worlds(request: Request) -> list[dict]:
    require_user(request)
    return [_world_summary(w) for w in dc.list_worlds()]


# Mojang publishes the canonical list of vanilla MC versions here. Cache it
# in-process for an hour — the manifest is large-ish (~250 KB), only updates
# when Mojang ships a new version, and we hit it from every page load of
# /worlds/new. Fall back to a minimal stub on transient fetch failures so
# the new-world form is still usable.
_MOJANG_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest.json"
_versions_cache: tuple[float, dict] | None = None
_VERSIONS_TTL = 3600  # seconds


def _fetch_mc_versions() -> dict:
    global _versions_cache
    now = time.monotonic()
    if _versions_cache and now - _versions_cache[0] < _VERSIONS_TTL:
        return _versions_cache[1]
    try:
        r = httpx.get(_MOJANG_MANIFEST_URL, timeout=5)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        log.warning("mojang manifest fetch failed: %s — using cached/stub", e)
        if _versions_cache:
            return _versions_cache[1]
        return {"latest": {"release": "LATEST", "snapshot": "LATEST"}, "versions": []}
    payload = {
        "latest": data.get("latest", {}),
        "versions": [
            {"id": v["id"], "type": v.get("type", "release"), "releaseTime": v.get("releaseTime", "")}
            for v in data.get("versions", [])
        ],
    }
    _versions_cache = (now, payload)
    return payload


@router.get("/mc-versions")
def mc_versions(request: Request) -> dict:
    """Cached vanilla MC version manifest from Mojang. Drives the version
    dropdown on the new-world form."""
    require_user(request)
    return _fetch_mc_versions()


@router.get("/worlds/{name}")
def world_detail(request: Request, name: str) -> dict:
    require_user(request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")
    return _world_detail(w, request)


# --- Banner image (replaces the procedural HeroBand on the world page) ----

# 10 MB cap. Banners are decorative; anything bigger is wrong-sized art.
MAX_BANNER_BYTES = 10 * 1024 * 1024

# Magic bytes for the formats we accept. Don't trust the client-provided
# Content-Type or filename — sniff the first bytes of the upload instead.
def _sniff_image_ext(head: bytes) -> str | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return None


_EXT_CONTENT_TYPE = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


@router.get("/worlds/{name}/banner")
def get_banner(request: Request, name: str) -> Response:
    require_user(request)
    p = world.banner_path(name)
    if p is None:
        raise HTTPException(404, "no banner set")
    return FileResponse(
        p,
        media_type=_EXT_CONTENT_TYPE.get(p.suffix.lower(), "application/octet-stream"),
        # Long-cache by mtime in the URL — clients always include ?v=<mtime>
        # so a new upload bypasses the cache automatically.
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


@router.post("/worlds/{name}/banner")
async def upload_banner(
    request: Request,
    name: str,
    file: UploadFile = File(...),
) -> dict:
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    # Read with a hard cap so a malicious client can't exhaust memory.
    raw = await file.read(MAX_BANNER_BYTES + 1)
    if len(raw) > MAX_BANNER_BYTES:
        raise HTTPException(413, f"banner too large (max {MAX_BANNER_BYTES // (1024 * 1024)} MB)")
    if not raw:
        raise HTTPException(400, "empty file")
    ext = _sniff_image_ext(raw[:32])
    if ext is None:
        raise HTTPException(400, "unsupported image format (use png, jpg, webp, or gif)")
    # save_banner expects a file-like for shutil.copyfileobj; wrap the bytes.
    import io
    p = world.save_banner(name, io.BytesIO(raw), ext)
    log.info("banner uploaded for %s by %s (%s, %d bytes)", name, remote_user(request), ext, len(raw))
    return {"banner_url": f"/api/v1/worlds/{name}/banner?v={int(p.stat().st_mtime)}"}


@router.delete("/worlds/{name}/banner")
def remove_banner(request: Request, name: str) -> dict:
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    deleted = world.delete_banner(name)
    if deleted:
        log.info("banner removed for %s by %s", name, remote_user(request))
    return {"deleted": deleted}


# ---------------------------------------------------------------------------
# Jobs — clients poll this endpoint to track long-lived mutations
# ---------------------------------------------------------------------------

@router.get("/players")
def list_known_players(request: Request) -> list[dict]:
    """Cross-world registry of every player ever whitelisted on this
    panel. Powers the autocomplete on PlayersCard's add input."""
    require_user(request)
    return players.list_known()


@router.get("/jobs")
def list_jobs(request: Request, target: str | None = None) -> list[dict]:
    """Active (queued|running) jobs, optionally filtered by target. The
    SPA polls this per-world so the START/STOP/DELETE buttons can show
    in-flight state even after navigating away and back."""
    require_user(request)
    return [j.to_dict() for j in jobs.list_active(target)]


@router.get("/jobs/{job_id}")
def get_job(request: Request, job_id: str) -> dict:
    require_user(request)
    j = jobs.get(job_id)
    if j is None:
        raise HTTPException(404, "job not found")
    return j.to_dict()


# ---------------------------------------------------------------------------
# World lifecycle: create, start, stop, delete
# ---------------------------------------------------------------------------

class CreateWorldBody(BaseModel):
    name: str
    version: str = ""
    seed: str = ""
    mc_type: str = "VANILLA"
    memory_gb: int | None = None  # None → admin's max (the upper bound is the most generous default)
    properties: dict[str, str] = Field(default_factory=dict)


@router.post("/worlds")
async def create_world(request: Request, body: CreateWorldBody) -> JSONResponse:
    """Validate inputs synchronously (so name conflicts surface immediately
    in the form), then submit the slow image-pull + container-create as a
    job. The job result is the new world's detail dict."""
    user = require_role(OPERATOR, request)
    name = body.name.strip().lower()
    try:
        world.validate_name(name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if dc.get_world(name) is not None:
        raise HTTPException(409, f"world '{name}' already exists")

    # Per-world memory must sit inside the admin-set [min, max] window.
    # Default to max so brand-new worlds get the most-generous setting.
    cfg = admin_config.load()
    memory_gb = body.memory_gb if body.memory_gb is not None else cfg.world_memory_max_gb
    if not cfg.in_bounds(memory_gb):
        raise HTTPException(
            400,
            f"memory_gb {memory_gb} outside admin-set bounds "
            f"[{cfg.world_memory_min_gb}, {cfg.world_memory_max_gb}]",
        )

    world.world_dir(name).mkdir(parents=True, exist_ok=True)

    init_props: dict[str, str] = _policy_props()
    for k, spec in config.EDITABLE_PROPERTIES.items():
        v = body.properties.get(k, "").strip() if isinstance(body.properties.get(k), str) else ""
        init_props[k] = v or spec["default"]
    if not init_props.get("motd"):
        init_props["motd"] = name
    if body.seed:
        init_props["level-seed"] = body.seed
    world.write_properties(name, init_props)

    port = dc.allocate_port()

    def _create():
        dc.create_container(
            name=name,
            port=port,
            version=body.version or config.DEFAULT_VERSION,
            mc_type=body.mc_type or config.DEFAULT_TYPE,
            memory_gb=memory_gb,
        )
        log.info("created world %s on port %s memory=%dG (user=%s)", name, port, memory_gb, user)
        w = dc.get_world(name)
        return _world_detail(w, request) if w else {"name": name, "port": port}

    return _spawn_job("create", name, _create)


@router.post("/worlds/{name}/start")
async def start_world(request: Request, name: str) -> JSONResponse:
    user = require_role(OPERATOR, request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")

    # Hard cap on concurrent running worlds. Skip the check if the world
    # is already running (clicking START on something already up should
    # be idempotent, not a 409). Upgrade and resize bypass this endpoint
    # and call dc.start_container directly — they replace one running
    # instance with another, not adding a new one, so the count is
    # preserved across the recreate.
    if not w.awake:
        cfg = admin_config.load()
        running = dc.count_awake_managed()
        if running >= cfg.max_concurrent_worlds:
            raise HTTPException(
                409,
                f"concurrent-worlds limit reached ({running}/{cfg.max_concurrent_worlds}) — "
                f"stop another world first",
            )

    def _start():
        # Re-apply policy props on every start so a world that pre-dates a
        # policy change (e.g. enable-rcon) heals itself on next launch
        # without requiring manual server.properties edits. write_properties
        # is a key-merge, not a rewrite, so user-set keys are untouched.
        world.write_properties(name, _policy_props())
        dc.start_container(name)
        log.info("start %s by %s", name, user)
        return {"ok": True}

    return _spawn_job("start", name, _start)


@router.post("/worlds/{name}/stop")
async def stop_world(request: Request, name: str) -> JSONResponse:
    user = require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")

    def _stop():
        dc.stop_container(name)
        log.info("stop %s by %s", name, user)
        return {"ok": True}

    return _spawn_job("stop", name, _stop)


class UpgradeBody(BaseModel):
    version: str = "LATEST"


@router.post("/worlds/{name}/upgrade")
async def upgrade_world(request: Request, name: str, body: UpgradeBody) -> JSONResponse:
    """Recreate the world container with VERSION env bumped to the
    requested target (default LATEST). itzg's image fetches the matching
    server jar on next startup. Existing world data + properties +
    whitelist + backups all survive (bind-mounted). If the world was
    running, restart it after the rebuild so the upgrade is one click."""
    user = require_role(OPERATOR, request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")
    was_running = w.awake

    def _upgrade():
        dc.recreate_container(name, version=body.version)
        if was_running:
            dc.start_container(name)
        log.info("upgraded world %s to %s by %s", name, body.version, user)
        return {"version": body.version, "restarted": was_running}

    return _spawn_job("upgrade", name, _upgrade)


class WorldMemoryBody(BaseModel):
    memory_gb: int


@router.patch("/worlds/{name}/memory")
async def set_world_memory(request: Request, name: str, body: WorldMemoryBody) -> JSONResponse:
    """Recreate the world container with a new MEMORY env. Same flow as
    upgrade: stop → remove → create with the new value → start if it was
    running. World data + properties survive the rebuild (bind-mounted).
    The new value must be inside the admin-set [min, max] window."""
    user = require_role(OPERATOR, request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")
    cfg = admin_config.load()
    if not cfg.in_bounds(body.memory_gb):
        raise HTTPException(
            400,
            f"memory_gb {body.memory_gb} outside admin-set bounds "
            f"[{cfg.world_memory_min_gb}, {cfg.world_memory_max_gb}]",
        )
    if body.memory_gb == w.memory_gb:
        return JSONResponse(status_code=200, content={"memory_gb": body.memory_gb, "restarted": False, "noop": True})
    was_running = w.awake

    def _resize():
        dc.recreate_container(name, memory_gb=body.memory_gb)
        if was_running:
            dc.start_container(name)
        log.info("resized world %s memory %dG -> %dG by %s", name, w.memory_gb, body.memory_gb, user)
        return {"memory_gb": body.memory_gb, "restarted": was_running}

    # Reuse the upgrade job kind — same blocking semantics (stop+recreate+start)
    # so the SPA's busy spinner already covers it.
    return _spawn_job("upgrade", name, _resize)


# --- Admin config: panel-wide knobs only mc-admins can touch -------------

def _admin_config_dict(cfg: admin_config.AdminConfig) -> dict:
    return {
        "world_memory_min_gb": cfg.world_memory_min_gb,
        "world_memory_max_gb": cfg.world_memory_max_gb,
        "memory_gb_floor": admin_config.MIN_GB_FLOOR,
        "memory_gb_ceiling": admin_config.MAX_GB_CEILING,
        "max_concurrent_worlds": cfg.max_concurrent_worlds,
        "max_concurrent_worlds_ceiling": admin_config.MAX_CONCURRENT_WORLDS_CEILING,
    }


@router.get("/admin/config")
def get_admin_config(request: Request) -> dict:
    """Read the admin config. Available to any panel user (operators need
    to know the bounds when filling out the new-world / edit-memory
    forms); writes require admin."""
    require_role(USER, request)
    return _admin_config_dict(admin_config.load())


class AdminConfigBody(BaseModel):
    world_memory_min_gb: int
    world_memory_max_gb: int
    max_concurrent_worlds: int


@router.patch("/admin/config")
def update_admin_config(request: Request, body: AdminConfigBody) -> dict:
    user = require_role(ADMIN, request)
    cfg = admin_config.AdminConfig(
        world_memory_min_gb=body.world_memory_min_gb,
        world_memory_max_gb=body.world_memory_max_gb,
        max_concurrent_worlds=body.max_concurrent_worlds,
    )
    try:
        admin_config.save(cfg)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log.info(
        "admin-config updated by %s: memory [%d, %d] GB, concurrent=%d",
        user, cfg.world_memory_min_gb, cfg.world_memory_max_gb, cfg.max_concurrent_worlds,
    )
    return _admin_config_dict(cfg)


class DeleteWorldBody(BaseModel):
    confirm: str


@router.post("/worlds/{name}/delete")
async def delete_world(request: Request, name: str, body: DeleteWorldBody) -> JSONResponse:
    user = require_role(ADMIN, request)
    if body.confirm != name:
        raise HTTPException(400, "confirmation mismatch")

    def _delete():
        dc.remove_container(name)
        if world.world_dir(name).exists():
            world.archive_world(name)
        log.warning("deleted world %s by %s", name, user)
        return {"ok": True}

    return _spawn_job("delete", name, _delete)


# ---------------------------------------------------------------------------
# server.properties
# ---------------------------------------------------------------------------

class PropertiesBody(BaseModel):
    properties: dict[str, str]


@router.patch("/worlds/{name}/properties")
def save_properties(request: Request, name: str, body: PropertiesBody) -> dict:
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    edits = {k: str(v) for k, v in body.properties.items() if k in config.EDITABLE_PROPERTIES}
    world.write_properties(name, edits)
    return {"properties": world.read_properties(name)}


# ---------------------------------------------------------------------------
# Whitelist + ops. Ops is a toggle on top of the whitelist (UUID copied from
# the whitelist entry — no Mojang re-lookup).
# ---------------------------------------------------------------------------

class PlayerBody(BaseModel):
    player: str


@router.post("/worlds/{name}/whitelist")
def whitelist_add(request: Request, name: str, body: PlayerBody) -> dict:
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    ok, msg = world.add_player(name, "whitelist", body.player)
    if not ok:
        raise HTTPException(400, msg)
    return {
        "message": msg,
        "whitelist": world.read_name_list(name, "whitelist.json"),
        "ops": world.read_name_list(name, "ops.json"),
    }


@router.delete("/worlds/{name}/whitelist/{player}")
def whitelist_remove(request: Request, name: str, player: str) -> dict:
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    ok, msg = world.remove_player(name, "whitelist", player)
    if not ok:
        raise HTTPException(404, msg)
    return {
        "message": msg,
        "whitelist": world.read_name_list(name, "whitelist.json"),
        "ops": world.read_name_list(name, "ops.json"),
    }


class OpToggleBody(BaseModel):
    player: str
    op: bool


@router.post("/worlds/{name}/ops/toggle")
def ops_toggle(request: Request, name: str, body: OpToggleBody) -> dict:
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    ok, msg = world.set_op(name, body.player, body.op)
    if not ok:
        raise HTTPException(400, msg)
    return {
        "message": msg,
        "ops": world.read_name_list(name, "ops.json"),
    }


# ---------------------------------------------------------------------------
# Backups
# ---------------------------------------------------------------------------

class RunBackupBody(BaseModel):
    """Optional fields when triggering a backup. All-defaults = a routine
    auto-named non-permanent snapshot, same as before this feature
    landed."""
    display_name: str = ""
    description: str = ""
    permanent: bool = False


@router.post("/worlds/{name}/backups")
async def run_backup_now(request: Request, name: str, body: RunBackupBody | None = None) -> JSONResponse:
    user = require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    b = body or RunBackupBody()

    def _backup():
        backup.backup_world(
            name,
            display_name=b.display_name.strip(),
            description=b.description.strip(),
            permanent=b.permanent,
            created_by=user,
        )
        log.info(
            "ad-hoc backup of %s by %s%s",
            name, user, " [permanent]" if b.permanent else "",
        )
        return {"backups": backup.list_backups(name)}

    return _spawn_job("backup", name, _backup)


class UpdateBackupBody(BaseModel):
    """All fields optional — only the ones present in the request body
    are written. Empty strings are valid (clear the field)."""
    display_name: str | None = None
    description: str | None = None
    permanent: bool | None = None


@router.patch("/backups/{world}/{filename}")
def update_backup(request: Request, world: str, filename: str, body: UpdateBackupBody) -> dict:
    """Edit an existing backup's metadata: rename, change description, or
    flip the permanent flag. Operator+ — same tier as creating one."""
    user = require_role(OPERATOR, request)
    if backup.backup_path(world, filename) is None:
        raise HTTPException(404, "backup not found")
    fields: dict = {}
    if body.display_name is not None:
        fields["display_name"] = body.display_name
    if body.description is not None:
        fields["description"] = body.description
    if body.permanent is not None:
        fields["permanent"] = body.permanent
    meta = backup.write_metadata(world, filename, **fields)
    log.info("updated backup metadata %s/%s by %s: %s", world, filename, user, fields)
    return meta


@router.get("/backups")
def list_all_backups(request: Request) -> list[dict]:
    """Cross-world index. Powers the /backups SPA page. Worlds with no
    backups are simply skipped — the response only contains files that
    actually exist on disk."""
    require_user(request)
    out: list[dict] = []
    for w in dc.list_worlds():
        for entry in backup.list_backups(w.name):
            stamp = (config.BACKUPS_DIR / w.name / entry["name"]).stat().st_mtime
            out.append({
                "id": f"{w.name}/{entry['name']}",
                "world": w.name,
                "filename": entry["name"],
                "size": entry["size"],
                "size_human": entry["size_human"],
                "created_at": stamp,
                "display_name": entry.get("display_name", ""),
                "description": entry.get("description", ""),
                "permanent": entry.get("permanent", False),
                "world_version": entry.get("world_version"),
                "created_by": entry.get("created_by"),
            })
    out.sort(key=lambda e: e["created_at"], reverse=True)
    return out


@router.delete("/backups/{world}/{filename}")
def delete_backup(request: Request, world: str, filename: str) -> dict:
    # Backup deletion is permanent (no recycle bin) and applies to pinned
    # snapshots too, so it sits at the same admin tier as world deletion.
    # Operators can still create + pin + edit + restore; only erasing is
    # admin-only.
    user = require_role(ADMIN, request)
    p = backup.backup_path(world, filename)
    if p is None:
        raise HTTPException(404, "backup not found")
    p.unlink()
    # Drop the sidecar too — orphaned .meta.json files would just be
    # noise on the next listing.
    meta = p.with_name(p.name + ".meta.json")
    if meta.exists():
        meta.unlink()
    log.warning("deleted backup %s/%s by %s", world, filename, user)
    return {"ok": True}


class RestoreBody(BaseModel):
    filename: str = Field(..., min_length=5, max_length=128)


@router.post("/worlds/{name}/restore")
async def restore_world(request: Request, name: str, body: RestoreBody) -> JSONResponse:
    user = require_role(OPERATOR, request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")
    if w.awake:
        raise HTTPException(409, "stop the world before restoring")
    src_zip = backup.backup_path(name, body.filename)
    if src_zip is None:
        raise HTTPException(404, "backup not found")

    def _restore():
        wd = world.world_dir(name)
        # Archive the current world dir (matches the delete flow) so a bad
        # restore is recoverable. archive_world() requires the dir to exist;
        # if a previous run nuked it, just start fresh.
        if wd.exists():
            world.archive_world(name)
        wd.mkdir(parents=True)
        subprocess.run(
            ["unzip", "-q", str(src_zip), "-d", str(wd)],
            check=True,
        )
        # Re-apply policy keys — the imported zip may carry old ones (e.g.
        # an enable-rcon=false from a pre-policy backup).
        world.write_properties(name, _policy_props())
        log.warning("restored world %s from %s by %s", name, body.filename, user)
        return {"ok": True, "world": name, "filename": body.filename}

    return _spawn_job("restore", name, _restore)


@router.get("/worlds/{name}/backups/{filename}")
def download_backup(request: Request, name: str, filename: str):
    require_user(request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    p = backup.backup_path(name, filename)
    if p is None:
        raise HTTPException(404, "backup not found")

    def chunks():
        with p.open("rb") as f:
            while True:
                buf = f.read(65536)
                if not buf:
                    break
                yield buf

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}-{filename}"'},
    )


# ---------------------------------------------------------------------------
# Export world (.zip stream) — only allowed when the world is sleeping
# ---------------------------------------------------------------------------

@router.get("/worlds/{name}/export")
def download_world(request: Request, name: str):
    require_user(request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")
    if w.awake:
        raise HTTPException(
            409,
            "Stop the server first; downloading a running world risks an inconsistent archive.",
        )
    src = world.world_dir(name)
    if not src.is_dir():
        raise HTTPException(404, "world data not found on disk")

    proc = subprocess.Popen(
        ["zip", "-rq", "-", "."],
        cwd=str(src),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    def chunks() -> Iterator[bytes]:
        try:
            assert proc.stdout is not None
            while True:
                buf = proc.stdout.read(65536)
                if not buf:
                    break
                yield buf
        finally:
            if proc.stdout is not None:
                proc.stdout.close()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    log.info("download world %s by %s", name, remote_user(request))
    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'},
    )


# ---------------------------------------------------------------------------
# Live console (SSE)
# ---------------------------------------------------------------------------

@router.get("/worlds/{name}/console")
async def world_console(request: Request, name: str):
    require_role(OPERATOR, request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")

    async def gen() -> AsyncIterator[bytes]:
        loop_ = asyncio.get_running_loop()
        try:
            stream = await loop_.run_in_executor(None, dc.stream_logs, name, 500)
        except Exception as e:  # noqa: BLE001
            yield f"event: error\ndata: {e}\n\n".encode()
            return
        # docker's logs iterator yields arbitrary byte chunks — sometimes a
        # full line, sometimes a single byte. Buffer until we see a newline
        # so each SSE event is one logical line.
        buf = bytearray()
        try:
            while True:
                chunk = await loop_.run_in_executor(None, next, stream, None)
                if chunk is None:
                    break
                buf.extend(chunk)
                while True:
                    nl = buf.find(b"\n")
                    if nl < 0:
                        break
                    line = bytes(buf[:nl]).decode("utf-8", errors="replace").rstrip("\r")
                    del buf[: nl + 1]
                    if line:
                        yield f"data: {line}\n\n".encode()
            if buf:
                tail = bytes(buf).decode("utf-8", errors="replace").rstrip("\r\n")
                if tail:
                    yield f"data: {tail}\n\n".encode()
        finally:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Usage — joins / leaves over time, parsed on demand from the world's MC
# log files. No background scraper; the parser walks the rotated logs at
# request time and tops them off with latest.log for today.
# ---------------------------------------------------------------------------

@router.get("/worlds/{name}/usage")
def world_usage(request: Request, name: str, since: str, until: str) -> dict:
    require_user(request)
    if dc.get_world(name) is None:
        raise HTTPException(404, "world not found")
    try:
        since_dt = datetime.fromisoformat(since)
        until_dt = datetime.fromisoformat(until)
    except ValueError:
        raise HTTPException(400, "since/until must be ISO 8601 timestamps")
    if until_dt <= since_dt:
        raise HTTPException(400, "until must be strictly after since")
    if (until_dt - since_dt).total_seconds() > 30 * 86400:
        raise HTTPException(400, "window too large (max 30 days)")
    return usage.collect_events(name, since_dt, until_dt)


# ---------------------------------------------------------------------------
# RCON command pass-through. Single-shot — the live log goes through the
# /console SSE stream above. Reuses the same connection layer the backup
# engine uses to flush in-memory writes.
# ---------------------------------------------------------------------------

class RconCommandBody(BaseModel):
    cmd: str = Field(..., min_length=1, max_length=512)


@router.post("/worlds/{name}/rcon")
def rcon_command(request: Request, name: str, body: RconCommandBody) -> dict:
    user = require_role(OPERATOR, request)
    w = dc.get_world(name)
    if w is None:
        raise HTTPException(404, "world not found")
    if not w.awake:
        raise HTTPException(409, "world is not running")
    cmd = body.cmd.strip()
    if not cmd:
        raise HTTPException(400, "cmd is empty")
    try:
        with rcon.Rcon(w.container_name, config.RCON_PORT, config.RCON_PASSWORD) as r:
            output = r.command(cmd)
    except rcon.RconError as e:
        raise HTTPException(502, f"rcon error: {e}")
    except OSError as e:
        raise HTTPException(502, f"rcon connection failed: {e}")
    log.info("rcon %s on %s by %s", cmd[:80], name, user)
    return {"output": output}


# ---------------------------------------------------------------------------
# Imports — staged before commit so the user can review detected metadata
# ---------------------------------------------------------------------------

@router.get("/imports")
def list_imports(request: Request) -> list[str]:
    require_user(request)
    return world.list_imports()


def _staging_response(staging_id: str, staging_dir) -> dict:
    metadata = world.peek_metadata(staging_dir)
    return {
        "staging_id": staging_id,
        "metadata": metadata,
        "default_type": metadata.get("server_type_guess", config.DEFAULT_TYPE),
        "default_version": metadata.get("mc_version") or config.DEFAULT_VERSION,
    }


@router.post("/imports/upload")
async def import_upload(
    request: Request,
    world_zip: UploadFile = File(...),
) -> dict:
    require_role(OPERATOR, request)
    if not world_zip.filename:
        raise HTTPException(400, "no file uploaded")
    try:
        staging_id, staging_dir = world.stage_zip(world_zip.file)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log.info("import staged from upload: %s by %s", staging_id, remote_user(request))
    return _staging_response(staging_id, staging_dir)


class ImportFromBody(BaseModel):
    source: str


@router.post("/imports/from")
async def import_from(request: Request, body: ImportFromBody) -> dict:
    require_role(OPERATOR, request)
    try:
        staging_id, staging_dir = world.stage_imports(body.source)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log.info("import staged from imports/%s: %s by %s", body.source, staging_id, remote_user(request))
    return _staging_response(staging_id, staging_dir)


@router.get("/imports/{staging_id}")
def get_staging(request: Request, staging_id: str) -> dict:
    """Re-read a staging dir's metadata. Lets the SPA reconstruct the
    import-confirm page after a navigation away (the upload mutation's
    result lives only in TanStack Query memory and is lost on refresh
    or hard nav)."""
    require_user(request)
    staging_dir = config.STAGING_DIR / staging_id
    if not staging_dir.is_dir() or staging_dir.resolve().parent != config.STAGING_DIR.resolve():
        raise HTTPException(404, "staging not found")
    return _staging_response(staging_id, staging_dir)


@router.delete("/imports/{staging_id}")
def import_cancel(request: Request, staging_id: str) -> dict:
    require_role(OPERATOR, request)
    world.discard_staging(staging_id)
    return {"ok": True}


class ImportCommitBody(BaseModel):
    name: str
    mc_type: str = "VANILLA"
    version: str = ""


@router.post("/imports/{staging_id}/commit")
async def import_commit(request: Request, staging_id: str, body: ImportCommitBody) -> JSONResponse:
    """Validate + move staging dir into worlds/ synchronously (so naming
    conflicts surface in the form), then submit the slow image-pull +
    container-create as a job."""
    user = require_role(OPERATOR, request)
    name = body.name.strip().lower()
    try:
        world.validate_name(name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if dc.get_world(name) is not None:
        world.discard_staging(staging_id)
        raise HTTPException(409, f"world '{name}' already exists")
    # Capture level.dat-derived defaults BEFORE the staging dir is moved.
    # Used below to seed server.properties for singleplayer saves that
    # carry no server.properties of their own.
    staging_dir = config.STAGING_DIR / staging_id
    metadata = world.peek_metadata(staging_dir) if staging_dir.is_dir() else {}
    try:
        world.commit_import(staging_id, name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Layer into server.properties:
    #   1. level.dat defaults (difficulty / gamemode / hardcore / motd) — but
    #      ONLY for keys not already present, so server-backup imports keep
    #      their authoritative values
    #   2. policy keys — always overwrite (whitelist, rcon, pause-when-empty)
    existing = world.read_properties(name)
    derived = world.level_dat_property_defaults(metadata)
    new_keys = {k: v for k, v in derived.items() if k not in existing}
    if new_keys:
        world.write_properties(name, new_keys)
    world.write_properties(name, _policy_props())
    port = dc.allocate_port()

    def _import():
        dc.create_container(
            name=name,
            port=port,
            version=body.version.strip() or config.DEFAULT_VERSION,
            mc_type=body.mc_type or config.DEFAULT_TYPE,
        )
        log.info("imported world %s on port %s (user=%s)", name, port, user)
        w = dc.get_world(name)
        return _world_detail(w, request) if w else {"name": name, "port": port}

    return _spawn_job("create", name, _import)
