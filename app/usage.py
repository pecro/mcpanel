"""Per-world usage data — extracted on demand from each world's MC log
files. Vanilla MC writes one line per join/leave to /data/logs/latest.log
(today's events) and rotates yesterday's into /data/logs/<YYYY-MM-DD>-N.log.gz.
We parse those files at request time; small enough that there's no need
for a long-running scraper or a sidecar database."""
from __future__ import annotations

import gzip
import logging
import re
from datetime import date, datetime
from pathlib import Path
from typing import Iterator

from . import config

log = logging.getLogger("mc-panel.usage")

# All three patterns expect MC's vanilla log line format:
#   [HH:MM:SS] [Server thread/INFO]: <message>
# Paper / Fabric / Forge preserve this format. Modded servers may diverge
# but parser failures are silent — we just miss those events.
_JOIN_RE = re.compile(
    r"^\[(\d\d:\d\d:\d\d)\] \[Server thread/INFO\]: (\S+) joined the game\s*$"
)
_LEAVE_RE = re.compile(
    r"^\[(\d\d:\d\d:\d\d)\] \[Server thread/INFO\]: (\S+) left the game\s*$"
)
# "Starting minecraft server version X" is the first line emitted on each
# fresh JVM boot — including after a crash that left players "stuck online"
# in our running set. When we see it we synthesize leave events for them.
_START_RE = re.compile(
    r"^\[(\d\d:\d\d:\d\d)\] \[Server thread/INFO\]: Starting minecraft server"
)
_ROTATED_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-\d+\.log\.gz$")


def _logs_dir(world_name: str) -> Path:
    return config.WORLDS_DIR / world_name / "logs"


def _all_log_files(logs_dir: Path) -> list[tuple[date, Path]]:
    """Every log file in the world's logs/ dir, paired with the date in
    its filename (latest.log → today). Sorted oldest first.

    We don't filter by the requested window here — the running 'online'
    set is path-dependent across files, so missing earlier ones gives a
    bogus initial state. For a personal stack the volume is small (a
    few MB compressed per week); when this becomes a perf problem,
    add a smarter cutoff that scans backwards until it sees a
    'Starting minecraft server' line."""
    if not logs_dir.is_dir():
        return []
    today = date.today()
    out: list[tuple[date, Path]] = []
    for p in sorted(logs_dir.iterdir()):
        if p.name == "latest.log":
            out.append((today, p))
            continue
        m = _ROTATED_RE.match(p.name)
        if not m:
            continue
        try:
            d = date.fromisoformat(m.group(1))
        except ValueError:
            continue
        out.append((d, p))
    out.sort()
    return out


def _read_log(p: Path) -> Iterator[str]:
    opener = gzip.open if p.suffix == ".gz" else open
    try:
        with opener(p, "rt", encoding="utf-8", errors="replace") as f:  # type: ignore[arg-type]
            for line in f:
                yield line.rstrip("\r\n")
    except OSError as e:
        log.warning("could not read %s: %s", p, e)


def _iso_local(d: date, hhmmss: str) -> str:
    """Combine a log file's date with the HH:MM:SS prefix on each line.
    Resolved against the host's local TZ — same TZ MC writes with inside
    the world container (both honor the TZ env var)."""
    h, m, s = hhmmss.split(":")
    dt = datetime(d.year, d.month, d.day, int(h), int(m), int(s))
    return dt.astimezone().isoformat()


def collect_events(
    world_name: str, since: datetime, until: datetime,
) -> dict:
    """Walk this world's log files in chronological order, tracking the
    running 'online' set across all events. Emit only events whose
    timestamp falls in [since, until]. Snapshot the online set at the
    start of the window (online_at_start) and at the end (online_at_end)
    so the SPA can seed its chart correctly even when offset > 0.

    Server restarts ('Starting minecraft server') reset the running set
    and synthesize leave events for any players who were online when
    the previous JVM stopped without graceful kicks (i.e., it crashed)."""
    files = _all_log_files(_logs_dir(world_name))
    online: set[str] = set()
    events: list[dict] = []
    online_at_start: set[str] | None = None

    def at_boundary(t_dt: datetime) -> None:
        nonlocal online_at_start
        if online_at_start is None and t_dt >= since:
            online_at_start = set(online)

    for d, fpath in files:
        for line in _read_log(fpath):
            if (mt := _START_RE.match(line)) is not None:
                t_iso = _iso_local(d, mt.group(1))
                t_dt = datetime.fromisoformat(t_iso)
                at_boundary(t_dt)
                if t_dt > until:
                    return _result(events, online_at_start, online, since, until)
                if since <= t_dt <= until:
                    for p in sorted(online):
                        events.append({"t": t_iso, "type": "leave", "player": p, "reason": "server-restart"})
                online.clear()
                continue
            if (mt := _JOIN_RE.match(line)) is not None:
                t_iso = _iso_local(d, mt.group(1))
                t_dt = datetime.fromisoformat(t_iso)
                at_boundary(t_dt)
                if t_dt > until:
                    return _result(events, online_at_start, online, since, until)
                player = mt.group(2)
                if since <= t_dt <= until:
                    events.append({"t": t_iso, "type": "join", "player": player})
                online.add(player)
                continue
            if (mt := _LEAVE_RE.match(line)) is not None:
                t_iso = _iso_local(d, mt.group(1))
                t_dt = datetime.fromisoformat(t_iso)
                at_boundary(t_dt)
                if t_dt > until:
                    return _result(events, online_at_start, online, since, until)
                player = mt.group(2)
                if since <= t_dt <= until:
                    events.append({"t": t_iso, "type": "leave", "player": player})
                online.discard(player)

    return _result(events, online_at_start, online, since, until)


def _result(
    events: list[dict],
    online_at_start: set[str] | None,
    online_at_end: set[str],
    since: datetime,
    until: datetime,
) -> dict:
    return {
        "events": events,
        "online_at_start": sorted(online_at_start or set()),
        "online_at_end": sorted(online_at_end),
        "since": since.isoformat(),
        "until": until.isoformat(),
    }


__all__ = ["collect_events"]
