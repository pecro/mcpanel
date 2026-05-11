import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { api, runJob } from './client';
import type {
  AdminConfig,
  AppState,
  BackupIndexEntry,
  Job,
  McVersionsResponse,
  Me,
  StagingResponse,
  WorldDetail,
} from './types';

const STATE_KEY = ['state'] as const;
const worldKey = (name: string) => ['world', name] as const;

export function useAppState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: () => api.get<AppState>('/api/v1/state'),
  });
}

const ME_KEY = ['me'] as const;

export function useMe() {
  // Identity + role + permission flags. The 403 case (authenticated user
  // not in any panel group) surfaces as ApiError 403 — components consume
  // `data` for the happy path and `error` to render the no-access wall.
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.get<Me>('/api/v1/me'),
    // Role rarely changes mid-session; cache aggressively.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

const MC_VERSIONS_KEY = ['mc-versions'] as const;

export function useMcVersions() {
  return useQuery({
    queryKey: MC_VERSIONS_KEY,
    queryFn: () => api.get<McVersionsResponse>('/api/v1/mc-versions'),
    // Server caches for an hour anyway; client cache for the session is fine.
    staleTime: Infinity,
  });
}

export function useWorld(name: string | undefined) {
  return useQuery({
    queryKey: worldKey(name ?? ''),
    queryFn: () => api.get<WorldDetail>(`/api/v1/worlds/${name}`),
    enabled: !!name,
  });
}

const KNOWN_PLAYERS_KEY = ['known-players'] as const;

export function useKnownPlayers() {
  return useQuery({
    queryKey: KNOWN_PLAYERS_KEY,
    queryFn: () => api.get<{ uuid: string; name: string }[]>('/api/v1/players'),
  });
}

// Active job for a single world. Polls every 1.5s while the page is open
// so a start/stop/delete kicked off in another tab — or before a refresh
// — still surfaces as an in-flight state on this tab. Returns null when
// nothing is in flight.

const activeJobKey = (name: string) => ['active-job', name] as const;

export function useActiveJob(name: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: activeJobKey(name ?? ''),
    queryFn: async () => {
      const list = await api.get<Job[]>(
        `/api/v1/jobs?target=${encodeURIComponent(name!)}`,
      );
      return list[0] ?? null;
    },
    enabled: !!name,
    refetchInterval: 1500,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  // When a job transitions from in-flight to gone, the world's actual
  // state (running / exited) likely just changed too. Invalidate world
  // detail + global state so the UI reflects post-job reality without
  // waiting for staleTime to expire.
  //
  // Delayed re-invalidations after start: Minecraft writes level.dat
  // (which feeds resolved_version) some seconds AFTER the JVM starts
  // accepting connections — and longer still on a world being migrated
  // from an old MC version. The first invalidation right after the job
  // ends would refetch a stale level.dat. Schedule a few more refreshes
  // over the next ~30s so the version chip catches up without forcing
  // the user to reload.
  const prev = useRef<Job | null>(null);
  useEffect(() => {
    const current = query.data ?? null;
    const finished = prev.current;
    if (finished && !current && name) {
      qc.invalidateQueries({ queryKey: worldKey(name) });
      qc.invalidateQueries({ queryKey: STATE_KEY });
      // Catch the post-migration level.dat write for start + upgrade
      // jobs; harmless extra refetches for stop/delete (the world detail
      // either won't change or will 404, both fine).
      if (finished.kind === 'start' || finished.kind === 'create' || finished.kind === 'upgrade') {
        const timers = [3000, 8000, 20000].map((ms) =>
          window.setTimeout(() => {
            qc.invalidateQueries({ queryKey: worldKey(name) });
          }, ms),
        );
        // Best-effort cleanup if the component unmounts before these fire.
        // We don't return this from the effect because we already returned
        // above for the in-flight branch; encode as a one-shot ref instead.
        scheduledTimers.current.push(...timers);
      }
    }
    prev.current = current;
  }, [query.data, name, qc]);
  // Cleanup any pending delayed-invalidations on unmount so we don't
  // leak setTimeouts across tab switches.
  const scheduledTimers = useRef<number[]>([]);
  useEffect(
    () => () => {
      scheduledTimers.current.forEach((t) => window.clearTimeout(t));
      scheduledTimers.current = [];
    },
    [],
  );
  return query;
}

// Mutations -----------------------------------------------------------------

/** Schedule extra world-detail refetches over the next ~30s. Used after
 *  start / upgrade / create — Minecraft's data-fixer can take 5-15s
 *  AFTER the docker start_container call returns to migrate level.dat
 *  on a version jump, and the regular onSuccess refetch happens within
 *  a second of the job ending. Without these follow-ups the SPA caches
 *  the still-old resolved_version and never re-checks. */
const MIGRATION_WINDOW_MS = 25_000;
const migratingUntilKey = (name: string) => ['migrating-until', name] as const;

function useDelayedInvalidate(name?: string) {
  const qc = useQueryClient();
  return () => {
    if (!name) return;
    [3000, 8000, 20000].forEach((ms) => {
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: worldKey(name) });
      }, ms);
    });
  };
}

