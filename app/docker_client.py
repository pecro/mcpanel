"""Docker SDK wrapper. All container operations route through here so the
panel never touches the docker socket directly — the socket-proxy in front of
us decides what's allowed."""

from __future__ import annotations

import logging
from typing import Iterator

import docker
from docker.errors import APIError, NotFound
from docker.models.containers import Container

from . import config
from .world import World

log = logging.getLogger(__name__)

_client: docker.DockerClient | None = None


def client() -> docker.DockerClient:
    global _client
    if _client is None:
        _client = docker.DockerClient(base_url=config.DOCKER_HOST)
    return _client


def _container_for(name: str) -> Container | None:
    try:
        return client().containers.get(f"{config.CONTAINER_PREFIX}{name}")
    except NotFound:
        return None


def _parse_memory_gb(memory_env: str) -> int:
    """Parse itzg's MEMORY env (e.g. '4G', '4096M') into integer gibibytes.
    Falls back to the historical default on garbage."""
    s = (memory_env or "").strip().lower()
    try:
        if s.endswith("gb"):
            return max(1, int(s[:-2]))
        if s.endswith("g"):
            return max(1, int(s[:-1]))
        if s.endswith("mb"):
            return max(1, int(s[:-2]) // 1024)
        if s.endswith("m"):
            return max(1, int(s[:-1]) // 1024)
        return max(1, int(s))
    except (ValueError, TypeError):
        return 4


def _to_world(c: Container) -> World:
    name = c.labels.get(config.WORLD_LABEL, c.name.removeprefix(config.CONTAINER_PREFIX))
    port = int(c.labels.get(config.PORT_LABEL, "0"))
    env = {e.split("=", 1)[0]: e.split("=", 1)[1] for e in c.attrs.get("Config", {}).get("Env", []) if "=" in e}
    return World(
        name=name,
        container_name=c.name,
        port=port,
        status=c.status,
        version=env.get("VERSION", "?"),
        motd=env.get("MOTD", ""),
        memory_gb=_parse_memory_gb(env.get("MEMORY", config.MEMORY)),
    )


def list_worlds() -> list[World]:
    cs = client().containers.list(
        all=True, filters={"label": f"{config.MANAGED_LABEL}=true"}
    )
    # Filter by container-name prefix so a v2 panel only sees its own worlds
    # when running alongside a v1 panel that uses the same managed label.
    cs = [c for c in cs if c.name.startswith(config.CONTAINER_PREFIX)]
    return sorted((_to_world(c) for c in cs), key=lambda w: w.name)


def get_world(name: str) -> World | None:
    c = _container_for(name)
    return _to_world(c) if c else None


def used_ports() -> set[int]:
    return {w.port for w in list_worlds() if w.port}


def allocate_port() -> int:
    used = used_ports()
    for p in range(config.PORT_RANGE_START, config.PORT_RANGE_END + 1):
        if p not in used:
            return p
    raise RuntimeError(
        f"no free ports in {config.PORT_RANGE_START}-{config.PORT_RANGE_END}"
    )


_ITZG_IMAGE = "itzg/minecraft-server:latest"

# JVM non-heap (metaspace, JIT cache, direct buffers, native libs, thread
# stacks) typically lands at 500 MB – 1 GB on a busy MC server. The
# container's cgroup memory limit needs to allow for that ON TOP OF the
# JVM heap (-Xmx, controlled by itzg's MEMORY env). When the two are
# sized identically, the kernel OOM-kills the JVM with no warning the
# moment non-heap pushes total RSS past the limit — losing up to one
# autosave window (5–15 min) of player progress on every kill.
_CONTAINER_HEADROOM_GIB = 1


def _container_mem_limit_bytes(heap: str) -> int:
    """Convert itzg's MEMORY env (e.g. '4G') into the bytes value docker
    wants for mem_limit, plus _CONTAINER_HEADROOM_GIB of headroom."""
    s = heap.strip().lower()
    if s.endswith("g") or s.endswith("gb"):
        n = int(s.rstrip("gb"))
    elif s.endswith("m") or s.endswith("mb"):
        n = max(1, int(s.rstrip("mb")) // 1024)
    else:
        n = int(s)
    return (n + _CONTAINER_HEADROOM_GIB) * 1024 ** 3


def _ensure_image(image: str) -> None:
    """Pull the image if it isn't already present locally. Docker SDK's
    containers.create() does not auto-pull, so a brand-new image otherwise
    fails with ImageNotFound on first use."""
    c = client()
    try:
        c.images.get(image)
        return
    except NotFound:
        pass
    log.info("pulling image %s", image)
    repo, _, tag = image.partition(":")
    c.images.pull(repo, tag=tag or "latest")


def create_container(
    name: str,
    port: int,
    version: str,
    mc_type: str,
    memory_gb: int | None = None,
) -> Container:
    container_name = f"{config.CONTAINER_PREFIX}{name}"
    host_world_path = str(config.WORLDS_DIR / name)
    _ensure_image(_ITZG_IMAGE)
    memory_env = f"{memory_gb}G" if memory_gb else config.MEMORY
    env = {
        "EULA": "TRUE",
        "TYPE": mc_type,
        "VERSION": version,
        "MEMORY": memory_env,
        "TZ": config.TZ,
        "UID": config.PUID,
        "GID": config.PGID,
        # Panel owns server.properties (motd, gamemode, difficulty, view-distance,
        # max-players, hardcore, pvp, level-seed, enforce-whitelist, white-list).
        # Setting itzg env vars for those would be ignored anyway with SKIP=true.
        "OVERRIDE_SERVER_PROPERTIES": "false",
        "SKIP_SERVER_PROPERTIES": "true",
        # RCON, used by the backup engine to flush in-memory writes before
        # snapshotting a running world. Port 25575 is internal-only (not
        # published from the container), reachable only on the docker network.
        "ENABLE_RCON": "true",
        "RCON_PASSWORD": config.RCON_PASSWORD,
    }
    labels = {
        config.MANAGED_LABEL: "true",
        config.WORLD_LABEL: name,
        config.PORT_LABEL: str(port),
    }
    mem_bytes = _container_mem_limit_bytes(memory_env)
    return client().containers.create(
        image=_ITZG_IMAGE,
        name=container_name,
        environment=env,
        labels=labels,
        volumes={host_world_path: {"bind": "/data", "mode": "rw"}},
        network=config.DOCKER_NETWORK,
        ports={"25565/tcp": port},
        restart_policy={"Name": "unless-stopped"},
        mem_limit=mem_bytes,
        memswap_limit=mem_bytes,
        tty=True,
        stdin_open=True,
        detach=True,
    )


def start_container(name: str) -> None:
    c = _container_for(name)
    if c is None:
        raise NotFound(f"world {name}")
    if c.status != "running":
        c.start()


def stop_container(name: str) -> None:
    c = _container_for(name)
    if c is None:
        raise NotFound(f"world {name}")
    if c.status == "running":
        c.stop(timeout=30)


def recreate_container(
    name: str,
    *,
    version: str | None = None,
    mc_type: str | None = None,
    memory_gb: int | None = None,
) -> None:
    """Stop gracefully, remove, then re-create the container with the
    same name + port but possibly a new VERSION / TYPE / MEMORY. World
    data, server.properties, whitelist.json, ops.json, and backups all
    live in the bind mount so they survive the rebuild — only the
    JVM/jar/image is replaced. Caller chooses whether to start after."""
    c = _container_for(name)
    if c is None:
        raise NotFound(f"world {name}")
    port = int(c.labels.get(config.PORT_LABEL, "0"))
    if not port:
        raise RuntimeError(f"world {name} has no {config.PORT_LABEL} label")
    env = {
        e.split("=", 1)[0]: e.split("=", 1)[1]
        for e in c.attrs.get("Config", {}).get("Env", [])
        if "=" in e
    }
    target_version = version or env.get("VERSION") or config.DEFAULT_VERSION
    target_type = mc_type or env.get("TYPE") or config.DEFAULT_TYPE
    target_memory_gb = memory_gb if memory_gb is not None else _parse_memory_gb(
        env.get("MEMORY", config.MEMORY)
    )

    # Graceful shutdown — chunks need to flush before the JVM dies, or
    # the upgrade trades RAM-resident world state for a stale snapshot.
    if c.status == "running":
        try:
            c.stop(timeout=30)
        except APIError:
            pass
    c.remove(force=True)

    create_container(
        name=name,
        port=port,
        version=target_version,
        mc_type=target_type,
        memory_gb=target_memory_gb,
    )


def remove_container(name: str) -> None:
    """SIGKILL + remove. The world data is being archived anyway, so a
    graceful save-on-stop would just block the API for ~25s while the JVM
    flushes — pointless for a delete."""
    c = _container_for(name)
    if c is None:
        return
    c.remove(force=True, v=False)


def stream_logs(name: str, tail: int = 200) -> Iterator[bytes]:
    c = _container_for(name)
    if c is None:
        raise NotFound(f"world {name}")
    return c.logs(stream=True, follow=True, tail=tail)


def count_awake_managed() -> int:
    return sum(1 for w in list_worlds() if w.awake)
