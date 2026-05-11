"""Cross-world registry of player accounts that have been successfully
whitelisted at least once. Powers the autocomplete on PlayersCard so the
admin doesn't have to retype names that are already known to the panel.

Stored as a single JSON file under MC_DATA_ROOT. On first read we
backfill from every world's whitelist.json so existing deployments get a
populated registry without manual intervention."""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

from . import config

log = logging.getLogger("mc-panel.players")

KNOWN_PLAYERS_FILE = config.DATA_ROOT / "known_players.json"

# File-level lock so concurrent whitelist adds (e.g. two browser tabs)
# don't race on the read-modify-write of the registry.
_lock = threading.Lock()


def _read() -> list[dict[str, Any]]:
    if not KNOWN_PLAYERS_FILE.exists():
        return []
    try:
        data = json.loads(KNOWN_PLAYERS_FILE.read_text())
    except json.JSONDecodeError:
        log.warning("known_players.json malformed; resetting")
        return []
    return [e for e in data if isinstance(e, dict) and "uuid" in e and "name" in e]


def _write(entries: list[dict[str, Any]]) -> None:
    KNOWN_PLAYERS_FILE.write_text(json.dumps(entries, indent=2))


def _backfill() -> list[dict[str, Any]]:
    """Walk every world's whitelist.json and aggregate into a single
    deduplicated list. Called once if known_players.json is missing."""
    seen: dict[str, dict[str, Any]] = {}
    if config.WORLDS_DIR.exists():
        for world_dir in config.WORLDS_DIR.iterdir():
            wl = world_dir / "whitelist.json"
            if not wl.is_file():
                continue
            try:
                data = json.loads(wl.read_text())
            except Exception:  # noqa: BLE001
                continue
            for e in data:
                if isinstance(e, dict) and e.get("uuid") and e.get("name"):
                    seen[e["uuid"]] = {"uuid": e["uuid"], "name": e["name"]}
    out = sorted(seen.values(), key=lambda e: e["name"].lower())
    _write(out)
    log.info("known_players.json backfilled with %d entries", len(out))
    return out


def list_known() -> list[dict[str, Any]]:
    """Return all known players, sorted by name (case-insensitive). On
    first call after a fresh deploy this also performs the backfill."""
    with _lock:
        if not KNOWN_PLAYERS_FILE.exists():
            return _backfill()
        return _read()


def remember(uuid: str, name: str) -> None:
    """Record a player as known. Updates the stored name if the same
    UUID returns with a different name (Mojang allows renames)."""
    with _lock:
        entries = _read() if KNOWN_PLAYERS_FILE.exists() else _backfill()
        for e in entries:
            if e["uuid"] == uuid:
                if e["name"] != name:
                    e["name"] = name
                    entries.sort(key=lambda x: x["name"].lower())
                    _write(entries)
                return
        entries.append({"uuid": uuid, "name": name})
        entries.sort(key=lambda e: e["name"].lower())
        _write(entries)
