"""Active auth backend selection + request-side identity gates.

Three backends:
  * forward-headers — reads Remote-User / Remote-Groups from an upstream
    proxy (Authelia, Authentik, Pocket-ID, ...).
  * builtin — single-admin password + signed-cookie sessions.
  * noauth — every request becomes admin@anonymous. Used only when
    MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true.

The choice is made once at startup based on AUTH_MODE. Callers in api.py
use `current_role()` / `require_role()` regardless of which backend is
active."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

import bcrypt
from fastapi import HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from . import auth_state, config, permissions
from .permissions import ADMIN, OPERATOR, USER

log = logging.getLogger("mc-panel.auth")

SESSION_COOKIE = "mcpanel_session"


@dataclass
class Identity:
    user: str
    # One of ADMIN, OPERATOR, USER, or "" when the user is authenticated
    # but has no panel role (forward-headers mode only).
    role: str


# --- backends ---------------------------------------------------------------


class _ForwardHeadersBackend:
    def identify(self, request: Request) -> Optional[Identity]:
        user = request.headers.get("Remote-User", "").strip()
        if not user:
            return None
        groups = permissions.parse_groups(request.headers.get("Remote-Groups", ""))
        role = permissions.role_from_groups(groups) or ""
        return Identity(user=user, role=role)


def _hash_from_bootstrap() -> str:
    """First-boot: if no hash is persisted yet, hash the bootstrap env
    value, persist it, and return the hash. No-op on subsequent boots."""
    state = auth_state.load()
    if state.admin_password_hash:
        return state.admin_password_hash
    plain = config.admin_password_bootstrap()
    if not plain:
        return ""
    hashed = bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    auth_state.update_password_hash(hashed)
    log.info("hashed and persisted admin password from MC_ADMIN_PASSWORD env")
    return hashed


class _BuiltinBackend:
    ADMIN_USERNAME = "admin"

    def __init__(self):
        self._serializer = URLSafeTimedSerializer(auth_state.ensure_session_secret())
        # Eagerly bootstrap the hash so the first login attempt doesn't pay
        # the bcrypt cost on the request thread.
        _hash_from_bootstrap()

    def _stored_hash(self) -> str:
        return auth_state.load().admin_password_hash or _hash_from_bootstrap()

    def identify(self, request: Request) -> Optional[Identity]:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return None
        try:
            data = self._serializer.loads(token, max_age=config.SESSION_TTL_DAYS * 86400)
        except (SignatureExpired, BadSignature):
            return None
        user = data.get("u") if isinstance(data, dict) else None
        if not user:
            return None
        return Identity(user=str(user), role=ADMIN)

    def login(self, password: str, response: Response) -> bool:
        stored = self._stored_hash()
        if not stored:
            return False
        if not bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8")):
            return False
        token = self._serializer.dumps({"u": self.ADMIN_USERNAME, "iat": int(time.time())})
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=config.SESSION_TTL_DAYS * 86400,
            httponly=True,
            samesite="lax",
            secure=config.COOKIE_SECURE,
            path="/",
        )
        return True

    def logout(self, response: Response) -> None:
        response.delete_cookie(SESSION_COOKIE, path="/")

    def change_password(self, current: str, new: str) -> bool:
        stored = self._stored_hash()
        if not stored:
            return False
        if not bcrypt.checkpw(current.encode("utf-8"), stored.encode("utf-8")):
            return False
        new_hash = bcrypt.hashpw(new.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        auth_state.update_password_hash(new_hash)
        return True


class _NoAuthBackend:
    """Active only when MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true."""

    def identify(self, request: Request) -> Optional[Identity]:
        return Identity(user="anonymous", role=ADMIN)


# --- backend selection ------------------------------------------------------

_backend: Optional[object] = None


def backend():
    global _backend
    if _backend is None:
        if config.allow_unauthenticated():
            log.warning(
                "MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true — every request "
                "becomes admin@anonymous. Do NOT expose this to a real network."
            )
            _backend = _NoAuthBackend()
        elif config.AUTH_MODE == "builtin":
            _backend = _BuiltinBackend()
        else:  # forward-headers
            _backend = _ForwardHeadersBackend()
    return _backend


def builtin_backend() -> Optional[_BuiltinBackend]:
    """The built-in backend if it's the active one, else None. The
    `/api/v1/auth/*` endpoints only make sense in built-in mode."""
    b = backend()
    return b if isinstance(b, _BuiltinBackend) else None


def is_builtin_mode() -> bool:
    return isinstance(backend(), _BuiltinBackend)


# --- request-side gates -----------------------------------------------------


def current_identity(request: Request) -> Optional[Identity]:
    return backend().identify(request)


def current_user(request: Request) -> str:
    """Empty string when unauthenticated — caller decides."""
    ident = current_identity(request)
    return ident.user if ident else ""


def current_role(request: Request) -> Optional[str]:
    ident = current_identity(request)
    if ident is None or not ident.role:
        return None
    return ident.role


def require_user(request: Request) -> str:
    """USER or higher. Endpoints that mutate must use
    `require_role(OPERATOR, request)` or higher instead."""
    return require_role(USER, request)


def require_role(min_role: str, request: Request) -> str:
    ident = current_identity(request)
    if ident is None:
        raise HTTPException(401, "not authenticated")
    if not ident.role:
        # Authenticated by the upstream proxy but no panel-mapped role.
        raise HTTPException(
            403,
            "your account has no mcpanel role — ask the host operator to "
            "grant you access",
        )
    if not permissions.at_least(ident.role, min_role):
        raise HTTPException(
            403,
            f"role '{ident.role}' lacks permission (need '{min_role}' or higher)",
        )
    return ident.user


__all__ = [
    "ADMIN",
    "OPERATOR",
    "USER",
    "Identity",
    "backend",
    "builtin_backend",
    "current_identity",
    "current_role",
    "current_user",
    "is_builtin_mode",
    "require_role",
    "require_user",
]
