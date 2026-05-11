"""Three-tier role hierarchy + identity-provider group → role mapping.

This module is pure data + helpers — the request-side identity gates
(`current_role`, `require_role`) live in `auth.py`, which calls into these
helpers after extracting identity from whichever auth backend is active.

The three tiers (admin > operator > user) are hierarchical: an operator
passes a `require_role(USER, ...)` gate, an admin passes both. Users in
multiple panel groups resolve to the most-permissive role.

To add a fourth role later, add the group→role mapping below, extend the
hierarchy ordering in `_RANK`, and ship a frontend update — there is no
in-app role authoring on purpose (would have meant maintaining a second
roles database, separate from the identity provider)."""
from __future__ import annotations

import logging
import os

log = logging.getLogger("mc-panel.permissions")

ADMIN = "admin"
OPERATOR = "operator"
USER = "user"

# Group names are parameterized so deployments can use whatever role groups
# their identity provider already has (Authelia + lldap, Authentik, etc.).
# Defaults match the historical setup.
_ADMIN_GROUP = os.environ.get("MC_ADMIN_GROUP", "mc-admin").strip() or "mc-admin"
_OPERATOR_GROUP = os.environ.get("MC_OPERATOR_GROUP", "mc-operator").strip() or "mc-operator"
_USER_GROUP = os.environ.get("MC_USER_GROUP", "mc-user").strip() or "mc-user"

# Identity-provider group → mcpanel role. Update both this and `_RANK` to
# add a tier.
_GROUP_TO_ROLE = {
    _ADMIN_GROUP: ADMIN,
    _OPERATOR_GROUP: OPERATOR,
    _USER_GROUP: USER,
}

# Larger number = more permissive. `at_least(role, OPERATOR)` passes for
# anyone with rank >= rank[OPERATOR].
_RANK = {USER: 1, OPERATOR: 2, ADMIN: 3}


def parse_groups(header: str) -> list[str]:
    """Identity providers forward Remote-Groups as a comma-separated list."""
    return [g.strip() for g in header.split(",") if g.strip()]


def role_from_groups(groups: list[str]) -> str | None:
    """Most-permissive role across the user's group memberships, or None
    if the user belongs to no mapped group."""
    matched = [_GROUP_TO_ROLE[g] for g in groups if g in _GROUP_TO_ROLE]
    if not matched:
        return None
    return max(matched, key=lambda r: _RANK[r])


def at_least(role: str | None, minimum: str) -> bool:
    if not role:
        return False
    return _RANK[role] >= _RANK[minimum]
