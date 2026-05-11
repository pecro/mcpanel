"""Admin-tunable, panel-wide settings.

Stored as a tiny JSON file at ${MC_DATA_ROOT}/admin-config.json. The file
is created on first write; missing-or-malformed reads fall back to the
defaults below — that way bumping the panel never breaks because of a
schema change in the file."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import asdict, dataclass

from . import config

log = logging.getLogger("mc-panel.admin_config")

# Hard ceilings — admin UI clamps within these. The 32 GiB cap stops
# anyone from accidentally typing a huge number that would OOM the host.
MIN_GB_FLOOR = 1
MAX_GB_CEILING = 32

# Sane upper bound on concurrent running worlds. A single MC server eats
# 4–8 GiB RAM resident; running 16 simultaneously would cripple any
# normal host. Admin can dial down further but never above this.
MAX_CONCURRENT_WORLDS_CEILING = 16

# Defaults match the historical hard-coded `config.MEMORY = "4G"` and the
# existing AwakeWarning's "only one at a time" rule, so existing installs
# see no behaviour change until an admin widens either.
_DEFAULT_MIN_GB = 4
_DEFAULT_MAX_GB = 4
_DEFAULT_MAX_CONCURRENT = 1


@dataclass
class AdminConfig:
    world_memory_min_gb: int = _DEFAULT_MIN_GB
    world_memory_max_gb: int = _DEFAULT_MAX_GB
    max_concurrent_worlds: int = _DEFAULT_MAX_CONCURRENT

    def clamp_world_memory(self, gb: int) -> int:
        """Snap a requested per-world memory into the admin's [min, max]."""
        return max(self.world_memory_min_gb, min(gb, self.world_memory_max_gb))

    def in_bounds(self, gb: int) -> bool:
        return self.world_memory_min_gb <= gb <= self.world_memory_max_gb


_PATH = config.DATA_ROOT / "admin-config.json"


def load() -> AdminConfig:
    if not _PATH.exists():
        return AdminConfig()
    try:
        data = json.loads(_PATH.read_text())
        return AdminConfig(
            world_memory_min_gb=int(data.get("world_memory_min_gb", _DEFAULT_MIN_GB)),
            world_memory_max_gb=int(data.get("world_memory_max_gb", _DEFAULT_MAX_GB)),
            max_concurrent_worlds=int(data.get("max_concurrent_worlds", _DEFAULT_MAX_CONCURRENT)),
        )
    except Exception as e:
        log.warning("admin-config.json unreadable (%s) — using defaults", e)
        return AdminConfig()


def save(cfg: AdminConfig) -> None:
    """Atomic write: the panel reads admin-config.json on every relevant
    request, so we never want to leave a half-written file behind."""
    validate(cfg)
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(_PATH.parent), prefix=".admin-config.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(asdict(cfg), f, indent=2)
        os.replace(tmp_path, _PATH)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def validate(cfg: AdminConfig) -> None:
    if not (MIN_GB_FLOOR <= cfg.world_memory_min_gb <= MAX_GB_CEILING):
        raise ValueError(f"world_memory_min_gb must be {MIN_GB_FLOOR}..{MAX_GB_CEILING}")
    if not (MIN_GB_FLOOR <= cfg.world_memory_max_gb <= MAX_GB_CEILING):
        raise ValueError(f"world_memory_max_gb must be {MIN_GB_FLOOR}..{MAX_GB_CEILING}")
    if cfg.world_memory_min_gb > cfg.world_memory_max_gb:
        raise ValueError("world_memory_min_gb must be <= world_memory_max_gb")
    if not (1 <= cfg.max_concurrent_worlds <= MAX_CONCURRENT_WORLDS_CEILING):
        raise ValueError(
            f"max_concurrent_worlds must be 1..{MAX_CONCURRENT_WORLDS_CEILING}"
        )
