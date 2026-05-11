# mcpanel

A self-hostable web panel for running multiple Minecraft servers on a single
host. Designed to give a non-technical user full ownership of "their" server
while keeping the host operator out of the loop for day-to-day ops, with
admin-only knobs reserved for the operator of the host.

> **Status:** early extraction from a private monorepo. The current release
> still assumes a forward-auth proxy (Authelia / Authentik / etc.) is in
> front, setting `Remote-User` / `Remote-Groups` headers. A built-in
> single-admin auth mode is planned. See the [roadmap](#roadmap).

## What it does

- **Multi-world**: spin up an arbitrary number of Minecraft worlds. Each one is
  a separate `itzg/minecraft-server` container with its own world dir, port,
  RCON, and lifecycle.
- **Web admin** at `https://mcpanel.example.com`. Per-world detail page with
  whitelist/op management, properties editor, banner image, version chip, live
  console, and a usage chart (RAM/CPU over time).
- **Game ports** published directly on the host (`35550-35559`); players
  connect via `mcpanel.example.com:<port>`.
- **Versions**: pick from Mojang's official manifest (`LATEST` / `SNAPSHOT` /
  any specific release). The version chip auto-updates after Minecraft's
  data-fixer rewrites `level.dat`, with an `(upgrading…)` badge during the
  migration window so users know to wait.
- **Backups**: nightly auto with retention pruning. Operators can also
  trigger ad-hoc backups, save **named permanent snapshots** (pinned, never
  pruned), edit metadata, and restore. Backups capture the world version at
  snapshot time. Delete is admin-only.
- **Memory**: per-world JVM heap with admin-set bounds (`world_memory_min_gb`
  / `world_memory_max_gb`). Container cgroup limit auto-adds 1 GiB headroom
  to stop OOM kills (lesson learned).
- **Concurrency cap**: admin-set max concurrent running worlds (default 1).
  START is gated server-side; SPA pre-disables the button when at cap.
- **Three-tier role gate** keyed off lldap groups Authelia forwards:
  `mc-admin > mc-operator > mc-user`. Backend decorators are the source of
  truth; SPA hides controls users can't use.
- **Banner uploads** per world (PNG/JPG/WEBP/GIF, ≤10 MB) replace the
  procedural sky+landscape on the hero card.

## Architecture

```
                     Internet
        ┌──────────────┼─────────────────────┐
        ▼              ▼                     ▼
   :443 (Traefik)   :35550…:35559     other selhost services
        │              │
        │              ▼
        │         mc-<world1>, mc-<world2>, …    ← itzg/minecraft-server
        │         per-world container, per-world world dir
        │              ▲
        ▼              │ docker create/start/stop/remove (narrow API)
   mc-panel ───► docker-socket-proxy ───► /var/run/docker.sock
   (FastAPI + React SPA)                  on the host
        │
        ▼
   bind mount ${MC_DATA_ROOT}
       worlds/<name>/        ← world data (level.dat, server.properties, etc.)
       backups/<name>/       ← .zip + .meta.json sidecar pairs
       imports/              ← uploaded zips waiting on staging
       admin-config.json     ← admin's bounds + concurrency cap
```

### Components in production

| Container | Image | Purpose |
|---|---|---|
| `mc-panel` | built locally from `Dockerfile` | FastAPI backend + Vite-built React SPA, single image |
| `mc-panel-socket-proxy` | `tecnativa/docker-socket-proxy` | Mediates the panel's Docker API calls; allowlist is `CONTAINERS=1 IMAGES=1 NETWORKS=1 INFO=1 VERSION=1 POST=1` |
| `mc-<world>` | `itzg/minecraft-server:latest` | One per world. The panel creates/starts/stops/removes these. |

The panel never touches `/var/run/docker.sock` directly — the socket proxy is
the security boundary.

### Tech stack

