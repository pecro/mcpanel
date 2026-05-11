"""Nightly + ad-hoc world backups. Uses RCON to flush in-memory writes
before snapshotting a running world; falls back to a non-flushed zip if
RCON is unreachable (e.g., a world container created before RCON was
wired in).

Each backup has a sidecar `.meta.json` next to its zip with optional
display name, description, and a `permanent` flag that exempts it from
the retention sweep. The world's resolved MC version is captured at
backup time so users can see what version a snapshot was taken on."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import config, docker_client as dc, rcon, world as world_mod

log = logging.getLogger("mc-panel.backup")

# Per-world lock so the daily scheduler and an ad-hoc "Run backup now"
# can't collide on the same world. Cheap.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(name: str) -> threading.Lock:
    with _locks_guard:
        lk = _locks.get(name)
        if lk is None:
            lk = threading.Lock()
            _locks[name] = lk
        return lk


def _meta_path(zip_path: Path) -> Path:
    """Sidecar JSON path for a backup zip: foo.zip -> foo.zip.meta.json."""
    return zip_path.with_name(zip_path.name + ".meta.json")


def read_metadata(world: str, filename: str) -> dict:
    """Read the sidecar metadata for a backup. Returns defaults for
    backups that pre-date this feature (no sidecar yet)."""
    zp = config.BACKUPS_DIR / world / filename
    if not zp.is_file():
        return {}
    mp = _meta_path(zp)
    base = {
        "display_name": "",
        "description": "",
        "permanent": False,
        "world_version": None,
        "created_by": None,
        "created_at_ms": int(zp.stat().st_mtime * 1000),
    }
    if mp.is_file():
        try:
            data = json.loads(mp.read_text())
            for k in ("display_name", "description"):
                if isinstance(data.get(k), str):
                    base[k] = data[k]
            if isinstance(data.get("permanent"), bool):
                base["permanent"] = data["permanent"]
            for k in ("world_version", "created_by"):
                if isinstance(data.get(k), str):
                    base[k] = data[k]
            if isinstance(data.get("created_at_ms"), int):
                base["created_at_ms"] = data["created_at_ms"]
        except Exception as e:  # noqa: BLE001
            log.warning("backup metadata unreadable for %s/%s: %s", world, filename, e)
    return base


def write_metadata(world: str, filename: str, **fields) -> dict:
    """Atomic write of the sidecar metadata. Pass only the fields you want
    to change; existing values for the rest are preserved."""
    zp = config.BACKUPS_DIR / world / filename
    if not zp.is_file():
        raise FileNotFoundError(f"backup not found: {world}/{filename}")
    current = read_metadata(world, filename)
    for k, v in fields.items():
        if v is not None:
            current[k] = v
    mp = _meta_path(zp)
    fd, tmp = tempfile.mkstemp(dir=str(mp.parent), prefix=".meta.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(current, f, indent=2)
        os.replace(tmp, mp)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return current


def list_backups(name: str) -> list[dict]:
    d = config.BACKUPS_DIR / name
    if not d.is_dir():
        return []
    out: list[dict] = []
    for p in sorted(d.iterdir(), reverse=True):
        if p.is_file() and p.suffix == ".zip":
            sz = p.stat().st_size
            meta = read_metadata(name, p.name)
            out.append({
                "name": p.name,
                "size": sz,
                "size_human": _human(sz),
                **meta,
            })
    return out


def backup_path(name: str, filename: str) -> Path | None:
    """Resolve and validate a path to a specific backup file. Returns None
    if the request escapes the backups directory or the file is missing."""
    base = (config.BACKUPS_DIR / name).resolve()
    target = (base / filename).resolve()
    if not target.is_file() or base != target.parent:
        return None
    return target


def backup_world(
    name: str,
    *,
    display_name: str = "",
    description: str = "",
    permanent: bool = False,
    created_by: str | None = None,
) -> Path:
    """Create one backup zip for the named world. Synchronous — call from
    a threadpool. Returns the destination path. The world's resolved MC
    version is captured into the sidecar metadata so the UI can show
    'taken on 1.21.5' regardless of any later upgrade."""
    src = config.WORLDS_DIR / name
    if not src.is_dir():
        raise FileNotFoundError(f"world dir missing: {src}")
    dst_dir = config.BACKUPS_DIR / name
    dst_dir.mkdir(parents=True, exist_ok=True)
    # Per-second filename so multiple same-day backups don't clobber.
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dst = dst_dir / f"{stamp}.zip"

    with _lock_for(name):
        w = dc.get_world(name)
        if w and w.awake:
            # Reach RCON over the docker network using the container name —
            # works on any user-defined bridge network. Replaces the
            # static-IP allocator that lazymc required.
            ip = w.container_name
            try:
                with rcon.Rcon(ip, config.RCON_PORT, config.RCON_PASSWORD) as r:
                    r.command("save-off")
                    r.command("save-all flush")
                try:
                    _zip_dir(src, dst)
                finally:
                    try:
                        with rcon.Rcon(ip, config.RCON_PORT, config.RCON_PASSWORD) as r:
                            r.command("save-on")
                    except Exception as e:  # noqa: BLE001
                        log.warning("save-on failed for %s: %s", name, e)
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "rcon flush failed for %s, falling back to non-flushed zip: %s",
                    name, e,
                )
                _zip_dir(src, dst)
        else:
            _zip_dir(src, dst)

        _prune_old(dst_dir, config.BACKUP_RETENTION_DAYS)

    # Capture metadata after the zip lands. world_version is read from
    # level.dat, which Minecraft writes on save — so an awake world's
    # metadata will reflect what's actually running, not just the
    # container env.
    write_metadata(
        name,
        dst.name,
        display_name=display_name or stamp,
        description=description,
        permanent=permanent,
        world_version=world_mod.resolved_version(name),
        created_by=created_by,
        created_at_ms=int(dst.stat().st_mtime * 1000),
    )
    log.info(
        "backup %s -> %s (%s)%s",
        name, dst.name, _human(dst.stat().st_size),
        " [permanent]" if permanent else "",
    )
    return dst


def backup_all() -> None:
    for w in dc.list_worlds():
        try:
            backup_world(w.name)
        except Exception:  # noqa: BLE001
            log.exception("backup failed for %s", w.name)


def _zip_dir(src: Path, dst: Path) -> None:
    subprocess.run(
        ["zip", "-rq", str(dst), "."],
        cwd=str(src),
        check=True,
    )


def _prune_old(dir_: Path, days: int) -> None:
    if days <= 0:
        return
    cutoff = time.time() - days * 86400
    world = dir_.name
    for f in dir_.iterdir():
        if not (f.is_file() and f.suffix == ".zip" and f.stat().st_mtime < cutoff):
            continue
        # Permanent backups are pruning-exempt — they're the whole point
        # of this feature. User has to delete them explicitly.
        meta = read_metadata(world, f.name)
        if meta.get("permanent"):
            continue
        try:
            f.unlink()
            mp = _meta_path(f)
            if mp.exists():
                mp.unlink()
            log.info("pruned old backup %s", f)
        except OSError as e:
            log.warning("could not prune %s: %s", f, e)


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} TB"  # type: ignore[unreachable]


async def loop() -> None:
    """Sleep until next BACKUP_HOUR, then run all-worlds backup. Repeat."""
    log.info("backup scheduler started; runs daily at %02d:00", config.BACKUP_HOUR)
    while True:
        now = datetime.now()
        next_run = now.replace(
            hour=config.BACKUP_HOUR, minute=0, second=0, microsecond=0
        )
        if next_run <= now:
            next_run += timedelta(days=1)
        wait_secs = (next_run - now).total_seconds()
        log.info("next backup at %s (%.0fs)", next_run.isoformat(timespec="seconds"), wait_secs)
        await asyncio.sleep(wait_secs)
        try:
            await asyncio.get_running_loop().run_in_executor(None, backup_all)
        except Exception:  # noqa: BLE001
            log.exception("backup_all crashed")
