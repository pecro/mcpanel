# mcpanel

A self-hostable web panel for running **multiple Minecraft worlds** on a
single Docker host. Each world is its own `itzg/minecraft-server`
container; mcpanel manages lifecycle, version, properties, players,
backups, and per-world JVM memory.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Image: ghcr.io/pecro/mcpanel](https://img.shields.io/badge/image-ghcr.io%2Fpecro%2Fmcpanel-blue)](https://github.com/pecro/mcpanel/pkgs/container/mcpanel)
[![CI](https://github.com/pecro/mcpanel/actions/workflows/docker.yml/badge.svg)](https://github.com/pecro/mcpanel/actions/workflows/docker.yml)

> **Status: pre-1.0.** Single-developer project, working but not yet
> hardened by external use. Issues and PRs welcome. Behaviour may shift
> between minor versions until `v1.0.0`.

---

## Why this exists

I wanted to hand a non-technical friend their own Minecraft server with
the same affordances a managed host (Realms, Apex, etc.) gives you —
versions, backups, whitelist, properties — without surrendering ops or
paying a subscription. The result is opinionated:

- **One Docker host, many worlds.** No agent/wings architecture. The
  panel speaks to a narrowly-scoped Docker socket proxy and spawns
  `itzg/minecraft-server` containers directly.
- **Tight `itzg` integration.** Worlds inherit `itzg`'s version handling,
  Mojang manifest lookup, RCON wiring, and EULA acceptance — mcpanel
  doesn't re-implement them.
- **Two-role co-admin model.** Designate someone an *operator*: they can
  run, restart, edit, and back up worlds without being able to delete
  anything or change panel-wide settings. Useful for "let a friend run
  their world without giving them keys to the host."

## Is this for you?

|                       | mcpanel | [Crafty Controller](https://craftycontrol.com/) | [Pterodactyl](https://pterodactyl.io/) | [AMP](https://cubecoders.com/AMP) |
|-----------------------|---------|-----|-----|-----|
| Multi-world           | ✅      | ✅  | ✅  | ✅  |
| Multi-game            | ❌ MC only | ✅  | ✅  | ✅  |
| Agent/node deploys    | ❌      | ❌  | ✅  | ✅  |
| Single Docker host    | ✅      | ✅  | ⚠️  | ⚠️  |
| `itzg/minecraft-server` native | ✅ | ❌ | ❌ | ❌ |
| External SSO (forward-auth) | ✅ | ⚠️ | ⚠️ | ⚠️ |
| License               | MIT     | GPL-3 | MIT | proprietary |

**mcpanel is for you if** you're already a Docker-on-a-VPS self-hoster,
you want to run a small number of Minecraft worlds, you trust the `itzg`
ecosystem, and you'd rather have one opinionated panel than a generic
game-hosting framework. **It's not for you if** you need multi-game
support, multi-node clustering, or per-customer tenancy.

## Quickstart

```bash
# 1. Grab the standalone compose
curl -O https://raw.githubusercontent.com/pecro/mcpanel/main/compose.yaml
curl -O https://raw.githubusercontent.com/pecro/mcpanel/main/.env.example
cp .env.example .env

# 2. Edit .env: set MC_DATA_ROOT to an absolute host path, set
#    MC_ADMIN_PASSWORD to your initial password, set MC_COOKIE_SECURE=false
#    if you're testing on plain http://localhost.
$EDITOR .env

# 3. Up
docker compose up -d
docker compose logs -f mcpanel
```

Open `http://localhost:8000`, sign in as `admin` with the password you
set, and create your first world. The bootstrap password gets bcrypt-
hashed into `auth-state.json` on first login — you can drop it from `.env`
after that and rotate it via **Admin → Admin password**.

For a real deployment behind TLS, put a reverse proxy in front (nginx,
Caddy, Traefik) and set `MC_COOKIE_SECURE=true`.

## Features

- **Multi-world.** Each world is its own container with its own data dir,
  port (from the configurable `MC_PORT_RANGE_START..END` range), and JVM
  memory cap.
- **Versions.** Pick from Mojang's official manifest (`LATEST` /
  `SNAPSHOT` / any specific release). Resolved version is read back from
  `level.dat` after the data-fixer runs; an `(upgrading…)` chip shows
  during the migration window.
- **Backups.** Nightly auto-backup with retention pruning. Operators can
  trigger ad-hoc backups, save **permanent named snapshots** (pinned,
  never pruned), edit metadata, and restore. Backups capture the world
  version at snapshot time.
- **Memory.** Admin sets the `[min, max]` GB window; per-world memory is
  picked inside it. Container cgroup limit auto-adds 1 GiB headroom over
  `-Xmx` to stop OOM kills.
- **Concurrency cap.** Admin-set max concurrent running worlds; START is
  gated server-side.
- **Live console + RCON.** Stream stdout/stderr; send commands.
- **Whitelist / ops.** Per-world editing of `whitelist.json` and
  `ops.json`.
- **Banner uploads.** PNG/JPG/WEBP/GIF, ≤ 10 MB, replaces the procedural
  hero card per world.
- **Per-world stats.** CPU + RAM usage chart, player join/leave timeline.
- **Imports.** Drop a world zip; mcpanel sniffs version + type, stages,
  and lets you commit as a new world.

## Auth

`AUTH_MODE` is required (no default — refuse-to-start otherwise):

### `AUTH_MODE=builtin` — single-admin password

bcrypt-hashed password gates access; sessions are signed cookies (TTL
configurable via `MC_SESSION_TTL_DAYS`, default 7). Everyone who signs in
is admin — multi-user with roles requires `forward-headers` mode.

Bootstrap with `MC_ADMIN_PASSWORD` (or `MC_ADMIN_PASSWORD_FILE` for
Docker secrets). Once you've signed in, the hash and the cookie-signing
secret are persisted to `auth-state.json` in your data dir; the env can
be removed. Rotate via **Admin → Admin password** with no restart.

### `AUTH_MODE=forward-headers` — SSO via upstream proxy

Identity comes from `Remote-User`; roles come from `Remote-Groups`,
mapped onto three panel tiers:

| Role | Can |
|---|---|
| admin | everything (incl. delete world / delete backup / change panel knobs) |
| operator | everything operational: start/stop, create world, edit properties, manage whitelist+ops, banner, run+pin+edit+restore backups, console |
| user | read-only: view worlds + stats, download backups, no mutations |
| (none) | 403 with a "request access" wall |

Group names default to `mc-admin` / `mc-operator` / `mc-user`; override
via `MC_ADMIN_GROUP` / `MC_OPERATOR_GROUP` / `MC_USER_GROUP` to match
whatever your identity provider already has. Works with any forward-auth
proxy that sets `Remote-User` + `Remote-Groups` — Authelia, Authentik,
Pocket-ID, etc. **Do not run this mode without a proxy in front** — the
panel trusts headers it receives, and direct external traffic could
forge them.

### CSRF

State-changing requests (POST / PUT / PATCH / DELETE under `/api/`)
require a matching `X-CSRF-Token` header. mcpanel sets a non-HttpOnly
`mcpanel_csrf` cookie that the SPA reads and echoes back. Enforced in
both auth modes.

### Dev escape hatch

`MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true` skips auth entirely —
every request becomes `admin@anonymous`. Localhost dev only; **never**
expose to a real network. mcpanel logs a loud warning on boot.

## Configuration

All env vars live on the `mcpanel` service in `compose.yaml`. Defaults
shown in parentheses.

### Required

| Var | Purpose |
|---|---|
| `AUTH_MODE` | `builtin` or `forward-headers`. No default. |
| `MC_DATA_ROOT` | Absolute host path where mcpanel stores worlds, backups, imports. Must be writable by `PUID:PGID`. |

### Required in built-in mode (first boot only)

| Var | Purpose |
|---|---|
| `MC_ADMIN_PASSWORD` | Bootstrap admin password. Removed after first sign-in once the hash lands in `auth-state.json`. |
| `MC_ADMIN_PASSWORD_FILE` | Alternative: path to a file containing the password (Docker secrets). `_FILE` wins if both are set. |

### Auth tuning

| Var | Purpose |
|---|---|
| `MC_SESSION_TTL_DAYS` | Built-in session lifetime (`7`). |
| `MC_COOKIE_SECURE` | Sets `Secure` flag on session + CSRF cookies (`true`). Set `false` only for local-dev HTTP. |
| `MC_ADMIN_GROUP` / `MC_OPERATOR_GROUP` / `MC_USER_GROUP` | Identity-provider group names mapped to the three roles. Forward-headers mode only. (`mc-admin` / `mc-operator` / `mc-user`) |
| `MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED` | Dev escape hatch — every request becomes admin@anonymous when `true`. |

### Path / network

| Var | Purpose |
|---|---|
| `MC_HOST_DATA_ROOT` / `MC_CONTAINER_DATA_ROOT` | Split form of `MC_DATA_ROOT`. Use when the host path and the in-container path can't be identical (Docker Desktop file sharing, Podman, userns-remapped rootless Docker). Either alone overrides its side of `MC_DATA_ROOT`. |
| `MC_PORT_RANGE_START` / `MC_PORT_RANGE_END` | Host port range allocator picks from (`35550` / `35559`). |
| `MINECRAFT_HOSTNAME` | Connect string shown on world pages. If unset, mcpanel uses the request `Host` header. |
| `DOCKER_HOST` | Where to reach the socket proxy (`tcp://mcpanel-socket-proxy:2375`). |
| `DOCKER_NETWORK` | Network world containers join (default `mcpanel_default`). |

### World defaults

| Var | Purpose |
|---|---|
| `MC_DEFAULT_VERSION` | Default version env on new worlds (`LATEST`). |
| `MC_DEFAULT_TYPE` | Default server type (`VANILLA`; also accepts `PAPER` / `FABRIC` / `FORGE`). |
| `MC_RCON_PASSWORD` | Applied to every world container; reachable only on the docker network. |
| `MC_BACKUP_HOUR` | Daily backup runs at this local hour, 24h (`3`). |
| `MC_BACKUP_RETENTION_DAYS` | Retention sweep TTL; permanent snapshots are exempt (`7`). |
| `APPRISE_URL` | Optional. POST endpoint for multi-awake watchdog notifications. |
| `PUID` / `PGID` | Container runs as this UID:GID; matches the itzg `UID`/`GID` env so file ownership is consistent. |
| `TZ` | Timezone for the backup scheduler. |

## Data layout

Everything lives under `${MC_DATA_ROOT}` (or `${MC_CONTAINER_DATA_ROOT}`
when set):

```
${MC_DATA_ROOT}/
├── worlds/             # one dir per world — itzg writes here
│   └── <name>/         #   ↳ world data, server.properties, whitelist, ops
├── backups/            # zip-per-snapshot, organized by world
│   └── <name>/
├── imports/            # drop-zone for world uploads pending commit
├── .staging/           # transient extract space for in-progress imports
├── admin-config.json   # operator-tunable settings (memory bounds, concurrency cap)
└── auth-state.json     # bcrypt password hash + session secret (built-in mode), 0600
```

`admin-config.json` schema (written via the admin UI):

```json
{
  "world_memory_min_gb": 4,
  "world_memory_max_gb": 4,
  "max_concurrent_worlds": 1
}
```

Hard ceilings enforced server-side regardless of file contents:
`world_memory` is `[1, 32]` GB; `max_concurrent_worlds` is `[1, 16]`.

## API surface

All endpoints under `/api/v1/`. Auth depends on the active backend
(session cookie in built-in mode; `Remote-User` + `Remote-Groups` in
forward-headers mode). CSRF is enforced on every mutation in both modes.

**Read-only** (user+):
`GET /me`, `/auth/status`, `/state`, `/worlds`, `/worlds/{n}`,
`/worlds/{n}/banner`, `/worlds/{n}/usage`,
`/worlds/{n}/backups/{f}` (download), `/worlds/{n}/export`, `/players`,
`/jobs`, `/jobs/{id}`, `/backups`, `/imports/{id}`, `/mc-versions`,
`/admin/config`.

**Mutate** (operator+):
`POST /worlds` (create), `/worlds/{n}/start|stop|upgrade`,
`PATCH /worlds/{n}/properties`, `/worlds/{n}/memory`,
`POST /worlds/{n}/whitelist`, `DELETE /worlds/{n}/whitelist/{p}`,
`POST /worlds/{n}/ops/toggle`, `POST /worlds/{n}/banner` + `DELETE`,
`POST /worlds/{n}/backups` (ad-hoc / named snapshot),
`PATCH /backups/{w}/{f}` (rename / repin),
`POST /worlds/{n}/restore`, `GET /worlds/{n}/console` (live log SSE),
`POST /worlds/{n}/rcon`, imports/* upload + commit.

**Admin-only**:
`POST /worlds/{n}/delete`, `DELETE /backups/{w}/{f}`,
`PATCH /admin/config`, `POST /auth/change-password`,
`POST /auth/login`, `POST /auth/logout`.

Long-running mutations (create / start / stop / upgrade / backup) return
`202 { job_id }`; the SPA polls `GET /jobs/{id}` until terminal.
Single-flight per `(kind, target)` — a 409 carries the existing job's id
so the client can attach to the in-flight operation.

## Architecture

```
                       Internet
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
  :443 (your TLS         :35550…:35559    other apps
  reverse proxy)         (game ports
       │                  on host)
       ▼
   ┌─────────┐
   │ mcpanel │◀──── ${MC_DATA_ROOT}/worlds/<name>  (bind mounted)
   │ (uvicorn│      ${MC_DATA_ROOT}/backups/...
   │  + Vite │◀──── auth-state.json  (built-in mode)
   │  SPA)   │      admin-config.json
   └────┬────┘
        │ Docker API (narrowed by socket proxy)
        ▼
   ┌───────────┐    spawns    ┌──────────────────────┐
   │ docker-   │ ─────────────▶│ itzg/minecraft-server│ × N worlds
   │ socket-   │              │   labeled .managed   │
   │ proxy     │              │   bind mounts world  │
   └───────────┘              │   data from host     │
                              └──────────────────────┘
```

mcpanel itself never touches `/var/run/docker.sock` directly. The socket
proxy is configured to allow `CONTAINERS`, `IMAGES`, `NETWORKS`, `INFO`,
`VERSION`, `POST` — anything outside that allowlist is denied.

The panel **observes** existing world containers by the
`mc-panel.managed=true` Docker label; spawned worlds get
`mc-panel.managed`, `mc-panel.world=<name>`, `mc-panel.port=<port>`
labels at create time. These label names are stable across releases —
upgrading the panel image never orphans existing worlds.

## Repo layout

```
.
├── app/                      # FastAPI backend
│   ├── main.py               #   ASGI app, lifespan, SPA static fallback
│   ├── api.py                #   all /api/v1/* endpoints
│   ├── auth.py               #   AUTH_MODE selection + request gates
│   ├── auth_state.py         #   bcrypt hash + session secret persistence
│   ├── csrf.py               #   double-submit cookie middleware
│   ├── permissions.py        #   role hierarchy + group→role mapping
│   ├── admin_config.py       #   admin-config.json schema + IO
│   ├── docker_client.py      #   Docker SDK wrapper (via socket proxy)
│   ├── world.py              #   per-world fs ops (properties, whitelist, ops)
│   ├── backup.py             #   zip-based snapshots + nightly scheduler
│   ├── jobs.py               #   single-flight long-running mutation tracker
│   ├── level_dat.py          #   NBT parsing for resolved_version
│   ├── rcon.py               #   RCON client
│   ├── players.py            #   known-players cache
│   ├── usage.py              #   CPU/RAM sampling + container event tail
│   └── watchdog.py           #   dual-awake notifier
├── web/                      # Vite + React + Tailwind SPA
│   └── src/
│       ├── App.tsx           #   routes (incl. /login)
│       ├── api/              #   client + types + TanStack Query hooks
│       ├── components/       #   chrome (top bar, left rail), atoms
│       └── pages/            #   Home, WorldOverview, Console, Backups,
│                             #   Admin, Login, Import, NewWorld, ...
├── compose.yaml              # single-host standalone compose
├── .env.example
├── Dockerfile                # multi-stage: node build → python runtime
└── requirements.txt
```

## Development

Two-terminal setup:

```bash
# Terminal 1 — backend with reload
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — Vite dev server with HMR
cd web && npm install && npm run dev    # opens on :5173
```

The Vite dev server proxies `/api/*` to the backend (see
`web/vite.config.ts`). For the panel to accept requests during dev:

- **Built-in mode**: set `AUTH_MODE=builtin` and `MC_ADMIN_PASSWORD=...`,
  set `MC_COOKIE_SECURE=false` (HMR is HTTP), then sign in normally.
- **Forward-headers mode**: set `Remote-User` and `Remote-Groups` via a
  browser extension (e.g. ModHeader), OR set
  `MC_PANEL_I_KNOW_THIS_IS_UNAUTHENTICATED=true` to skip auth entirely
  for local iteration.

The Docker SDK still needs a socket somewhere — easiest is to run
`docker compose up -d mcpanel-socket-proxy` in a third terminal and
point the backend at it with `DOCKER_HOST=tcp://127.0.0.1:2375` after
publishing the proxy's port.

Type-check before committing:

```bash
cd web && npm run typecheck
```

## Known gotchas

- **Container cgroup needs +1 GiB headroom over JVM heap.** `itzg`'s
  `MEMORY` env sets `-Xmx` (heap), but a busy MC server's JIT cache,
  metaspace, direct buffers, and thread stacks add 500 MB – 1 GB on top.
  Without headroom the kernel OOM-kills the JVM mid-tick. mcpanel adds
  it automatically (`docker_client.py:_container_mem_limit_bytes`);
  don't remove.
- **Host data path must equal the in-container path.** mcpanel passes
  paths it can read locally to Docker as bind-mount sources. On Docker
  Desktop / Podman / rootless Docker the two can differ — use
  `MC_HOST_DATA_ROOT` + `MC_CONTAINER_DATA_ROOT` instead of the
  single-value `MC_DATA_ROOT`.
- **Container runs as `${PUID}:${PGID}`** (default 1000:1000). `itzg`
  containers run as the same IDs (via the `UID`/`GID` env). Don't switch
  the panel to root or files written by `itzg` become unreadable.
- **Concurrent-cap is checked on `/start` only.** Upgrade and resize
  bypass the check because they replace one running instance with
  another (no new slot consumed). Don't propagate the check to those
  paths or you'll deadlock any single-cap instance during upgrade.

## Releases

`:vX.Y.Z` for tagged releases (immutable), `:X.Y` for the latest patch,
`:latest` for the most recent release, `:main` for the rolling default
branch, `:<short-sha>` for pinning to a specific commit. Multi-arch
(`linux/amd64` + `linux/arm64`).

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE).
