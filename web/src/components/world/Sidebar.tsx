import { useEffect, useState } from 'react';
import type { BackupEntry, WorldDetail } from '../../api/types';
import {
  useActiveJob,
  useAdminConfig,
  useIsMigrating,
  useMe,
  useRunBackup,
  useSaveSnapshot,
  useSetWorldMemory,
  useUpdateBackup,
  useUpgradeWorld,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import { Card, KeyValue } from '../ui/atoms';
import { GhostBtn, PrimaryBtn } from '../ui/Button';
import { TextField } from '../ui/Field';

export function DetailsCard({ world }: { world: WorldDetail }) {
  const migrating = useIsMigrating(world.name);
  return (
    <Card>
      <div className="eyebrow text-[8px] mb-3">DETAILS</div>
      <KeyValue
        rows={[
          ['status', world.awake ? 'online' : world.status === 'created' ? 'idle' : 'stopped'],
          ['port', `:${world.port}`],
          [
            'version',
            world.resolved_version
              ? migrating
                ? `${world.resolved_version} (upgrading…)`
                : world.version?.toUpperCase() === 'LATEST'
                  ? `${world.resolved_version} (latest)`
                  : world.resolved_version
              : world.version || '?',
          ],
          ['players', `${world.whitelist.length} whitelisted · ${world.ops.length} op${world.ops.length === 1 ? '' : 's'}`],
          ['container', world.container_name],
        ]}
      />
    </Card>
  );
}

export function BackupsCard({ world }: { world: WorldDetail }) {
  const run = useRunBackup(world.name);
  const save = useSaveSnapshot(world.name);
  const me = useMe();
  const canMutate = !!me.data?.can.mutate;
  const [snapName, setSnapName] = useState('');
  const [snapDesc, setSnapDesc] = useState('');
  const [snapOpen, setSnapOpen] = useState(false);

  const submitSnap = () => {
    const trimmed = snapName.trim();
    if (!trimmed) return;
    save.mutate(
      { display_name: trimmed, description: snapDesc.trim() },
      {
        onSuccess: () => {
          setSnapName('');
          setSnapDesc('');
          setSnapOpen(false);
        },
      },
    );
  };

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">Backups</h2>
        <span className="text-[11px] text-sub">keep last {world.retention_days}d (★ pinned forever)</span>
      </div>
      {world.backups.length === 0 ? (
        <p className="mb-3 text-[12px] text-dim">No backups yet.</p>
      ) : (
        <div className="mb-3 grid gap-1.5">
          {world.backups.slice(0, 4).map((b) => (
            <BackupRow key={b.name} world={world.name} entry={b} canMutate={canMutate} />
          ))}
        </div>
      )}
      {canMutate && !snapOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <GhostBtn onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? 'BACKING UP…' : 'Run backup now'}
          </GhostBtn>
          <GhostBtn onClick={() => setSnapOpen(true)} disabled={save.isPending}>
            ★ Save snapshot
          </GhostBtn>
        </div>
      )}
      {canMutate && snapOpen && (
        <div className="grid gap-2 rounded-md border border-line bg-panel-2 p-3">
          <div className="text-[11px] text-dim">
            Permanent snapshot — never auto-deleted. Give it a memorable name.
          </div>
          <TextField
            placeholder="e.g. before-1.21.5-upgrade"
            value={snapName}
            onChange={(e) => setSnapName(e.target.value)}
            autoFocus
          />
          <TextField
            placeholder="optional description"
            value={snapDesc}
            onChange={(e) => setSnapDesc(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <PrimaryBtn onClick={submitSnap} disabled={!snapName.trim() || save.isPending}>
              {save.isPending ? 'SAVING…' : 'SAVE'}
            </PrimaryBtn>
            <GhostBtn
              type="button"
              onClick={() => {
                setSnapOpen(false);
                setSnapName('');
                setSnapDesc('');
              }}
            >
              CANCEL
            </GhostBtn>
          </div>
        </div>
      )}
      {(run.isError || save.isError) && (
        <div className="mt-2 text-[11px] text-danger">
          {(run.error || save.error) instanceof ApiError
            ? (run.error || save.error)!.message
            : 'Backup failed'}
        </div>
      )}
    </Card>
  );
}

