"""In-memory job tracking for long-lived mutations (create/start/stop/
delete/backup). Each mutation handler submits a Job and kicks off
execution in a threadpool, returning the job id immediately. Clients
poll GET /api/v1/jobs/:id until status is terminal.

State is process-local. If the panel restarts mid-job the entry is
forgotten, but the docker daemon is the source of truth — the next
state fetch reflects whatever actually committed."""
from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal, Optional

log = logging.getLogger("mc-panel.jobs")

JobKind = Literal["create", "start", "stop", "delete", "backup", "upgrade", "restore"]
JobStatus = Literal["queued", "running", "success", "failed"]

# Tunables. Generous TTL since the dict is tiny and giving users 10 min to
# scroll back to "what happened" is friendlier than aggressive eviction.
_MAX_ENTRIES = 200
_RETENTION = timedelta(minutes=10)


@dataclass
class Job:
    id: str
    kind: JobKind
    target: str
    status: JobStatus
    started: datetime
    finished: Optional[datetime] = None
    progress: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "target": self.target,
            "status": self.status,
            "started": self.started.isoformat(),
            "finished": self.finished.isoformat() if self.finished else None,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
        }


class SingleFlightError(Exception):
    """Raised when a job for the same (kind, target) is already in flight.
    Holds a reference to the existing job so the API can return its id."""

    def __init__(self, existing: Job):
        super().__init__(f"another {existing.kind} on {existing.target} is already in flight")
        self.existing = existing


_lock = threading.RLock()
_jobs: dict[str, Job] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _evict() -> None:
    """Drop oldest finished entries past the retention window or capacity.
    Caller must hold _lock."""
    now = _now()
    expired = [
        jid for jid, j in _jobs.items()
        if j.finished is not None and (now - j.finished) > _RETENTION
    ]
    for jid in expired:
        del _jobs[jid]
    if len(_jobs) > _MAX_ENTRIES:
        finished = sorted(
            (j for j in _jobs.values() if j.finished is not None),
            key=lambda j: j.finished or now,
        )
        for j in finished[: len(_jobs) - _MAX_ENTRIES]:
            _jobs.pop(j.id, None)


def submit(kind: JobKind, target: str) -> Job:
    """Register a new job. Raises SingleFlightError if another job for the
    same target is queued or running."""
    with _lock:
        for j in _jobs.values():
            if j.target == target and j.status in ("queued", "running"):
                raise SingleFlightError(j)
        job = Job(
            id=str(uuid.uuid4()),
            kind=kind,
            target=target,
            status="queued",
            started=_now(),
        )
        _jobs[job.id] = job
        _evict()
        log.info("job %s submitted: %s on %s", job.id, kind, target)
        return job


def get(job_id: str) -> Optional[Job]:
    with _lock:
        return _jobs.get(job_id)


def list_active(target: Optional[str] = None) -> list[Job]:
    with _lock:
        out = [j for j in _jobs.values() if j.status in ("queued", "running")]
        if target is not None:
            out = [j for j in out if j.target == target]
        return out


def _mark_running(job_id: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j is not None:
            j.status = "running"


def _mark_success(job_id: str, result: Optional[dict]) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j is not None:
            j.status = "success"
            j.finished = _now()
            j.result = result
            log.info("job %s success: %s on %s", job_id, j.kind, j.target)


def _mark_failed(job_id: str, error: str) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j is not None:
            j.status = "failed"
            j.finished = _now()
            j.error = error
            log.warning("job %s failed: %s on %s — %s", job_id, j.kind, j.target, error)


async def execute(
    job_id: str,
    fn: Callable[..., Any],
    *args: Any,
    **kwargs: Any,
) -> None:
    """Run `fn(*args, **kwargs)` in a threadpool, recording the result on
    the job. Sync-blocking dc.* calls are fine; the event loop stays free.
    The function's return value (must be JSON-serializable dict or None)
    is stored as the job result."""
    _mark_running(job_id)
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, lambda: fn(*args, **kwargs))
        if result is not None and not isinstance(result, dict):
            result = {"value": result}
        _mark_success(job_id, result)
    except Exception as e:  # noqa: BLE001
        _mark_failed(job_id, str(e))
