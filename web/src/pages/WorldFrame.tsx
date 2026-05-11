import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useWorld } from '../api/queries';
import { ApiError } from '../api/client';
import { ConnectHero } from '../components/world/ConnectHero';
import {
  BackupsCard,
  DetailsCard,
  ExportCard,
  MemoryCard,
  UpgradeCard,
} from '../components/world/Sidebar';
import { DangerCard } from '../components/world/DangerCard';

// Thin shell shared by every per-world tab. Owns the breadcrumb, hero,
// tab strip, and the right-rail sidebar (admin actions stay accessible
// from any tab). Tab content is rendered through <Outlet />.
//
// Re-keyed on world name so an in-flight start/stop on world A doesn't
// appear pending on world B's button — react-router would otherwise
// preserve the underlying component instance across the param change.
export function WorldFrame() {
  const { name } = useParams<{ name: string }>();
  if (!name) return null;
  return <Frame key={name} name={name} />;
}

function Frame({ name }: { name: string }) {
  const { data, isLoading, error } = useWorld(name);

  if (isLoading) return <div className="p-6 text-dim">Loading…</div>;
  if (error || !data) {
    const msg = error instanceof ApiError ? error.message : 'World not found';
    return (
      <div className="p-6">
        <div className="mb-4 text-[12px] text-dim">
          <Link to="/" className="hover:text-text">worlds</Link>
        </div>
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">{msg}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="text-[12px] text-dim lg:col-span-2">
        <Link to="/" className="hover:text-text">worlds</Link> /{' '}
        <span className="text-text">{data.name}</span>
      </div>
      <div className="lg:col-span-2">
        <ConnectHero world={data} />
      </div>
      <div className="lg:col-span-2">
        <TabStrip name={name} />
      </div>
      <div className="min-w-0">
        <Outlet />
      </div>
      <div className="grid content-start gap-4">
        <DetailsCard world={data} />
        <BackupsCard world={data} />
        <MemoryCard world={data} />
        <UpgradeCard world={data} />
        {data.status !== 'created' && data.status !== 'none' && <ExportCard world={data} />}
        <DangerCard name={data.name} />
      </div>
    </div>
  );
}

function TabStrip({ name }: { name: string }) {
  const tabs: { to: string; label: string; end?: boolean }[] = [
    { to: `/worlds/${name}`, label: 'Overview', end: true },
    { to: `/worlds/${name}/usage`, label: 'Usage' },
  ];
  return (
    <div className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-line">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `-mb-px flex-none cursor-pointer border-b-2 px-3 py-2.5 text-[13px] font-medium sm:px-4 ${
              isActive ? 'border-accent text-text' : 'border-transparent text-dim hover:text-text'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
      <Link
        to={`/worlds/${name}/console`}
        className="-mb-px ml-auto flex-none border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-dim hover:text-text sm:px-4"
        title="Open the full console"
      >
        Console →
      </Link>
    </div>
  );
}