**Backend** — FastAPI + uvicorn, Python 3.13, deps in `requirements.txt`:
- `docker` SDK for container ops via the socket proxy
- `httpx` for Mojang manifest + Mojang username→UUID lookups
- `nbt` for parsing `level.dat` (extracts the resolved MC version)
- `python-multipart` for upload endpoints
- No database — state lives on disk (world dirs, backup sidecars, JSON config)

**Frontend** — `web/` is a Vite + React 18 SPA:
- `@tanstack/react-query` v5 for server state
- `react-router-dom` v7 for routing
- `react-hook-form` + `zod` for forms
- `tailwindcss` v3 for styling, custom palette in `web/src/styles/`
- TypeScript

**Build** — single multi-stage Dockerfile:
1. `node:22-alpine` builds the SPA (`npm ci && npm run build` → `dist/`)
2. `astral-sh/uv:python3.13-bookworm-slim` installs Python deps, copies the
   built SPA into `/srv/app/web_dist`, and runs `python -m app.main`

## Repo layout

```
apps/mc-panel/                  ← top of the new repo when extracted
├── Dockerfile                  multi-stage web + python build
├── README.md                   this file
├── requirements.txt            Python deps (will likely move to pyproject)
├── compose.yaml                deployment definition (selhost-style today)
├── app/                        Python backend (~3,000 lines)
│   ├── main.py                 uvicorn entrypoint, mounts SPA at /, routes /api/v1/*
│   ├── api.py                  every HTTP endpoint (1,100 lines — the bulk of behaviour)
│   ├── permissions.py          three-tier role gate from Remote-Groups header
│   ├── admin_config.py         persisted admin bounds (memory range, concurrency cap)
│   ├── docker_client.py        wraps the Docker SDK; container create/start/stop/recreate
│   ├── world.py                world dir layout, name validation, banner storage,
│   │                           import staging, level.dat helpers, archive on delete
│   ├── backup.py               zip + RCON-flush + sidecar metadata + retention pruning
│   ├── jobs.py                 in-memory single-flight job queue with TTL
│   ├── usage.py                per-world RAM/CPU sampling + ring buffer
│   ├── rcon.py                 minimal RCON client for save-flush + console
│   ├── players.py              cross-world UUID/name registry for whitelist autocomplete
│   ├── watchdog.py             optional Apprise notifications on multi-awake events
│   ├── level_dat.py            NBT parsing, only what the panel needs
│   └── config.py               env-var driven settings, DATA_ROOT layout
└── web/                        React SPA
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx, App.tsx       router + chrome shell
        ├── api/                    fetch wrappers, query hooks, types
        │   ├── client.ts           api.{get,post,patch,del}, runJob, uploadWithProgress
        │   ├── queries.ts          one hook per endpoint group (~600 lines)
        │   └── types.ts            mirrors the JSON shapes from app/api.py
        ├── pages/                  route components
        │   ├── Home.tsx            featured-world hero + tabs
        │   ├── NewWorld.tsx        create form
        │   ├── WorldFrame.tsx      per-world shell (hero + sidebar cards + tabs)
        │   ├── WorldOverview.tsx
        │   ├── WorldUsage.tsx      RAM/CPU chart with window picker
        │   ├── Backups.tsx         cross-world backup list with edit/pin/restore
        │   ├── Console.tsx         live RCON console (operator+)
        │   ├── Import.tsx          two-step import-confirm flow
        │   └── Admin.tsx           admin-only knobs (memory bounds + concurrency cap)
        ├── components/
        │   ├── chrome/             TopBar (with role chip), LeftRail, Chrome shell
        │   ├── world/              ConnectHero, Sidebar cards, DangerCard, MemoryCard,
        │   │                       PropertiesCard, PlayersCard, BackupsCard, LiveConsole
        │   ├── home/               Hero, HomeTabs, AwakeWarning, CreateWorldForm,
        │   │                       ImportDialog
        │   ├── art/                HeroBand (procedural sky+landscape, accepts banner override)
        │   └── ui/                 Button, Field, atoms (Card, KeyValue, etc.)
        └── hooks/                  useClipboard, useDebounce
```

