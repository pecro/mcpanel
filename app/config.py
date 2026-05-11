import os
from pathlib import Path

DOCKER_HOST = os.environ.get("DOCKER_HOST", "tcp://docker-socket-proxy:2375")

# Data root has two distinct addresses:
#   - the container-side path the panel uses for its own filesystem reads/writes
#   - the host-side path the panel passes to Docker when constructing bind
#     mounts on the world containers it spawns
# When the panel container bind-mounts the host data dir at the same path
# inside (the simple Linux Docker case), the two are equal and MC_DATA_ROOT
# alone suffices as a single-value fallback.
_legacy_data_root = os.environ.get("MC_DATA_ROOT", "").strip()
_container_data_root = (
    os.environ.get("MC_CONTAINER_DATA_ROOT", "").strip()
    or _legacy_data_root
    or "/data/minecraft"
)
_host_data_root = (
    os.environ.get("MC_HOST_DATA_ROOT", "").strip()
    or _legacy_data_root
    or _container_data_root
)
DATA_ROOT = Path(_container_data_root)
HOST_DATA_ROOT = Path(_host_data_root)

WORLDS_DIR = DATA_ROOT / "worlds"
IMPORTS_DIR = DATA_ROOT / "imports"
BACKUPS_DIR = DATA_ROOT / "backups"
STAGING_DIR = DATA_ROOT / ".staging"

# Host-side equivalent of WORLDS_DIR, used only when telling Docker where
# the world bind mount lives on the host filesystem.
HOST_WORLDS_DIR = HOST_DATA_ROOT / "worlds"

DOCKER_NETWORK = os.environ.get("DOCKER_NETWORK", "aio_default")
PORT_RANGE_START = int(os.environ.get("MC_PORT_RANGE_START", "35550"))
PORT_RANGE_END = int(os.environ.get("MC_PORT_RANGE_END", "35559"))
# Hostname PLAYERS use to connect their MC clients. If unset, callers fall
# back to the request Host header so the UI shows whatever the user typed
# in their browser. Kept as a distinct var (separate from the panel UI
# hostname) for the case where the panel is behind a CDN that won't proxy
# raw TCP traffic on the world ports.
GAME_HOSTNAME = (
    os.environ.get("MC_GAME_HOSTNAME", "").strip()
    or os.environ.get("MINECRAFT_HOSTNAME", "").strip()
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

# --- Auth -------------------------------------------------------------------
# AUTH_MODE = "builtin"           — single-admin password, signed cookie sessions
# AUTH_MODE = "forward-headers"   — Remote-User / Remote-Groups from an upstream
#                                   proxy (Authelia, Authentik, Pocket-ID, ...)
# unset                           — refuse to start (must be explicit)
AUTH_MODE = os.environ.get("AUTH_MODE", "").strip().lower()

# Dev escape hatch — every request becomes admin@anonymous. Never expose to a
# real network.
_ALLOW_UNAUTHENTICATED = (
    os.environ.get("MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED", "").strip().lower()
    in ("1", "true", "yes")
)

# Bootstrap admin password — used only on first boot in built-in mode. Once
# hashed and persisted to auth-state.json, the env can be removed.
_ADMIN_PASSWORD = os.environ.get("MC_ADMIN_PASSWORD", "").strip()
_ADMIN_PASSWORD_FILE = os.environ.get("MC_ADMIN_PASSWORD_FILE", "").strip()


def admin_password_bootstrap() -> str:
    """Read the bootstrap password from env or file. _FILE wins if both set
    (the Docker-secrets pattern). Empty string if neither is configured."""
    if _ADMIN_PASSWORD_FILE:
        try:
            return Path(_ADMIN_PASSWORD_FILE).read_text().strip()
        except OSError:
            return ""
    return _ADMIN_PASSWORD


SESSION_TTL_DAYS = int(os.environ.get("MC_SESSION_TTL_DAYS", "7"))
COOKIE_SECURE = (
    os.environ.get("MC_COOKIE_SECURE", "true").strip().lower()
    not in ("0", "false", "no")
)


def allow_unauthenticated() -> bool:
    return _ALLOW_UNAUTHENTICATED


class ConfigError(RuntimeError):
    pass


def validate_auth() -> None:
    """Called once at startup. Refuse to boot on incoherent auth config so
    misconfigured deployments fail loudly instead of silently exposing
    admin endpoints."""
    if _ALLOW_UNAUTHENTICATED:
        return
    if AUTH_MODE not in ("builtin", "forward-headers"):
        raise ConfigError(
            "AUTH_MODE must be 'builtin' or 'forward-headers'. For local "
            "dev only, set MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true to "
            "skip auth entirely."
        )
    if AUTH_MODE == "builtin":
        # Lazy import — auth_state imports this module.
        from . import auth_state
        if not admin_password_bootstrap() and not auth_state.load().admin_password_hash:
            raise ConfigError(
                "AUTH_MODE=builtin requires MC_ADMIN_PASSWORD (or "
                "MC_ADMIN_PASSWORD_FILE) on first boot. Once you've "
                "logged in or used the change-password endpoint, the "
                "hash is persisted to auth-state.json and the env can "
                "be removed."
            )

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