/** Stamp the world as "migrating" for the data-fixer window so the
 *  version chip reads "(upgrading…)" instead of "(latest)" while the
 *  JVM is rewriting level.dat — otherwise the chip flips from
 *  `1.13.1 (latest)` to `26.1.2 (latest)` with no signal that the
 *  panel was waiting on Minecraft, which reads as a panel bug.
 *
 *  Only call after upgrade — a routine start of a world that doesn't
 *  need migration shouldn't claim to be upgrading. */
function useMarkMigrating(name?: string) {
  const qc = useQueryClient();
  return () => {
    if (!name) return;
    qc.setQueryData<number>(migratingUntilKey(name), Date.now() + MIGRATION_WINDOW_MS);
    window.setTimeout(() => {
      qc.setQueryData<number>(migratingUntilKey(name), 0);
    }, MIGRATION_WINDOW_MS);
  };
}

/** True when the SPA recently triggered a start/upgrade on this world
 *  and the data-fixer migration window hasn't elapsed. Backed by a
 *  queryClient cache entry holding the deadline timestamp; consumers
 *  schedule a local timer so they re-render exactly when it expires. */
export function useIsMigrating(name: string | undefined): boolean {
  const qc = useQueryClient();
  const { data: until } = useQuery({
    queryKey: migratingUntilKey(name ?? ''),
    queryFn: () => 0,
    initialData: 0,
    staleTime: Infinity,
    enabled: false,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const t = window.setTimeout(() => setNow(Date.now()), until - Date.now() + 50);
    return () => window.clearTimeout(t);
  }, [until]);
  // Touch qc so React's exhaustive-deps lint stays quiet about the
  // setQueryData calls our setters do elsewhere.
  void qc;
  return !!until && until > now;
}

function useInvalidate(name?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: STATE_KEY });
    qc.invalidateQueries({ queryKey: KNOWN_PLAYERS_KEY });
    if (name) {
      qc.invalidateQueries({ queryKey: worldKey(name) });
      qc.invalidateQueries({ queryKey: activeJobKey(name) });
    }
  };
}

export interface CreateWorldInput {
  name: string;
  version?: string;
  seed?: string;
  mc_type?: string;
  memory_gb?: number;
  properties?: Record<string, string>;
}

// Long-lived mutations (create / start / stop / delete / backup) go
// through the job queue: server returns 202 { job_id } and we poll until
// terminal. TanStack Query's `isPending` covers the entire lifecycle, so
// component code stays unchanged.

export function useCreateWorld(options?: UseMutationOptions<WorldDetail, Error, CreateWorldInput>) {
  const invalidate = useInvalidate();
  return useMutation<WorldDetail, Error, CreateWorldInput>({
    mutationFn: (body) => runJob<WorldDetail>('/api/v1/worlds', body),
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}

export function useStartWorld(name: string) {
  const invalidate = useInvalidate(name);
  const followUp = useDelayedInvalidate(name);
  return useMutation({
    mutationFn: () => runJob<{ ok: true }>(`/api/v1/worlds/${name}/start`),
    onSuccess: () => {
      invalidate();
      // The start job is fast (just docker start_container) but the JVM
      // needs another 5-15s to boot + run any data-fixer migration that
      // bumps level.dat. Re-fetch a few more times so resolved_version
      // catches up without forcing a manual reload.
      followUp();
    },
  });
}

export function useStopWorld(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: () => runJob<{ ok: true }>(`/api/v1/worlds/${name}/stop`),
    onSuccess: invalidate,
  });
}

