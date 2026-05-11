// JSON shapes returned by /api/v1/*. Mirrors the serialization helpers
// in apps/mc-panel-v2/app/api.py.

export type WorldStatus = 'running' | 'exited' | 'created' | 'none';

export interface WorldSummary {
  name: string;
  container_name: string;
  port: number;
  status: WorldStatus;
  awake: boolean;
  version: string;
  /** Actual MC version read from level.dat. null until the world has
   *  booted at least once. Differs from `version` when the requested
   *  target was a placeholder like "LATEST". */
  resolved_version: string | null;
  motd: string;
  /** JVM heap size in gibibytes (-Xmx). Editable per-world (operator+),
   *  bounded by the admin-set [min, max] in /admin/config. */
  memory_gb: number;
  /** Cache-busted URL of the uploaded banner image (mtime in querystring),
   *  or null when no banner is set — fall back to the procedural HeroBand. */
  banner_url: string | null;
}

export interface AdminConfig {
  world_memory_min_gb: number;
  world_memory_max_gb: number;
  /** Hard floor/ceiling enforced by the backend; admin sliders clamp here. */
  memory_gb_floor: number;
  memory_gb_ceiling: number;
  /** Maximum number of worlds that may be running at the same time.
   *  Operator START requests beyond this 409. */
  max_concurrent_worlds: number;
  max_concurrent_worlds_ceiling: number;
}

export interface BackupEntry {
  name: string;
  size: number;
  size_human: string;
  /** User-facing label (defaults to the YYYY-MM-DD_HHMMSS stamp).
   *  Non-empty when an operator named a "Save snapshot". */
  display_name: string;
  description: string;
  /** Pruning-exempt. Operators flip this on snapshots they want to keep. */
  permanent: boolean;
  /** Resolved MC version (level.dat Version_Name) at the moment of
   *  backup. null for backups that pre-date this feature. */
  world_version: string | null;
  /** Remote-User who triggered the backup (null for nightly auto). */
  created_by: string | null;
  created_at_ms: number;
}

export interface BackupIndexEntry {
  id: string;
  world: string;
  filename: string;
  size: number;
  size_human: string;
  created_at: number;
  display_name: string;
  description: string;
  permanent: boolean;
  world_version: string | null;
  created_by: string | null;
}

export interface EditablePropertySpec {
  type: 'text' | 'select' | 'number' | 'boolean';
  default: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface WorldDetail extends WorldSummary {
  properties: Record<string, string>;
  whitelist: string[];
  ops: string[];
  backups: BackupEntry[];
  retention_days: number;
  game_hostname: string;
}

export interface HostInfo {
  game_hostname: string;
  port_range: [number, number];
  default_version: string;
  default_type: string;
  awake_count: number;
  editable_props: Record<string, EditablePropertySpec>;
}

export interface AppState {
  user: string;
  worlds: WorldSummary[];
  imports: string[];
  host: HostInfo;
}

export type Role = 'admin' | 'operator' | 'user';

export interface Me {
  user: string;
  /** Effective panel role, or null when the user is in none of the three
   *  panel groups (mc-admin / mc-operator / mc-user) — show the
   *  no-access wall on the SPA side in that case. */
  role: Role | null;
  can: {
    /** Any state-changing endpoint (operator+). */
    mutate: boolean;
    /** Permanent world deletion (admin only). */
    delete_world: boolean;
    /** Reserved for future admin-only knobs (memory config, retention,
     *  role/access management, etc). */
    admin: boolean;
  };
}

export interface McVersion {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  releaseTime: string;
}

export interface McVersionsResponse {
  latest: { release?: string; snapshot?: string };
  versions: McVersion[];
}

export interface ImportMetadata {
  name_suggestion: string;
  server_type_guess: string;
  whitelist_count: number;
  ops_count: number;
  has_level_dat: boolean;
  level_name?: string;
  mc_version?: string;
  hardcore?: boolean;
  difficulty?: number;
  gametype?: number;
  dataversion?: number;
  motd?: string;
}

export interface StagingResponse {
  staging_id: string;
  metadata: ImportMetadata;
  default_type: string;
  default_version: string;
}

export type JobKind = 'create' | 'start' | 'stop' | 'delete' | 'backup' | 'upgrade';
export type JobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface Job {
  id: string;
  kind: JobKind;
  target: string;
  status: JobStatus;
  started: string;
  finished: string | null;
  progress: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}
