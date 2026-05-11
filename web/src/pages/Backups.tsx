import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  useAllBackups,
  useAppState,
  useDeleteBackup,
  useMe,
  useRestoreWorld,
  useRunBackup,
  useUpdateBackup,
} from '../api/queries';
import type { BackupIndexEntry, WorldSummary } from '../api/types';
import { Card } from '../components/ui/atoms';
import { GhostBtn, PrimaryBtn } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';

export function Backups() {
  const [params, setParams] = useSearchParams();
  const worldFilter = params.get('world') ?? '';
  const grep = params.get('q') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const state = useAppState();
  const backups = useAllBackups();
  const worlds = state.data?.worlds ?? [];
  const all = backups.data ?? [];

  const visible = useMemo(() => {
    const q = grep.toLowerCase();
    return all.filter((b) => {
      if (worldFilter !== '' && b.world !== worldFilter) return false;
      if (q === '') return true;
      // Match against everything a user might recognize: world, the
      // user-set display name + description, the underlying filename, and
      // the captured MC version (so "1.21" finds every snapshot from
      // that release).
      const hay = [
        b.world,
        b.display_name,
        b.description,
        b.filename,
        b.world_version ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [all, worldFilter, grep]);

  const totalBytes = visible.reduce((s, b) => s + b.size, 0);

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[18px] font-semibold">Backups</h1>
        <span className="font-mono text-[12px] text-dim">
          {visible.length} {visible.length === 1 ? 'snapshot' : 'snapshots'} · {humanBytes(totalBytes)}
        </span>
        <div className="ml-auto">
          <BackupNow worlds={worlds} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setParam('world', '')}
          className={chipClass(worldFilter === '')}
        >
          All worlds
        </button>
        {worlds.map((w) => (
          <button
            key={w.name}
            type="button"
            onClick={() => setParam('world', w.name)}
            className={chipClass(worldFilter === w.name)}
          >
            {w.name}
          </button>
        ))}
        <input
          type="text"
          value={grep}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder="Search backups…"
          className="w-full rounded-md border border-line bg-panel-2 px-2.5 py-1 text-[12px] sm:ml-2 sm:w-56"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto nice-scroll">
        {backups.isLoading ? (
          <Card><div className="text-dim">Loading…</div></Card>
        ) : backups.isError ? (
          <Card><div className="text-danger">Failed to load backups.</div></Card>
        ) : visible.length === 0 ? (
          <Card><div className="text-dim">
            {all.length === 0 ? 'No backups yet. Click Backup now to create one.' : 'No backups match the current filters.'}
          </div></Card>
        ) : (
          <div className="grid gap-2">
            {visible.map((b) => (
              <BackupRow key={b.id} entry={b} world={worlds.find((w) => w.name === b.world)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function chipClass(active: boolean) {
  return `rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
    active ? 'border-accent bg-accent/10 text-accent' : 'border-line text-dim hover:text-text'
  }`;
}

function BackupRow({ entry, world }: { entry: BackupIndexEntry; world?: WorldSummary }) {
  const del = useDeleteBackup();
  const restore = useRestoreWorld();
  const update = useUpdateBackup(entry.world);
  const me = useMe();
  const canMutate = !!me.data?.can.mutate;
  // Backup deletion is admin-only — pinned snapshots especially shouldn't
  // be removable by an operator. Operators still see edit/pin/restore.
  const canDelete = !!me.data?.can.admin;
  const [armed, setArmed] = useState<null | 'delete' | 'restore'>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.display_name);
  const [desc, setDesc] = useState(entry.description);
  useEffect(() => {
    if (!editing) {
      setName(entry.display_name);
      setDesc(entry.description);
    }
  }, [entry.display_name, entry.description, editing]);

  const restoreDisabled = !world || world.awake;
  const restoreTitle = !world
    ? 'world has been deleted; cannot restore'
    : world.awake
      ? 'stop the world before restoring'
      : 'archive the current world data and unzip this snapshot in its place';

  return (
    <div className="rounded-md border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {entry.permanent && (
              <span title="Pinned permanently — exempt from retention" className="text-accent">
                ★
              </span>
            )}
            <span className="font-semibold text-text">{entry.world}</span>
            {entry.display_name && (
              <span className="text-[13px] text-text">· {entry.display_name}</span>
            )}
            {entry.world_version && (
              <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-dim">
                v{entry.world_version}
              </span>
            )}
            <span className="font-mono text-[11px] text-dim">{formatTime(entry.created_at)}</span>
          </div>
          {entry.description && (
            <div className="mt-0.5 text-[12px] text-dim">{entry.description}</div>
          )}
          <div className="mt-0.5 truncate font-mono text-[11px] text-sub">{entry.filename}</div>
        </div>
        <div className="font-mono text-[12px] text-dim sm:flex-none sm:text-right">
          {entry.size_human}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-none sm:justify-end">
          {canMutate && (
            <>
              <button
                type="button"
                onClick={() =>
                  update.mutate({ filename: entry.filename, permanent: !entry.permanent })
                }
                disabled={update.isPending}
                title={
                  entry.permanent
                    ? 'Allow retention to delete'
                    : 'Pin forever — exempt from retention'
                }
                className={`inline-flex h-9 items-center rounded-md border px-3 text-[12px] disabled:opacity-40 ${
                  entry.permanent
                    ? 'border-accent/50 bg-accent/10 text-accent hover:border-accent'
                    : 'border-line text-dim hover:border-accent hover:text-text'
                }`}
              >
                {entry.permanent ? '★ pinned' : '☆ pin'}
              </button>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                title={editing ? 'Cancel edit' : 'Rename / add description'}
                className="inline-flex h-9 items-center rounded-md border border-line px-3 text-[12px] text-dim hover:border-accent hover:text-text"
              >
                {editing ? '✕ close' : '✎ edit'}
              </button>
            </>
          )}
          <a
            className="inline-flex h-9 items-center rounded-md border border-line px-3 text-[12px] text-text hover:border-accent"
            href={`/api/v1/worlds/${entry.world}/backups/${encodeURIComponent(entry.filename)}`}
            title="Download"
          >
            ↓ download
          </a>
          <button
            type="button"
            disabled={restoreDisabled || restore.isPending}
            onClick={() => {
              if (armed !== 'restore') {
                setArmed('restore');
                return;
              }
              setArmed(null);
              restore.mutate({ name: entry.world, filename: entry.filename });
            }}
            title={restoreTitle}
            className={`inline-flex h-9 items-center rounded-md border px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-40 ${
              armed === 'restore'
                ? 'border-warn bg-warn/10 text-warn'
                : 'border-line text-text hover:border-accent'
            }`}
          >
            {armed === 'restore' ? 'tap again to confirm' : restore.isPending ? '…' : '↻ restore'}
          </button>
          {canDelete && (
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => {
                if (armed !== 'delete') {
                  setArmed('delete');
                  return;
                }
                setArmed(null);
                del.mutate({ world: entry.world, filename: entry.filename });
              }}
              className={`inline-flex h-9 items-center rounded-md border px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-40 ${
                armed === 'delete'
                  ? 'border-danger bg-danger/10 text-danger'
                  : 'border-line text-dim hover:border-danger hover:text-danger'
              }`}
            >
              {armed === 'delete' ? 'tap again to delete' : '× delete'}
            </button>
          )}
        </div>
      </div>
      {editing && canMutate && (
        <div className="mt-3 grid gap-2">
          <TextField
            placeholder="display name (blank = use timestamp)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            placeholder="description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div>
            <PrimaryBtn
              onClick={() =>
                update.mutate(
                  { filename: entry.filename, display_name: name, description: desc },
                  { onSuccess: () => setEditing(false) },
                )
              }
              disabled={update.isPending}
            >
              {update.isPending ? 'SAVING…' : 'SAVE'}
            </PrimaryBtn>
          </div>
        </div>
      )}
      {(restore.isError || del.isError || update.isError) && (
        <div className="mt-2 text-[11px] text-danger">
          {restore.error instanceof ApiError
            ? restore.error.message
            : del.error instanceof ApiError
              ? del.error.message
              : update.error instanceof ApiError
                ? update.error.message
                : 'action failed'}
        </div>
      )}
    </div>
  );
}

function BackupNow({ worlds }: { worlds: WorldSummary[] }) {
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState(worlds[0]?.name ?? '');
  const run = useRunBackup(target);

  if (worlds.length === 0) return null;

  if (!picking) {
    return (
      <PrimaryBtn onClick={() => setPicking(true)} className="!h-9 !min-w-0 !px-4 !text-[11px]">
        + Backup now
      </PrimaryBtn>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1.5">
      <span className="font-mono text-[11px] text-dim">backup:</span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="rounded-md border border-line bg-bg px-2 py-1 text-[12px]"
      >
        {worlds.map((w) => (
          <option key={w.name} value={w.name}>
            {w.name}
          </option>
        ))}
      </select>
      <GhostBtn
        onClick={() => {
          run.mutate(undefined, {
            onSettled: () => setPicking(false),
          });
        }}
        disabled={run.isPending || !target}
        className="!h-8 !text-[11px]"
      >
        {run.isPending ? 'running…' : 'run'}
      </GhostBtn>
      <button
        type="button"
        onClick={() => setPicking(false)}
        disabled={run.isPending}
        className="text-[11px] text-dim hover:text-text"
      >
        cancel
      </button>
    </div>
  );
}

function formatTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function humanBytes(n: number): string {
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (n < 1024) return unit === 'B' ? `${n} ${unit}` : `${n.toFixed(1)} ${unit}`;
    n /= 1024;
  }
  return `${n.toFixed(1)} TB`;
}