## Auth model

Identity comes from Authelia via the `Remote-User` header. Roles come from
**lldap groups** Authelia forwards in `Remote-Groups`:

| lldap group | Role | Can |
|---|---|---|
| `mc-admin` | admin | everything (incl. delete world / delete backup / change panel knobs) |
| `mc-operator` | operator | everything operational: start/stop, create world, edit properties, manage whitelist+ops, banner, run+pin+edit+restore backups, console |
| `mc-user` | user | read-only: view worlds + stats, download backups, no mutations |
| (none) | — | 403 with a "request access" wall |

Hierarchy is enforced server-side by `app/permissions.py:require_role`.
Most-permissive group wins for users in multiple. There is **no in-app role
authoring** by design — adding a fourth tier means adding the lldap group and
extending the `_GROUP_TO_ROLE` map.

The frontend reads `/api/v1/me` (`useMe()`) for `{user, role, can}` and hides
controls users can't use; the backend decorator is the source of truth.

## External dependencies (what mc-panel needs from its host)

These don't need to be in the same repo, but the panel doesn't run without
them.

1. **Docker daemon** — the host's Docker daemon, mediated through
   `tecnativa/docker-socket-proxy`. The proxy must allowlist
   `CONTAINERS,IMAGES,NETWORKS,INFO,VERSION,POST` (see `compose.yaml`).
2. **Reverse proxy with TLS** — Traefik in selhost-main, routed via the
   `authelia@docker` middleware. Any reverse proxy that adds `Remote-User`
   and `Remote-Groups` headers from an OIDC/SSO source will work.
3. **Authelia + LLDAP** (or any equivalent) for identity and the three
   panel groups.
4. **Bind-mount path** under `${MC_DATA_ROOT}` — defaults to
   `/data/minecraft`. The path must be **identical inside the panel
   container and on the docker daemon's host filesystem** because the panel
   asks Docker to bind-mount paths it can also read locally.

## Configuration

### Environment variables

Defined on the `mc-panel` service in `compose.yaml`. Defaults shown in
parentheses where applicable.

| Var | Purpose |
|---|---|
| `MC_DATA_ROOT` | Root for worlds/, backups/, imports/, admin-config.json (`/data/minecraft`) |
| `MC_PORT_RANGE_START` / `MC_PORT_RANGE_END` | Host port range allocator picks from |
| `MINECRAFT_HOSTNAME` | Connect string shown on world pages, also the Traefik routing host |
| `MC_DEFAULT_VERSION` | Default version env for new worlds (`LATEST`) |
| `MC_DEFAULT_TYPE` | Default server type (`VANILLA`; also accepts `PAPER`/`FABRIC`/`FORGE`) |
| `MC_RCON_PASSWORD` | Applied to every world container; reachable only on the docker network |
| `MC_BACKUP_HOUR` | Daily backup runs at this local hour, 24h (`3`) |
| `MC_BACKUP_RETENTION_DAYS` | Retention sweep TTL; permanent snapshots are exempt (`7`) |
| `MC_PANEL_APPRISE_URL` | Optional. POST endpoint for multi-awake watchdog notifications |
| `DOCKER_HOST` | Where to reach the socket proxy (`tcp://mc-panel-socket-proxy:2375`) |
| `DOCKER_NETWORK` | Network world containers join (so RCON over the docker network works) |
| `PUID` / `PGID` | Container runs as this UID:GID; matches the itzg `UID`/`GID` env so file ownership is consistent |
| `TZ` | Timezone for backup scheduler |

### Persisted admin config (`${MC_DATA_ROOT}/admin-config.json`)

Written via the admin UI. Schema:

```json
{
  "world_memory_min_gb": 4,
  "world_memory_max_gb": 4,
  "max_concurrent_worlds": 1
}
```

