"""Double-submit-cookie CSRF middleware.

Strategy:
* Issue a non-HttpOnly `mcpanel_csrf` cookie with a random token. The
  cookie is readable by the SPA so it can echo the value in an
  `X-CSRF-Token` header on every state-changing request.
* On POST / PUT / PATCH / DELETE under `/api/*`, require the header and
  the cookie to match. Reject with 403 if they don't.
* GET / HEAD / OPTIONS, /healthz, and the SPA static-asset path are
  exempt — they have no side effects.

Why double-submit instead of session-scoped tokens: it works identically
in builtin and forward-headers modes (no session needed), and it doesn't
need server-side state. The same-origin policy prevents an attacker page
from reading the cookie, so they can't forge the header.
"""
from __future__ import annotations

import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import config

CSRF_COOKIE = "mcpanel_csrf"
CSRF_HEADER = "x-csrf-token"

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _exempt_path(path: str) -> bool:
    # CSRF is only enforced on the JSON API. Static SPA assets and the
    # healthcheck don't accept state-changing input.
    return not path.startswith("/api/")


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cookie_token = request.cookies.get(CSRF_COOKIE)

        if (
            request.method not in _SAFE_METHODS
            and not _exempt_path(request.url.path)
        ):
            header_token = request.headers.get(CSRF_HEADER, "")
            if not cookie_token or not header_token or not secrets.compare_digest(
                cookie_token, header_token
            ):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF token missing or invalid"},
                )

        response: Response = await call_next(request)

        # Issue a token cookie if the client doesn't have one yet. The
        # token is opaque random bytes — same-origin policy stops attackers
        # from reading it, so signing it adds no security here.
        if not cookie_token:
            new_token = secrets.token_urlsafe(32)
            response.set_cookie(
                CSRF_COOKIE,
                new_token,
                httponly=False,  # SPA must read it via document.cookie
                samesite="lax",
                secure=config.COOKIE_SECURE,
                path="/",
            )

        return response