export function useDeleteWorld(name: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (confirm: string) =>
      runJob<{ ok: true }>(`/api/v1/worlds/${name}/delete`, { confirm }),
    onSuccess: invalidate,
  });
}

export function useSaveProperties(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: (properties: Record<string, string>) =>
      api.patch<{ properties: Record<string, string> }>(
        `/api/v1/worlds/${name}/properties`,
        { properties },
      ),
    onSuccess: invalidate,
  });
}

export function useWhitelistAdd(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: (player: string) =>
      api.post<{ whitelist: string[]; ops: string[] }>(`/api/v1/worlds/${name}/whitelist`, {
        player,
      }),
    onSuccess: invalidate,
  });
}

export function useWhitelistRemove(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: (player: string) =>
      api.del<{ whitelist: string[]; ops: string[] }>(
        `/api/v1/worlds/${name}/whitelist/${encodeURIComponent(player)}`,
      ),
    onSuccess: invalidate,
  });
}

export function useOpToggle(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: ({ player, op }: { player: string; op: boolean }) =>
      api.post<{ ops: string[] }>(`/api/v1/worlds/${name}/ops/toggle`, { player, op }),
    onSuccess: invalidate,
  });
}

export function useRconCommand(name: string) {
  return useMutation({
    mutationFn: (cmd: string) =>
      api.post<{ output: string }>(`/api/v1/worlds/${name}/rcon`, { cmd }),
  });
}

export interface UsageEvent {
  t: string;
  type: 'join' | 'leave';
  player: string;
  reason?: string;
}
export interface UsageResponse {
  events: UsageEvent[];
  online_at_start: string[];
  online_at_end: string[];
  since: string;
  until: string;
}

