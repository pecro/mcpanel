import { useNavigate } from 'react-router-dom';
import type { WorldSummary } from '../../api/types';
import { HeroBand } from '../art/HeroBand';
import { PrimaryBtn } from '../ui/Button';
import { Stat } from '../ui/atoms';
import {
  useActiveJob,
  useAdminConfig,
  useAppState,
  useMe,
  useStartWorld,
  useStopWorld,
} from '../../api/queries';

export function Hero({ world }: { world: WorldSummary }) {
  const start = useStartWorld(world.name);
  const stop = useStopWorld(world.name);
  const job = useActiveJob(world.name);
  const me = useMe();
  const canMutate = !!me.data?.can.mutate;
  // The admin's concurrent-cap is enforced server-side; pre-disable the
  // Start button here so the operator gets feedback before clicking.
  // Stopping is always allowed — that frees a slot.
  const { data: state } = useAppState();
  const { data: cfg } = useAdminConfig();
  const atCap = !!cfg && (state?.host.awake_count ?? 0) >= cfg.max_concurrent_worlds;
  const blocked = !world.awake && atCap;
  const navigate = useNavigate();
  // Local mutation state covers the moment between click and the first
  // poll; the polled active-job query covers everything after — including
  // jobs in flight when the page is loaded fresh or returned to.
  const isStarting = start.isPending || job.data?.kind === 'start' || job.data?.kind === 'create';
  const isStopping = stop.isPending || job.data?.kind === 'stop';
  const isUpgrading = job.data?.kind === 'upgrade';
  const busy = isStarting || isStopping || isUpgrading || job.data?.kind === 'delete';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <HeroBand backgroundImage={world.banner_url ?? undefined}>
        <div className="absolute inset-x-5 bottom-10 text-white sm:left-7 sm:right-7 sm:bottom-14" style={{ textShadow: '2px 2px 0 rgba(0,0,0,.45)' }}>
          <div className="font-headline text-[10px] tracking-[0.15em] mb-2 sm:text-[11px] sm:mb-3">FEATURED · YOUR WORLD</div>
          <button
            type="button"
            onClick={() => navigate(`/worlds/${world.name}`)}
            className="block w-full break-words text-left font-headline text-[24px] leading-tight tracking-[0.05em] sm:text-[32px]"
          >
            {world.name}
          </button>
          {world.motd && (
            <div className="mt-2 max-w-[460px] text-[13px] italic opacity-95 sm:mt-3 sm:text-[14px]">"{world.motd}"</div>
          )}
        </div>
      </HeroBand>
      <div className="flex flex-col gap-4 bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:gap-7">
          <Stat
            label="STATUS"
            accent={world.awake}
            value={world.status === 'running' ? 'Online' : world.status === 'created' ? 'Idle' : 'Stopped'}
          />
          <Stat label="VERSION" value={world.version || '?'} />
          <Stat label="PORT" value={`:${world.port}`} />
        </div>
        <PrimaryBtn
          size="lg"
          disabled={busy || !canMutate || blocked}
          title={
            !canMutate
              ? 'Viewer access — ask an admin to grant operator'
              : blocked && cfg
                ? `Concurrent limit reached (${state?.host.awake_count ?? 0}/${cfg.max_concurrent_worlds}) — stop another world first`
                : undefined
          }
          onClick={() => (world.awake ? stop.mutate() : start.mutate())}
          className="!h-11 !min-w-0 !w-full !px-5 !text-[12px] sm:!h-[60px] sm:!min-w-[200px] sm:!w-auto sm:!px-9 sm:!text-[15px]"
        >
          {isStarting ? 'STARTING…' : isStopping ? 'STOPPING…' : isUpgrading ? 'UPGRADING…' : world.awake ? '■ STOP' : '▶ START'}
        </PrimaryBtn>
      </div>
    </div>
  );
}
