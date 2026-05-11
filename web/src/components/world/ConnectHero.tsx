import { useRef, useState } from 'react';
import type { WorldDetail } from '../../api/types';
import { ApiError } from '../../api/client';
import { HeroBand } from '../art/HeroBand';
import { PrimaryBtn, GhostBtn } from '../ui/Button';
import { StatusPill } from '../ui/atoms';
import {
  useActiveJob,
  useAdminConfig,
  useAppState,
  useDeleteBanner,
  useIsMigrating,
  useMe,
  useStartWorld,
  useStopWorld,
  useUploadBanner,
} from '../../api/queries';
import { useClipboard } from '../../hooks/useClipboard';

function BannerControls({ world }: { world: WorldDetail }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = useUploadBanner(world.name);
  const remove = useDeleteBanner(world.name);
  const me = useMe();
  const [error, setError] = useState<string | null>(null);

  // Viewers can see the banner but can't change it. Hide controls entirely
  // rather than disabling — there's nothing useful for them here.
  if (!me.data?.can.mutate) return null;

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    upload.mutate(file, {
      onError: (e) => setError(e instanceof ApiError ? e.message : 'Upload failed'),
    });
  };

  const busy = upload.isPending || remove.isPending;
  const hasBanner = !!world.banner_url;

  return (
    <div className="absolute right-3 top-3 flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? undefined)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-md bg-black/55 px-2.5 py-1 font-headline text-[10px] tracking-[1px] text-white backdrop-blur hover:bg-black/70 disabled:opacity-50"
      >
        {upload.isPending ? 'UPLOADING…' : hasBanner ? '🖼 CHANGE' : '🖼 ADD BANNER'}
      </button>
      {hasBanner && !upload.isPending && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            remove.mutate();
          }}
          disabled={busy}
          className="rounded-md bg-black/55 px-2 py-1 font-headline text-[10px] tracking-[1px] text-white backdrop-blur hover:bg-black/70 disabled:opacity-50"
        >
          {remove.isPending ? '…' : 'REMOVE'}
        </button>
      )}
      {error && (
        <span className="rounded-md bg-danger/90 px-2 py-1 text-[10px] text-white">{error}</span>
      )}
    </div>
  );
}

function VersionLine({
  worldName,
  version,
  resolved,
}: {
  worldName: string;
  version: string;
  resolved: string | null;
}) {
  // Show the resolved MC version prominently when we have it, with a small
  // tag indicating the requested target was a placeholder (e.g. "LATEST").
  // Falls back to the requested target alone for brand-new worlds whose
  // level.dat hasn't been written yet. While we know a start/upgrade just
  // fired, swap "LATEST" for "UPGRADING" so the still-stale chip reads
  // as "we're working on it" instead of "the panel was just wrong".
  const migrating = useIsMigrating(worldName);
  const display = resolved || version;
  if (!display) return null;
  const isPlaceholder = !!version && version.toUpperCase() === 'LATEST';
  return (
    <div className="mt-1.5 flex items-baseline gap-2">
      <span className="font-mono text-[15px] font-semibold text-text">v{display}</span>
      {migrating ? (
        <span className="rounded bg-warn/15 px-1.5 py-0.5 font-headline text-[9px] tracking-[1px] text-warn">
          UPGRADING…
        </span>
      ) : (
        resolved && isPlaceholder && (
          <span className="rounded bg-panel-2 px-1.5 py-0.5 font-headline text-[9px] tracking-[1px] text-dim">
            LATEST
          </span>
        )
      )}
    </div>
  );
}

export function ConnectHero({ world }: { world: WorldDetail }) {
  const start = useStartWorld(world.name);
  const stop = useStopWorld(world.name);
  const job = useActiveJob(world.name);
  const me = useMe();
  const canMutate = !!me.data?.can.mutate;
  // Admin's concurrent-world cap. Disabled-with-tooltip beats letting the
  // operator click and then surfacing a 409 toast.
  const { data: state } = useAppState();
  const { data: cfg } = useAdminConfig();
  const atCap = !!cfg && (state?.host.awake_count ?? 0) >= cfg.max_concurrent_worlds;
  const blocked = !world.awake && atCap;
  const connect = `${world.game_hostname}:${world.port}`;
  const { copy, copied } = useClipboard();
  const isStarting = start.isPending || job.data?.kind === 'start' || job.data?.kind === 'create';
  const isStopping = stop.isPending || job.data?.kind === 'stop';
  const isUpgrading = job.data?.kind === 'upgrade';
  const busy = isStarting || isStopping || isUpgrading || job.data?.kind === 'delete';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="group relative">
        <HeroBand height={200} backgroundImage={world.banner_url ?? undefined}>
          <div
            className="absolute left-7 top-6 flex items-center gap-3 text-white"
            style={{ textShadow: '2px 2px 0 rgba(0,0,0,.45)' }}
          >
            <div className="font-headline text-[28px] leading-tight tracking-[0.05em]">{world.name}</div>
            <StatusPill status={world.status} />
          </div>
        </HeroBand>
        <BannerControls world={world} />
      </div>
      <div className="flex flex-col items-stretch gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="eyebrow text-[9px]">CONNECT</div>
          <div className="mt-1 font-mono text-[22px] font-semibold">{connect}</div>
          <VersionLine worldName={world.name} version={world.version} resolved={world.resolved_version} />
          <div className="mt-1 text-[11px] text-dim">
            {world.awake ? 'Online — accepting connections.' : 'Click START SERVER to bring it up.'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <GhostBtn onClick={() => copy(connect)}>{copied ? '✓ COPIED' : '📋 COPY'}</GhostBtn>
          <PrimaryBtn
            disabled={busy || !canMutate || blocked}
            title={
              !canMutate
                ? 'Viewer access — ask an admin to grant operator'
                : blocked && cfg
                  ? `Concurrent limit reached (${state?.host.awake_count ?? 0}/${cfg.max_concurrent_worlds}) — stop another world first`
                  : undefined
            }
            onClick={() => (world.awake ? stop.mutate() : start.mutate())}
          >
            {isStarting
              ? 'STARTING…'
              : isStopping
                ? 'STOPPING…'
                : isUpgrading
                  ? 'UPGRADING…'
                  : world.awake
                    ? '■ STOP SERVER'
                    : '▶ START SERVER'}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