export function useUsage(name: string, sinceMs: number, untilMs: number) {
  const since = new Date(sinceMs).toISOString();
  const until = new Date(untilMs).toISOString();
  return useQuery({
    queryKey: ['usage', name, since, until] as const,
    queryFn: () =>
      api.get<UsageResponse>(
        `/api/v1/worlds/${name}/usage?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
      ),
    // Auto-refresh only matters for the "now" window (offset 0) since
    // historical windows are immutable. Caller can decide via the
    // refetchInterval option through queryClient if they want to bypass.
    refetchInterval: 60_000,
  });
}

export function useUpgradeWorld(name: string) {
  const invalidate = useInvalidate(name);
  const followUp = useDelayedInvalidate(name);
  const markMigrating = useMarkMigrating(name);
  return useMutation({
    mutationFn: (version: string = 'LATEST') =>
      runJob<{ version: string; restarted: boolean }>(
        `/api/v1/worlds/${name}/upgrade`,
        { version },
      ),
    onSuccess: () => {
      invalidate();
      // Upgrade restarts the world if it was running, which kicks off
      // the same migration the start path needs to catch. Mark the
      // chip as upgrading so the user sees the in-flight state until
      // the new resolved_version arrives.
      followUp();
      markMigrating();
    },
  });
}

export function useSetWorldMemory(name: string) {
  const invalidate = useInvalidate(name);
  // PATCH returns 200 (noop, value already matches) OR 202 with a job_id.
  // We don't poll the job here — the active-job query in the UI picks it
  // up and shows the standard busy spinner, same as upgrade. The world
  // detail query is invalidated either way so the new memory_gb appears.
  return useMutation({
    mutationFn: (memory_gb: number) =>
      api.patch<{ memory_gb: number; job_id?: string }>(
        `/api/v1/worlds/${name}/memory`,
        { memory_gb },
      ),
    onSuccess: invalidate,
  });
}

const ADMIN_CONFIG_KEY = ['admin-config'] as const;

export function useAdminConfig() {
  return useQuery({
    queryKey: ADMIN_CONFIG_KEY,
    queryFn: () => api.get<AdminConfig>('/api/v1/admin/config'),
  });
}

export function useUpdateAdminConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      world_memory_min_gb: number;
      world_memory_max_gb: number;
      max_concurrent_worlds: number;
    }) => api.patch<AdminConfig>('/api/v1/admin/config', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_CONFIG_KEY }),
  });
}

export function useRunBackup(name: string) {
  // Routine ad-hoc backup. No name, no description, retention-prunable.
  // For named keep-forever snapshots use useSaveSnapshot below.
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: () => runJob<{ backups: unknown[] }>(`/api/v1/worlds/${name}/backups`),
    onSuccess: invalidate,
  });
}

export function useSaveSnapshot(name: string) {
  // Permanent named snapshot. Same job kind ("backup") as the routine
  // path so the SPA's busy state covers both.
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: ({ display_name, description }: { display_name: string; description?: string }) =>
      runJob<{ backups: unknown[] }>(`/api/v1/worlds/${name}/backups`, {
        display_name,
        description: description ?? '',
        permanent: true,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateBackup(world: string) {
  // Edit metadata on an existing backup: rename, change description,
  // flip the permanent flag. Doesn't touch the zip.
  const invalidate = useInvalidate(world);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      filename,
      ...fields
    }: {
      filename: string;
      display_name?: string;
      description?: string;
      permanent?: boolean;
    }) =>
      api.patch<{ display_name: string; description: string; permanent: boolean }>(
        `/api/v1/backups/${encodeURIComponent(world)}/${encodeURIComponent(filename)}`,
        fields,
      ),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: BACKUPS_INDEX_KEY });
    },
  });
}

export function useUploadBanner(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: (file: File) =>
      api.upload<{ banner_url: string }>(`/api/v1/worlds/${name}/banner`, file, 'file'),
    onSuccess: invalidate,
  });
}

export function useDeleteBanner(name: string) {
  const invalidate = useInvalidate(name);
  return useMutation({
    mutationFn: () => api.del<{ deleted: boolean }>(`/api/v1/worlds/${name}/banner`),
    onSuccess: invalidate,
  });
}

const BACKUPS_INDEX_KEY = ['backups-index'] as const;

export function useAllBackups() {
  return useQuery({
    queryKey: BACKUPS_INDEX_KEY,
    queryFn: () => api.get<BackupIndexEntry[]>('/api/v1/backups'),
  });
}

function invalidateBackupIndex(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: BACKUPS_INDEX_KEY });
}

export function useDeleteBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ world, filename }: { world: string; filename: string }) =>
      api.del<{ ok: true }>(
        `/api/v1/backups/${encodeURIComponent(world)}/${encodeURIComponent(filename)}`,
      ),
    onSuccess: (_, { world }) => {
      invalidateBackupIndex(qc);
      qc.invalidateQueries({ queryKey: worldKey(world) });
    },
  });
}

export function useRestoreWorld() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, filename }: { name: string; filename: string }) =>
      runJob<{ ok: true; world: string; filename: string }>(
        `/api/v1/worlds/${name}/restore`,
        { filename },
      ),
    onSuccess: (_, { name }) => {
      invalidateBackupIndex(qc);
      qc.invalidateQueries({ queryKey: worldKey(name) });
      qc.invalidateQueries({ queryKey: STATE_KEY });
    },
  });
}

// Imports -------------------------------------------------------------------

export function useImportUpload() {
  return useMutation({
    mutationFn: (file: File) => api.upload<StagingResponse>('/api/v1/imports/upload', file),
  });
}

export function useStaging(staging_id: string | null) {
  return useQuery({
    queryKey: ['staging', staging_id ?? ''],
    queryFn: () => api.get<StagingResponse>(`/api/v1/imports/${staging_id}`),
    enabled: !!staging_id,
    // The staging dir doesn't change once written, so cache forever — but
    // a Cancel/commit invalidates it implicitly (the dir is deleted, so
    // any retry returns 404 and TanStack Query surfaces the error).
    staleTime: Infinity,
  });
}

export function useImportFrom() {
  return useMutation({
    mutationFn: (source: string) =>
      api.post<StagingResponse>('/api/v1/imports/from', { source }),
  });
}

export function useImportCancel() {
  return useMutation({
    mutationFn: (staging_id: string) =>
      api.del<{ ok: true }>(`/api/v1/imports/${staging_id}`),
  });
}

export function useImportCommit() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      staging_id,
      name,
      mc_type,
      version,
    }: {
      staging_id: string;
      name: string;
      mc_type: string;
      version: string;
    }) =>
      runJob<WorldDetail>(`/api/v1/imports/${staging_id}/commit`, {
        name,
        mc_type,
        version,
      }),
    onSuccess: invalidate,
  });
}
