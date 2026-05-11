"""Three-tier role gate keyed off the lldap groups Authelia forwards.

mc-panel doesn't have its own users database. Identity comes from
Authelia (Remote-User header); roles come from lldap groups (Remote-Groups
header), which we map onto a small fixed hierarchy:

    admin > operator > user > (no role -> 403)

All endpoints sit behind one of the three tiers. The tier check is
hierarchical: an operator passes a `require_role(USER, ...)` gate, an
admin passes both. Users in multiple panel groups resolve to the
most-permissive role.

To add a fourth role later, add the group→role mapping below, extend the
hierarchy ordering in `_RANK`, and ship a frontend update — there is no
in-app role authoring on purpose (would have meant maintaining a second
roles database, separate from lldap)."""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request

log = logging.getLogger("mc-panel.permissions")

ADMIN = "admin"
OPERATOR = "operator"
USER = "user"

# lldap group → mc-panel role. Update both this and `_RANK` to add a tier.
_GROUP_TO_ROLE = {
    "mc-admin": ADMIN,
    "mc-operator": OPERATOR,
    "mc-user": USER,
}

# Larger number = more permissive. `require_role(OPERATOR, ...)` passes for
# anyone with rank >= rank[OPERATOR].
_RANK = {USER: 1, OPERATOR: 2, ADMIN: 3}


def _parse_groups(header: str) -> list[str]:
    """Authelia forwards Remote-Groups as a comma-separated list."""
    return [g.strip() for g in header.split(",") if g.strip()]


def current_role(request: Request) -> str | None:
    """The user's effective role for this request, or None if they're in
    none of the panel groups (caller should turn that into a 403)."""
    user = request.headers.get("Remote-User", "").strip()
    if not user:
        return None
    groups = _parse_groups(request.headers.get("Remote-Groups", ""))
    matched = [_GROUP_TO_ROLE[g] for g in groups if g in _GROUP_TO_ROLE]
    if not matched:
        return None
    return max(matched, key=lambda r: _RANK[r])


def require_role(min_role: str, request: Request) -> str:
    """Raise 401 if no Remote-User, 403 if the user's role rank is below the
    requested minimum. Returns the Remote-User string on success — the
    existing endpoints all assign it to a `user` local for logging."""
    user = request.headers.get("Remote-User", "").strip()
    if not user:
        raise HTTPException(401, "missing Remote-User header")
    role = current_role(request)
    if role is None or _RANK[role] < _RANK[min_role]:
        raise HTTPException(
            403,
            f"role '{role or 'none'}' lacks permission (need '{min_role}' or higher)",
        )
    return user