function BackupRow({
  world,
  entry,
  canMutate,
}: {
  world: string;
  entry: BackupEntry;
  canMutate: boolean;
}) {
  const update = useUpdateBackup(world);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.display_name);
  const [desc, setDesc] = useState(entry.description);
  // Re-seed if the parent re-renders with a fresh value (e.g. another tab
  // patched it).
  useEffect(() => {
    if (!editing) {
      setName(entry.display_name);
      setDesc(entry.description);
    }
  }, [entry.display_name, entry.description, editing]);

  const headline = entry.display_name || entry.name.replace('.zip', '');

  return (
    <div className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {entry.permanent && (
          <span title="Pinned permanently — exempt from retention" className="text-accent">
            ★
          </span>
        )}
        <span className="min-w-0 truncate text-[12px] font-medium text-text">{headline}</span>
        {entry.world_version && (
          <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-dim">
            v{entry.world_version}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-sub">{entry.size_human}</span>
        {canMutate && (
          <>
            <button
              type="button"
              onClick={() =>
                update.mutate({ filename: entry.name, permanent: !entry.permanent })
              }
              disabled={update.isPending}
              title={entry.permanent ? 'Allow retention to delete' : 'Pin forever — exempt from retention'}
              className={`rounded-md border px-2 py-0.5 font-headline text-[10px] tracking-[1px] disabled:opacity-50 ${
                entry.permanent
                  ? 'border-accent/50 bg-accent/10 text-accent hover:border-accent'
                  : 'border-line text-dim hover:border-accent hover:text-text'
              }`}
            >
              {entry.permanent ? '★ PINNED' : '☆ PIN'}
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title={editing ? 'Cancel edit' : 'Rename / add description'}
              className="rounded-md border border-line px-2 py-0.5 font-headline text-[10px] tracking-[1px] text-dim hover:border-accent hover:text-text"
            >
              {editing ? '✕ CLOSE' : '✎ EDIT'}
            </button>
          </>
        )}
        <a
          className="rounded-md border border-line px-2 py-0.5 font-headline text-[10px] tracking-[1px] text-text hover:border-accent"
          href={`/api/v1/worlds/${world}/backups/${encodeURIComponent(entry.name)}`}
          title="Download"
        >
          ↓ ZIP
        </a>
      </div>
      {entry.description && !editing && (
        <div className="mt-1 text-[11px] text-dim">{entry.description}</div>
      )}
      {editing && canMutate && (
        <div className="mt-2 grid gap-1.5">
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
          <div className="flex items-center gap-2">
            <PrimaryBtn
              onClick={() =>
                update.mutate(
                  { filename: entry.name, display_name: name, description: desc },
                  { onSuccess: () => setEditing(false) },
                )
              }
              disabled={update.isPending}
            >
              {update.isPending ? 'SAVING…' : 'SAVE'}
            </PrimaryBtn>
          </div>
          {update.isError && (
            <div className="text-[11px] text-danger">
              {update.error instanceof ApiError ? update.error.message : 'Update failed'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function UpgradeCard({ world }: { world: WorldDetail }) {
  const upgrade = useUpgradeWorld(world.name);
  const job = useActiveJob(world.name);
  const me = useMe();
  const migrating = useIsMigrating(world.name);
  const [armed, setArmed] = useState(false);
  const isUpgrading = upgrade.isPending || job.data?.kind === 'upgrade';
  const wasRunning = world.awake;

  // Upgrade is mutate; hide the entire card for viewers (the version is
  // already shown in DetailsCard so they don't lose info).
  if (me.data && !me.data.can.mutate) return null;

  const click = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    upgrade.mutate('LATEST', {
      onSettled: () => setArmed(false),
    });
  };

  return (
    <Card>
      <h2 className="mb-1 text-[14px] font-semibold">Upgrade Minecraft</h2>
      <p className="mb-3 text-[12px] text-dim">
        Recreate the container with VERSION=LATEST. World data, properties, whitelist
        and backups are preserved. Current:{' '}
        <span className="font-mono text-text">{world.resolved_version || world.version || '?'}</span>
        {world.resolved_version && migrating ? (
          <span className="text-warn"> (upgrading…)</span>
        ) : (
          world.resolved_version && world.version?.toUpperCase() === 'LATEST' && (
            <span className="text-dim"> (latest)</span>
          )
        )}
        .{' '}
        {wasRunning
          ? 'The server will be stopped, upgraded, and restarted (~40s).'
          : "The world is stopped — Minecraft only migrates the level data on first start, so the version above won't change until you START the server."}
      </p>
      <GhostBtn onClick={click} disabled={isUpgrading}>
        {isUpgrading ? 'UPGRADING…' : armed ? 'Click again to confirm' : '↑ Upgrade to latest'}
      </GhostBtn>
      {armed && !isUpgrading && (
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="ml-2 text-[11px] text-dim hover:text-text"
        >
          cancel
        </button>
      )}
      {upgrade.isSuccess && !isUpgrading && (
        <div className="mt-2 text-[11px] text-good">
          {upgrade.data?.restarted
            ? '✓ Upgraded and restarted.'
            : '✓ Container set to LATEST. Start the server to apply.'}
        </div>
      )}
      {upgrade.isError && (
        <div className="mt-2 text-[11px] text-danger">
          {upgrade.error instanceof ApiError ? upgrade.error.message : 'Upgrade failed'}
        </div>
      )}
    </Card>
  );
}

export function MemoryCard({ world }: { world: WorldDetail }) {
  const me = useMe();
  const { data: cfg } = useAdminConfig();
  const set = useSetWorldMemory(world.name);
  const job = useActiveJob(world.name);
  const [value, setValue] = useState<number>(world.memory_gb);
  // Re-seed the slider whenever the persisted value changes (e.g. after a
  // resize completes the world detail query refetches with the new value).
  useEffect(() => {
    setValue(world.memory_gb);
  }, [world.memory_gb]);

  if (!me.data || !cfg) return null;
  const canEdit = me.data.can.mutate;
  const min = cfg.world_memory_min_gb;
  const max = cfg.world_memory_max_gb;
  const locked = min === max;
  const isResizing = set.isPending || job.data?.kind === 'upgrade';
  // World may be running an out-of-bounds value if admin tightened the
  // range after the world was created — display the truth either way.
  const outOfBounds = world.memory_gb < min || world.memory_gb > max;
  const dirty = value !== world.memory_gb;
  const inRange = value >= min && value <= max;

  return (
    <Card>
      <h2 className="mb-1 text-[14px] font-semibold">Memory</h2>
      <p className="mb-3 text-[12px] text-dim">
        JVM heap (<code>-Xmx</code>). Current:{' '}
        <span className="font-mono text-text">{world.memory_gb} GB</span>
        {outOfBounds && (
          <span className="text-warning"> (outside admin's {min}–{max} GB range)</span>
        )}
        . Container cgroup limit adds 1 GiB headroom on top.
        {world.awake && ' Changing memory restarts the server (~40s).'}
      </p>

      {locked && !canEdit ? null : locked ? (
        <p className="text-[12px] text-dim">
          Locked by admin at <span className="font-mono text-text">{min} GB</span>.
        </p>
      ) : !canEdit ? (
        <p className="text-[12px] text-dim">
          Operator role required to change. Admin's range:{' '}
          <span className="font-mono text-text">{min}–{max} GB</span>.
        </p>
      ) : (
        <>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[11px] text-dim">{min} GB</span>
            <span className="font-mono text-[14px] font-semibold text-text">{value} GB</span>
            <span className="font-mono text-[11px] text-dim">{max} GB</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={Math.max(min, Math.min(value, max))}
            onChange={(e) => setValue(parseInt(e.target.value, 10))}
            disabled={isResizing}
            className="mb-3 w-full accent-accent"
          />
          <div className="flex items-center gap-2">
            <PrimaryBtn
              disabled={!dirty || !inRange || isResizing}
              onClick={() => set.mutate(value)}
            >
              {isResizing ? 'RESIZING…' : 'APPLY'}
            </PrimaryBtn>
            {dirty && !isResizing && (
              <GhostBtn type="button" onClick={() => setValue(world.memory_gb)}>
                REVERT
              </GhostBtn>
            )}
          </div>
        </>
      )}
      {set.isError && (
        <div className="mt-2 text-[11px] text-danger">
          {set.error instanceof ApiError ? set.error.message : 'Resize failed'}
        </div>
      )}
    </Card>
  );
}

export function ExportCard({ world }: { world: WorldDetail }) {
  const disabled = world.awake || world.status === 'created' || world.status === 'none';
  return (
    <Card>
      <h2 className="mb-1 text-[14px] font-semibold">Export world</h2>
      <p className="mb-3 text-[12px] text-dim">
        Stream the world directory as a .zip. The server must be stopped first so the archive is consistent.
      </p>
      {disabled ? (
        <>
          <span className="inline-flex h-10 cursor-not-allowed items-center rounded-md border border-line bg-panel-2 px-3.5 text-[13px] text-sub">
            ↓ Download {world.name}.zip
          </span>
          {world.awake && <p className="mt-2 text-[11px] italic text-dim">Stop the server first to enable download.</p>}
        </>
      ) : (
        <a
          href={`/api/v1/worlds/${world.name}/export`}
          className="inline-flex h-10 items-center rounded-md bg-accent px-3.5 font-headline text-[11px] tracking-[1.5px] text-accent-fg shadow-btn"
        >
          ↓ DOWNLOAD .ZIP
        </a>
      )}
    </Card>
  );
}