Hard ceilings enforced server-side regardless of file contents:
`world_memory` is `[1, 32]` GB; `max_concurrent_worlds` is `[1, 16]`.
Missing or malformed file falls back to defaults that match historical
behaviour (4 GB locked, 1 concurrent).

## Data layout on disk

Everything lives under `${MC_DATA_ROOT}` (host path bind-mounted into the
panel as the same path):

```
/data/minecraft/                         (= ${MC_DATA_ROOT})
├── admin-config.json                    panel-wide knobs
├── worlds/
│   └── <world-name>/                    bind-mounted into mc-<world-name> as /data
│       ├── server.properties            panel writes policy keys, leaves rest alone
│       ├── world/level.dat              feeds resolved_version chip
│       ├── whitelist.json, ops.json     panel reads + writes
│       └── .panel/
│           └── banner.{png,jpg,webp,gif} optional uploaded banner
├── backups/
│   └── <world-name>/
│       ├── YYYY-MM-DD_HHMMSS.zip
│       └── YYYY-MM-DD_HHMMSS.zip.meta.json   sidecar — display_name, description,
│                                              permanent, world_version, created_by,
│                                              created_at_ms
├── imports/                             optional. Pre-staged upload sources
└── .staging/                            in-progress uploads, garbage-collected
```

The `.panel/` per-world directory is dot-prefixed so it never collides with
files Minecraft writes. Same convention for `.staging/` and `.meta.json`
sidecars.

## API surface

All endpoints under `/api/v1/`. Authelia's middleware adds `Remote-User` and
`Remote-Groups`; the panel doesn't issue its own auth.

Read-only (mc-user+):
- `GET /me`, `/state`, `/worlds`, `/worlds/{n}`, `/worlds/{n}/banner`,
  `/worlds/{n}/usage`, `/worlds/{n}/backups/{f}` (download),
  `/worlds/{n}/export`, `/players`, `/jobs`, `/jobs/{id}`, `/backups`,
  `/imports/{id}`, `/mc-versions`, `/admin/config`

