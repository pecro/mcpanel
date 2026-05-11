import json
import logging
import re
import secrets
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

import httpx

from . import config, level_dat, players

log = logging.getLogger("mc-panel.world")


def _resolve_uuid(name: str) -> str | None:
    """Resolve a Minecraft username to its dashed UUID via Mojang.
    Returns None for typos/non-existent accounts or transient lookup errors."""
    name = name.strip()
    if not name:
        return None
    try:
        r = httpx.get(
            f"https://api.mojang.com/users/profiles/minecraft/{name}",
            timeout=5,
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        u = r.json()["id"]
        return f"{u[0:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:32]}"
    except Exception as e:  # noqa: BLE001
        log.warning("uuid lookup failed for %s: %s", name, e)
        return None

NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
RESERVED = {"new", "import", "all", "default"}


def validate_name(name: str) -> None:
    if not NAME_RE.match(name):
        raise ValueError(
            "name must be 1-32 chars, lowercase letters/digits/dashes, starting with a letter"
        )
    if name in RESERVED:
        raise ValueError(f"'{name}' is reserved")


@dataclass
class World:
    name: str
    container_name: str
    port: int
    status: str  # running | exited | created | none
    version: str
    motd: str
    memory_gb: int  # JVM heap (-Xmx) in gibibytes; container cgroup adds 1 GiB headroom

    @property
    def awake(self) -> bool:
        return self.status == "running"


def world_dir(name: str) -> Path:
    return config.WORLDS_DIR / name


def resolved_version(name: str) -> str | None:
    """Actual MC version recorded in level.dat by Minecraft itself.

    The container's VERSION env var may be a placeholder like "LATEST"; this
    reads what was actually fetched and saved into the world. Returns None
    until the world has booted at least once (level.dat is written on first
    save), and on parse failures."""
    p = world_dir(name) / "world" / "level.dat"
    if not p.exists():
        return None
    try:
        return level_dat.parse(p).get("Version_Name")
    except Exception:
        return None


# Panel-private dir under each world for assets the panel manages (banners
# today; could grow to thumbnails, notes, etc). Kept dot-prefixed so it
# never collides with files Minecraft writes.
PANEL_DIR_NAME = ".panel"
ALLOWED_BANNER_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def banner_path(name: str) -> Path | None:
    """Return the current banner file for a world, or None if none uploaded."""
    panel = world_dir(name) / PANEL_DIR_NAME
    if not panel.is_dir():
        return None
    for p in panel.iterdir():
        if p.is_file() and p.stem == "banner" and p.suffix.lower() in ALLOWED_BANNER_EXT:
            return p
    return None


def save_banner(name: str, src: BinaryIO, ext: str) -> Path:
    """Replace any existing banner with the new bytes. `ext` must already be
    validated against ALLOWED_BANNER_EXT (typically by sniffing the magic
    bytes — don't trust the client-provided filename)."""
    ext = ext.lower()
    if ext not in ALLOWED_BANNER_EXT:
        raise ValueError(f"unsupported banner extension {ext!r}")
    panel = world_dir(name) / PANEL_DIR_NAME
    panel.mkdir(exist_ok=True)
    # Drop any existing banner first so changing extension doesn't leave a stale copy.
    for p in panel.iterdir():
        if p.is_file() and p.stem == "banner" and p.suffix.lower() in ALLOWED_BANNER_EXT:
            p.unlink()
    target = panel / f"banner{ext}"
    with target.open("wb") as f:
        shutil.copyfileobj(src, f)
    return target


def delete_banner(name: str) -> bool:
    """Remove the world's banner. Returns True if a file was deleted."""
    p = banner_path(name)
    if p is None:
        return False
    p.unlink()
    return True


def list_imports() -> list[str]:
    if not config.IMPORTS_DIR.exists():
        return []
    return sorted(p.name for p in config.IMPORTS_DIR.iterdir() if p.is_dir())


def list_world_dirs() -> list[str]:
    return sorted(p.name for p in config.WORLDS_DIR.iterdir() if p.is_dir())


def read_properties(name: str) -> dict[str, str]:
    path = world_dir(name) / "server.properties"
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip()
    return out


def write_properties(name: str, edits: dict[str, str]) -> None:
    """Edit only the keys provided; leave the rest of the file (and order) intact."""
    path = world_dir(name) / "server.properties"
    if path.exists():
        lines = path.read_text().splitlines()
    else:
        lines = []
    seen: set[str] = set()
    for i, line in enumerate(lines):
        if not line or line.startswith("#") or "=" not in line:
            continue
        k = line.split("=", 1)[0].strip()
        if k in edits:
            lines[i] = f"{k}={edits[k]}"
            seen.add(k)
    for k, v in edits.items():
        if k not in seen:
            lines.append(f"{k}={v}")
    path.write_text("\n".join(lines) + ("\n" if lines else ""))


def read_name_list(name: str, filename: str) -> list[str]:
    """Read whitelist.json or ops.json and return player names."""
    path = world_dir(name) / filename
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return []
    out = []
    for entry in data:
        if isinstance(entry, dict) and "name" in entry:
            out.append(entry["name"])
        elif isinstance(entry, str):
            out.append(entry)
    return sorted(out)


def _read_entries(world_name: str, list_type: str) -> list[dict]:
    path = world_dir(world_name) / f"{list_type}.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return []
    return [e for e in data if isinstance(e, dict) and "name" in e]


def _write_entries(world_name: str, list_type: str, entries: list[dict]) -> None:
    path = world_dir(world_name) / f"{list_type}.json"
    path.write_text(json.dumps(entries, indent=2))


def add_player(world_name: str, list_type: str, player: str) -> tuple[bool, str]:
    """Validate `player` against Mojang and append to whitelist.json or
    ops.json. Returns (ok, message). Strict: a 404 from Mojang refuses the
    add (so the admin can fix the typo) rather than writing a non-matching
    entry."""
    player = player.strip()
    if not player:
        return False, "name is empty"
    entries = _read_entries(world_name, list_type)
    if any(e["name"].lower() == player.lower() for e in entries):
        return True, f"{player} is already in the {list_type}"
    uuid = _resolve_uuid(player)
    if uuid is None:
        return False, f"no Mojang account named '{player}' — check the spelling"
    entry: dict = {"uuid": uuid, "name": player}
    if list_type == "ops":
        entry.update({"level": 4, "bypassesPlayerLimit": False})
    entries.append(entry)
    _write_entries(world_name, list_type, entries)
    if list_type == "whitelist":
        players.remember(uuid, player)
    return True, f"added {player}"


def remove_player(world_name: str, list_type: str, player: str) -> tuple[bool, str]:
    """Remove a player from whitelist.json or ops.json. Case-insensitive.
    Removing from the whitelist also strips them from ops — the UI shows
    ops as toggles on whitelist entries, so an op who is no longer
    whitelisted would have no row to toggle off (and they couldn't connect
    anyway with enforce-whitelist=true)."""
    player = player.strip()
    entries = _read_entries(world_name, list_type)
    kept = [e for e in entries if e["name"].lower() != player.lower()]
    if len(kept) == len(entries):
        return False, f"{player} not found in {list_type}"
    _write_entries(world_name, list_type, kept)
    if list_type == "whitelist":
        ops = _read_entries(world_name, "ops")
        kept_ops = [e for e in ops if e["name"].lower() != player.lower()]
        if len(kept_ops) != len(ops):
            _write_entries(world_name, "ops", kept_ops)
    return True, f"removed {player}"


def set_op(world_name: str, player: str, enabled: bool) -> tuple[bool, str]:
    """Grant or revoke op for a whitelisted player. Granting copies the
    UUID from the whitelist entry rather than re-querying Mojang — the
    name was already validated when added to the whitelist."""
    if not enabled:
        return remove_player(world_name, "ops", player)
    player = player.strip()
    if not player:
        return False, "name is empty"
    wl = _read_entries(world_name, "whitelist")
    match = next((e for e in wl if e["name"].lower() == player.lower()), None)
    if match is None:
        return False, f"{player} must be whitelisted first"
    ops = _read_entries(world_name, "ops")
    if any(e["name"].lower() == player.lower() for e in ops):
        return True, f"{match['name']} is already an op"
    ops.append({
        "uuid": match["uuid"],
        "name": match["name"],
        "level": 4,
        "bypassesPlayerLimit": False,
    })
    _write_entries(world_name, "ops", ops)
    return True, f"made {match['name']} an op"


def archive_world(name: str) -> Path:
    src = world_dir(name)
    dst = config.WORLDS_DIR.parent / "archive"
    dst.mkdir(parents=True, exist_ok=True)
    target = dst / f"{name}-{src.stat().st_mtime_ns}"
    shutil.move(str(src), str(target))
    return target


def _classify_zip(names: list[str]) -> tuple[str, str, bool]:
    """Inspect a zip's file list and decide how to extract.

    Returns (level_dat_path, extract_prefix, wrap_in_world):
    - level_dat_path: the shallowest level.dat in the zip (used for metadata)
    - extract_prefix: prefix to strip from each entry's path on extract
    - wrap_in_world: if True, wrap extracted entries in a `world/` subdir

    Two cases:
    - **Server backup** (extract_prefix="", wrap_in_world=False): zip has
      server config files at the root AND a `world/` subdir with level.dat.
      Extract as-is to preserve server.properties, whitelist.json, etc.
    - **Singleplayer save** (extract_prefix=<level dir>+"/", wrap_in_world=True):
      zip contains just a world (e.g. `MyWorld/level.dat` or `level.dat` at
      root). Move that level's contents into `<staging>/world/` so MC's
      default `level-name=world` finds it.
    """
    level_dats = [n for n in names if PurePosixPath(n).name == "level.dat"]
    if not level_dats:
        raise ValueError("zip does not contain a level.dat — is this a Minecraft world?")
    level_dat = min(level_dats, key=lambda n: n.count("/"))
    level_dir = str(PurePosixPath(level_dat).parent)
    if level_dir in ("", "."):
        level_dir = ""
    server_props_at_root = "server.properties" in names
    if server_props_at_root and level_dir:
        # Server backup: keep full layout, level.dat stays under its current dir
        return level_dat, "", False
    # Singleplayer save: the level dir's contents become `world/`
    return level_dat, (level_dir + "/" if level_dir else ""), True


def _strip_favicons(staging_dir: Path) -> None:
    """Delete any embedded server-list icon brought in by the import. These
    are pure presentation — MC renders the default server-list entry when
    absent — and singleplayer saves often carry a multi-KB world thumbnail
    that bloats every status ping for no benefit."""
    for rel in ("server-icon.png", "world/icon.png"):
        path = staging_dir / rel
        if path.exists():
            path.unlink()
            log.info("stripped icon %s from staging %s", rel, staging_dir.name)


def stage_zip(upload: BinaryIO) -> tuple[str, Path]:
    """Save an uploaded zip into a fresh staging directory and extract.
    Returns (staging_id, staging_dir)."""
    staging_id = secrets.token_urlsafe(8)
    dst = config.STAGING_DIR / staging_id
    dst.mkdir(parents=True, exist_ok=False)
    tmp_zip = dst.parent / f".upload-{staging_id}.zip"
    try:
        with tmp_zip.open("wb") as f:
            shutil.copyfileobj(upload, f, length=1024 * 1024)
        try:
            zf = zipfile.ZipFile(tmp_zip, "r")
        except zipfile.BadZipFile as e:
            shutil.rmtree(dst, ignore_errors=True)
            raise ValueError(f"upload is not a valid zip file: {e}") from e
        with zf:
            try:
                _, prefix, wrap = _classify_zip(zf.namelist())
            except ValueError:
                shutil.rmtree(dst, ignore_errors=True)
                raise
            dst_resolved = dst.resolve()
            for info in zf.infolist():
                if not info.filename.startswith(prefix):
                    continue
                rel = info.filename[len(prefix):]
                if not rel or rel.endswith("/"):
                    continue
                if wrap:
                    target_rel = "world/" + rel
                else:
                    target_rel = rel
                target = (dst / target_rel).resolve()
                if not target.is_relative_to(dst_resolved):
                    shutil.rmtree(dst, ignore_errors=True)
                    raise ValueError(f"unsafe zip entry rejected: {info.filename}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, target.open("wb") as out:
                    shutil.copyfileobj(src, out, length=1024 * 1024)
        _strip_favicons(dst)
        return staging_id, dst
    finally:
        tmp_zip.unlink(missing_ok=True)


def stage_imports(source_subdir: str) -> tuple[str, Path]:
    """Copy a directory from imports/ into a fresh staging dir, normalising
    the layout so a server.properties at top + world/ at level dir is the
    consistent shape (same as stage_zip)."""
    src = config.IMPORTS_DIR / source_subdir
    if not src.is_dir() or src.resolve().parent != config.IMPORTS_DIR.resolve():
        raise ValueError("invalid import source")
    level_dats = list(src.rglob("level.dat"))
    if not level_dats:
        raise ValueError(f"'{source_subdir}' does not contain a level.dat")
    level_dat_path = min(level_dats, key=lambda p: len(p.parts))
    level_dir = level_dat_path.parent
    server_props_at_top = (src / "server.properties").exists()
    staging_id = secrets.token_urlsafe(8)
    dst = config.STAGING_DIR / staging_id
    if server_props_at_top and level_dir != src:
        shutil.copytree(src, dst)
    else:
        # Wrap the level dir's contents in `world/`
        (dst / "world").mkdir(parents=True)
        for child in level_dir.iterdir():
            target = dst / "world" / child.name
            if child.is_dir():
                shutil.copytree(child, target)
            else:
                shutil.copy2(child, target)
    _strip_favicons(dst)
    return staging_id, dst


def _find_level_dat(staging_dir: Path) -> Path | None:
    for candidate in (staging_dir / "level.dat", staging_dir / "world" / "level.dat"):
        if candidate.exists():
            return candidate
    return None


def peek_metadata(staging_dir: Path) -> dict[str, Any]:
    """Inspect a staged world dir and report what we can tell about it.
    Best-effort: any field that can't be determined is simply absent."""
    level_dat_path = _find_level_dat(staging_dir)
    out: dict[str, Any] = {
        "name_suggestion": "imported-world",
        "server_type_guess": "VANILLA",
        "whitelist_count": 0,
        "ops_count": 0,
        "has_level_dat": level_dat_path is not None,
    }
    if level_dat_path is not None:
        try:
            data = level_dat.parse(level_dat_path)
            if name := data.get("LevelName"):
                out["level_name"] = name
                slug = _slugify(name)
                if slug:
                    out["name_suggestion"] = slug
            if vname := data.get("Version_Name"):
                out["mc_version"] = vname
            if data.get("hardcore"):
                out["hardcore"] = True
            for k in ("Difficulty", "GameType", "DataVersion"):
                if k in data:
                    out[k.lower()] = data[k]
        except Exception as e:  # noqa: BLE001
            log.warning("level.dat parse failed: %s", e)

    # Server-type heuristic — order matters; check most specific first.
    if (staging_dir / "config" / "fabric_loader_dependencies.json").exists() \
            or any(staging_dir.glob("mods/fabric-*.jar")):
        out["server_type_guess"] = "FABRIC"
    elif any(staging_dir.glob("forge*.jar")) or (staging_dir / "mods").is_dir() and \
            any((staging_dir / "mods").iterdir()):
        out["server_type_guess"] = "FORGE"
    elif (staging_dir / "config" / "paper-global.yml").exists() \
            or (staging_dir / "paper.yml").exists() \
            or any(staging_dir.glob("paper-*.jar")):
        out["server_type_guess"] = "PAPER"

    for fn, key in (("whitelist.json", "whitelist_count"), ("ops.json", "ops_count")):
        f = staging_dir / fn
        if f.exists():
            try:
                data = json.loads(f.read_text())
                out[key] = len([e for e in data if isinstance(e, dict) and "name" in e])
            except Exception:  # noqa: BLE001
                pass

    # MOTD: server backups carry their own; for singleplayer we'll default
    # to the level name on commit, so report that here too.
    sp = staging_dir / "server.properties"
    if sp.is_file():
        for line in sp.read_text(errors="replace").splitlines():
            if line.startswith("motd="):
                out["motd"] = line.split("=", 1)[1].strip()
                break
    if "motd" not in out and "level_name" in out:
        out["motd"] = out["level_name"]
    return out


_DIFFICULTY_BY_INT = {0: "peaceful", 1: "easy", 2: "normal", 3: "hard"}
_GAMEMODE_BY_INT = {0: "survival", 1: "creative", 2: "adventure", 3: "spectator"}


def level_dat_property_defaults(metadata: dict[str, Any]) -> dict[str, str]:
    """Map fields read out of level.dat by peek_metadata() into server.properties
    keys. Used at import time so a singleplayer save (which has no
    server.properties of its own) starts as an MC server with the same
    difficulty/gamemode/hardcore the player was using locally.

    Callers should layer this UNDER the imported server.properties — server
    backups already carry the authoritative values and shouldn't be
    clobbered."""
    out: dict[str, str] = {}
    if (d := metadata.get("difficulty")) is not None and d in _DIFFICULTY_BY_INT:
        out["difficulty"] = _DIFFICULTY_BY_INT[d]
    if (g := metadata.get("gametype")) is not None and g in _GAMEMODE_BY_INT:
        out["gamemode"] = _GAMEMODE_BY_INT[g]
    if metadata.get("hardcore"):
        out["hardcore"] = "true"
    if name := metadata.get("level_name"):
        out["motd"] = name
    return out


def commit_import(staging_id: str, target_name: str) -> Path:
    """Move a staged dir into worlds/<target_name>. Caller must have
    already validated the target name and verified it's free."""
    src = config.STAGING_DIR / staging_id
    if not src.is_dir() or src.resolve().parent != config.STAGING_DIR.resolve():
        raise ValueError("invalid or expired staging id")
    dst = world_dir(target_name)
    if dst.exists() and any(dst.iterdir()):
        raise ValueError(f"world '{target_name}' already has data")
    if dst.exists():
        dst.rmdir()
    shutil.move(str(src), str(dst))
    return dst


def discard_staging(staging_id: str) -> None:
    """Clean up a staging dir (e.g., user cancelled or new upload superseded)."""
    src = config.STAGING_DIR / staging_id
    if src.is_dir() and src.resolve().parent == config.STAGING_DIR.resolve():
        shutil.rmtree(src, ignore_errors=True)


def _slugify(s: str) -> str:
    """Best-effort name suggestion from a level name. Must satisfy
    validate_name (lowercase letter start, [a-z0-9-], ≤32 chars)."""
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if not s:
        return ""
    if not s[0].isalpha():
        s = "w-" + s
    return s[:32].rstrip("-")
