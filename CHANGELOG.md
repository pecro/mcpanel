# Changelog

All notable changes to mcpanel are recorded here. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-11

First public release. Extracted from a private monorepo; cleaned up and
re-licensed as MIT.

### Added
- **Selectable auth backend** via `AUTH_MODE`:
  - `builtin` — single-admin password + signed-cookie sessions. Bootstrap
    with `MC_ADMIN_PASSWORD` (or `MC_ADMIN_PASSWORD_FILE` for Docker
    secrets); password is bcrypt-hashed and persisted to `auth-state.json`
    on first boot. Rotate via the in-app **Admin → Admin password** form
    without restart.
  - `forward-headers` — trusts `Remote-User` / `Remote-Groups` from an
    upstream proxy (Authelia, Authentik, Pocket-ID, ...). Maps groups onto
    the three panel tiers via `MC_ADMIN_GROUP` / `MC_OPERATOR_GROUP` /
    `MC_USER_GROUP`.
- CSRF middleware (double-submit cookie) on all state-changing `/api/`
  endpoints, enforced in both auth modes.
- Refuse-to-start guardrail at boot: missing `AUTH_MODE`, or
  `AUTH_MODE=builtin` without any password material, aborts with a
  helpful error. Override `MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true`
  for local dev (every request becomes `admin@anonymous`).
- Split host / container data paths: `MC_HOST_DATA_ROOT` and
  `MC_CONTAINER_DATA_ROOT` for setups where the panel container can't
  bind-mount the host data dir at the same path (Docker Desktop, Podman,
  userns-remapped rootless Docker). The single-value `MC_DATA_ROOT` still
  works for the simple Linux Docker case.
- Multi-arch images: `linux/amd64` and `linux/arm64`.
- `:latest` tag tracks the most recent release; `:main` tracks the
  default branch; `:vX.Y.Z`, `:X.Y.Z`, `:X.Y` for tagged releases;
  `:<short-sha>` for pinning to a specific commit.

### Changed
- Hostname env (`MINECRAFT_HOSTNAME`) is now optional. When unset, the
  UI uses the request `Host` header for the player connect string.
- Identity-provider group names are now configurable. Defaults remain
  `mc-admin` / `mc-operator` / `mc-user`.

### Carryover from the prior internal version
- Multi-world manager built on top of `itzg/minecraft-server`.
- Per-world: lifecycle (start/stop/upgrade/delete), `server.properties`
  editor, whitelist/ops, live console, RAM/CPU usage chart, banner
  image, RCON.
- Backups: nightly auto with retention pruning, ad-hoc + permanent
  named snapshots, restore.
- JVM heap and concurrent-worlds limits enforced server-side; container
  cgroup adds 1 GiB headroom on top of `-Xmx` to prevent OOM kills.

[Unreleased]: https://github.com/pecro/mcpanel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pecro/mcpanel/releases/tag/v0.1.0