Mutate (mc-operator+):
- `POST /worlds` (create), `/worlds/{n}/start|stop|upgrade`,
  `PATCH /worlds/{n}/properties`, `/worlds/{n}/memory`,
  `POST /worlds/{n}/whitelist`, `DELETE /worlds/{n}/whitelist/{p}`,
  `POST /worlds/{n}/ops/toggle`, `POST /worlds/{n}/banner` + `DELETE`,
  `POST /worlds/{n}/backups` (run / save snapshot),
  `PATCH /backups/{w}/{f}` (rename / repin), `POST /worlds/{n}/restore`,
  `GET /worlds/{n}/console` (RCON), `POST /worlds/{n}/rcon`,
  imports/* upload + commit

Admin-only (mc-admin):
- `POST /worlds/{n}/delete`, `DELETE /backups/{w}/{f}`,
  `PATCH /admin/config`

Single-flight job submission for long-running mutations: handlers return
`202 { job_id }` and the SPA polls `GET /jobs/{id}` via `runJob()`. 10-min
TTL in `app/jobs.py` (process-local — restart loses in-flight state, but
Docker is the source of truth).

## Development workflow

The current setup deploys the production build only — no in-tree dev mode.
For active iteration, two-terminal:

```bash
# Terminal 1: backend with hot reload
cd app
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: frontend Vite dev server
cd web
npm run dev   # opens on :5173 with HMR
```

Configure Vite to proxy `/api/*` to `http://127.0.0.1:8000` so cookies +
the `Remote-User` mock header survive. (This proxy isn't checked in yet —
add it to `web/vite.config.ts`'s `server.proxy` when extracting.)

For real auth during dev, either:
- (a) Set `Remote-User` and `Remote-Groups` headers in your browser via an
  extension and skip Authelia, OR
- (b) Run a local minimal Authelia stub.

## Deployment in selhost-main today

`apps/mc-panel/compose.yaml` defines two services in the `mc-panel` profile.
Inclusion in `compose.yaml` at the repo root, plus `MINECRAFT_HOSTNAME` in
`.env`, plus `mc-panel` in `COMPOSE_PROFILES`. Authelia rule is in
`apps/authelia/config/configuration.yml`:

```yaml
- domain: '{{ env "TEMPLATE_MINECRAFT_HOSTNAME" }}'
  policy: 'one_factor'
  subject:
    - ['group:admins']
    - ['group:minecraft-admins']  # legacy; retire after the cutover
    - ['group:mc-admin']
    - ['group:mc-operator']
    - ['group:mc-user']
```

DNS for `mcpanel.example.com` is in the `cloudflare-ddns` DOMAINS list
(public A record) plus mirrored to the LAN dnsmasq via the
`scripts/add-lan-host` helper for hairpin-NAT-free internal access.

## Roadmap

The repo was just extracted from a private monorepo (`selhost-main`); it
still carries assumptions from that environment. Planned in rough order:

1. Parameterize: forward-auth group names, optional hostname, split
   host/container data paths.
2. Built-in single-admin auth mode (`AUTH_MODE=builtin`) so the panel works
   without an upstream forward-auth proxy. CSRF middleware on
   state-changing endpoints. Refuse-to-start guardrail when unauthenticated.
3. Public-facing README rewrite, multi-arch GHCR builds, semver release
   tags, `v0.1.0`.

## Known gotchas

- **Container cgroup needs +1 GiB headroom over JVM heap.** itzg's `MEMORY`
  env sets `-Xmx` (heap), but a busy MC server's JIT cache, metaspace,
  direct buffers, and thread stacks add 500 MB – 1 GB on top. Without
  headroom the kernel OOM-kills the JVM mid-tick. `docker_client.py:
  _container_mem_limit_bytes` adds it; don't remove.
- **WAL-mode SQLite reads.** mc-panel doesn't use SQLite, but its sidecar
  consumers (Beszel via the docker socket) sometimes expose stale data.
  Anywhere the panel grows DB-backed state, copy `*.db` + `*.db-wal` +
  `*.db-shm` together when reading from outside the writer process.
- **Sub-second start jobs miss `useActiveJob`'s 1.5s poll.** The
  `useStartWorld` mutation does its own `useDelayedInvalidate` (3s/8s/20s)
  so world detail catches the post-migration `level.dat` even when
  `useActiveJob` never observed the job in flight. See
  `web/src/api/queries.ts:useDelayedInvalidate`.
- **`(upgrading…)` chip narrowness.** Only `useUpgradeWorld` marks the
  migrating flag, not `useStartWorld` — otherwise every routine start of a
  world that didn't need migration would falsely advertise as upgrading
  for 25s. See the same file's `useMarkMigrating`.
- **Authelia gates the SPA shell at `/`, the admin panel at `/_/`, but
  `/api/*` should NOT be Authelia-gated** for PocketBase-style apps. mc-
  panel's API doesn't have this issue (everything goes through Authelia
  fine), but if you ever stand up a sibling panel that's PocketBase-based,
  remember the lesson — Beszel ran into this.
- **Container runs as `${PUID}:${PGID}` (1000:1000).** itzg's containers
  also run as those IDs (via `UID`/`GID` env). Files written by either side
  match. Don't switch the panel to root or itzg-created files become
  unreadable from the panel.
- **Concurrent-cap is checked on `/start` only.** Upgrade and resize bypass
  the check because they replace one running instance with another (no new
  slot consumed). Don't add the check to those paths or you'll deadlock
  any single-cap instance during upgrade.

## Reference: features by commit

If you want context on why something is shaped a particular way, the git log
in selhost-main has commit-by-commit narrative since this panel's v2
rewrite. Search for `mc-panel:` prefixed commits.
