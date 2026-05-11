import { NavLink, useParams, useNavigate } from 'react-router-dom';
import type { WorldSummary } from '../../api/types';
import { useMe } from '../../api/queries';

export function LeftRail({
  worlds,
  drawerOpen,
  onClose,
}: {
  worlds: WorldSummary[];
  drawerOpen: boolean;
  onClose: () => void;
}) {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const me = useMe();
  const canCreate = !!me.data?.can.mutate;

  // Body of the rail. Layout is identical mobile vs. desktop; only the
  // outer aside's positioning changes.
  const body = (
    <>
      <div className="eyebrow px-1.5 pb-2 text-[9px]">YOUR WORLDS</div>
      {worlds.map((w) => (
        <WorldCard key={w.name} world={w} active={w.name === name} />
      ))}
      {canCreate && (
        <button
          type="button"
          onClick={() => navigate('/worlds/new')}
          className="mt-2 cursor-pointer rounded-md border border-dashed border-line bg-transparent px-3 py-3.5 text-left text-[13px] font-medium text-dim hover:border-line/80 hover:text-text"
        >
          + &nbsp;New world
        </button>
      )}
      <div className="flex-1" />
      <div className="rounded-md border border-line bg-panel p-3 text-[11px] text-dim">
        <div className="mb-1 font-mono text-[11px] text-text">auto-backup</div>
        <div>nightly · keep 7 days</div>
      </div>
    </>
  );

  return (
    <>
      {/* Backdrop. Only on mobile, only when open. Tap to close. */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-x-0 bottom-0 top-[56px] z-30 bg-black/50 lg:hidden"
        />
      )}
      <aside
        className={`fixed bottom-0 left-0 top-[56px] z-40 flex w-[80%] max-w-[280px] transform flex-col gap-2.5 overflow-auto border-r border-line bg-bg px-3.5 py-5 transition-transform duration-200 nice-scroll lg:static lg:col-start-1 lg:row-start-2 lg:w-auto lg:max-w-none lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:transform-none'
        }`}
      >
        {body}
      </aside>
    </>
  );
}

function WorldCard({ world, active }: { world: WorldSummary; active: boolean }) {
  const sc = statusColor(world.status);
  const st = statusLabel(world.status);
  const tex = world.name.charCodeAt(0) % 2 === 0 ? 'tex-grass-side' : 'tex-stone';
  return (
    <NavLink
      to={`/worlds/${world.name}`}
      className={({ isActive: navActive }) => {
        const isActive = active || navActive;
        return `relative flex cursor-pointer items-center gap-2.5 rounded-md p-2.5 ${
          isActive ? 'border border-line bg-panel-2' : 'border border-transparent'
        }`;
      }}
    >
      {active && (
        <span className="absolute -left-3.5 top-3 bottom-3 w-[3px] rounded bg-accent" />
      )}
      {world.banner_url ? (
        <img
          src={world.banner_url}
          alt=""
          className="h-9 w-9 flex-none overflow-hidden rounded object-cover"
          draggable={false}
        />
      ) : (
        <div className={`pixel h-9 w-9 flex-none overflow-hidden rounded ${tex}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight">{world.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-dim">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: sc }} />
          <span>{st}</span>
          <span>·</span>
          <span>:{world.port}</span>
        </div>
      </div>
    </NavLink>
  );
}

function statusColor(s: string): string {
  if (s === 'running') return 'var(--good)';
  if (s === 'exited') return 'var(--sub)';
  return 'var(--sub)';
}

function statusLabel(s: string): string {
  if (s === 'running') return 'online';
  if (s === 'created') return 'idle';
  return 'stopped';
}
