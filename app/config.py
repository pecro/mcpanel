import os
from pathlib import Path

DOCKER_HOST = os.environ.get("DOCKER_HOST", "tcp://docker-socket-proxy:2375")

# Bind path inside this container. The host path must equal this so that when
# we create new MC containers the bind mount resolves on the docker daemon side.
DATA_ROOT = Path(os.environ.get("MC_DATA_ROOT", "/data/minecraft"))
WORLDS_DIR = DATA_ROOT / "worlds"
IMPORTS_DIR = DATA_ROOT / "imports"
BACKUPS_DIR = DATA_ROOT / "backups"
STAGING_DIR = DATA_ROOT / ".staging"

DOCKER_NETWORK = os.environ.get("DOCKER_NETWORK", "aio_default")
PORT_RANGE_START = int(os.environ.get("MC_PORT_RANGE_START", "35550"))
PORT_RANGE_END = int(os.environ.get("MC_PORT_RANGE_END", "35559"))
# Hostname that PLAYERS use to connect their MC clients. Defaults to the
# panel's own hostname. Kept as a distinct var in case the operator wants
# to split the panel UI hostname from the game-connect hostname — for
# example, when the panel is behind a CDN that won't proxy raw TCP traffic
# on the world ports.
GAME_HOSTNAME = (
    os.environ.get("MC_GAME_HOSTNAME", "").strip()
    or os.environ.get("MINECRAFT_HOSTNAME", "").strip()
    or "localhost"
)

DEFAULT_VERSION = os.environ.get("MC_DEFAULT_VERSION", "LATEST")
DEFAULT_TYPE = os.environ.get("MC_DEFAULT_TYPE", "VANILLA")
MEMORY = "4G"

PUID = os.environ.get("PUID", "1000")
PGID = os.environ.get("PGID", "1000")
TZ = os.environ.get("TZ", "Etc/UTC")

# RCON config. Used by the backup engine to flush MC's in-memory writes
# before snapshotting a running world. Only reachable on the docker network
# (RCON port is not published from the world container), so a default value
# is acceptable; override via .env for a less guessable one.
RCON_PORT = 25575
RCON_PASSWORD = os.environ.get("MC_RCON_PASSWORD", "mc-panel-rcon").strip()

# Daily backup scheduler.
BACKUP_HOUR = int(os.environ.get("MC_BACKUP_HOUR", "3"))
BACKUP_RETENTION_DAYS = int(os.environ.get("MC_BACKUP_RETENTION_DAYS", "7"))

CONTAINER_PREFIX = os.environ.get("MC_CONTAINER_PREFIX", "mc-")
MANAGED_LABEL = "mc-panel.managed"
WORLD_LABEL = "mc-panel.world"
PORT_LABEL = "mc-panel.port"

# When running v2 alongside v1, only one panel should run the nightly backup
# loop and the awake-watchdog. The lagging instance sets this to skip its
# background loops while still serving the UI / API.
DISABLE_BACKGROUND_LOOPS = os.environ.get("MC_DISABLE_BACKGROUND_LOOPS", "").lower() in ("1", "true", "yes")

# Single source of truth for which server.properties keys are exposed in the
# UI (both create form and edit form), and how to render them. The order of
# this dict is the order fields appear in both forms.
EDITABLE_PROPERTIES: dict[str, dict] = {
    "motd": {"type": "text", "default": ""},
    "gamemode": {
        "type": "select",
        "options": ["survival", "creative", "adventure", "spectator"],
        "default": "survival",
    },
    "difficulty": {
        "type": "select",
        "options": ["peaceful", "easy", "normal", "hard"],
        "default": "normal",
    },
    "view-distance": {"type": "number", "default": "10", "min": 3, "max": 32},
    "max-players": {"type": "number", "default": "20", "min": 1, "max": 100},
    "hardcore": {"type": "boolean", "default": "false"},
    "pvp": {"type": "boolean", "default": "true"},
}

WORLDS_DIR.mkdir(parents=True, exist_ok=True)
IMPORTS_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
STAGING_DIR.mkdir(parents=True, exist_ok=True)
