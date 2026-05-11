"""Persistence for built-in auth credentials.

Holds the bcrypt admin-password hash and the session-signing secret. Kept
in its own narrow JSON file (auth-state.json) rather than co-mingled with
admin-config.json so that operator-tunable settings stay cleanly user-
facing while credentials live in a 0600-permissioned secrets file."""
from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import tempfile
from dataclasses import dataclass

from . import config

log = logging.getLogger("mc-panel.auth_state")

_PATH = config.DATA_ROOT / "auth-state.json"


@dataclass
class AuthState:
    admin_password_hash: str = ""
    session_secret: str = ""


def _save(state: AuthState) -> None:
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(_PATH.parent), prefix=".auth-state.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(
                {
                    "admin_password_hash": state.admin_password_hash,
                    "session_secret": state.session_secret,
                },
                f,
            )
        os.chmod(tmp, 0o600)
        os.replace(tmp, _PATH)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load() -> AuthState:
    if not _PATH.exists():
        return AuthState()
    try:
        raw = json.loads(_PATH.read_text())
    except Exception as e:
        log.warning("auth-state.json unreadable (%s) — using empty state", e)
        return AuthState()
    return AuthState(
        admin_password_hash=str(raw.get("admin_password_hash", "") or ""),
        session_secret=str(raw.get("session_secret", "") or ""),
    )


def update_password_hash(hash_str: str) -> None:
    state = load()
    state.admin_password_hash = hash_str
    _save(state)


def ensure_session_secret() -> str:
    """Return the persisted secret, generating + saving one on first call."""
    state = load()
    if state.session_secret:
        return state.session_secret
    state.session_secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
    _save(state)
    log.info("generated fresh session secret in auth-state.json")
    return state.session_secret
