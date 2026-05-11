import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useAppState, useMe } from '../../api/queries';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';

export function Chrome({ children }: { children: ReactNode }) {
  const me = useMe();
  const { data, isLoading, isError } = useAppState();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes — a tap on a world card
  // navigates and the user expects to see the page they tapped, not the
  // drawer still covering it.
  const location = useLocation();
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // 403 from /me means the user is authenticated by Authelia but not in
  // any of the panel groups (mc-admin/mc-operator/mc-user). Show the
  // no-access wall instead of the normal app — the LeftRail world list
  // and TopBar still render (the user can see the app exists), but
  // <main> is replaced.
  const noAccess = me.error instanceof ApiError && me.error.status === 403;

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[56px_1fr] lg:grid-cols-[248px_minmax(0,1fr)] lg:grid-rows-[64px_1fr]">
      <TopBar
        host={data?.host}
        user={data?.user}
        onMenuClick={() => setDrawerOpen((v) => !v)}
      />
      <LeftRail
        worlds={data?.worlds ?? []}
        drawerOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <main className="col-start-1 row-start-2 overflow-auto nice-scroll lg:col-start-2">
        {noAccess ? (
          <NoAccessWall />
        ) : isLoading || me.isLoading ? (
          <div className="p-6 text-dim">Loading…</div>
        ) : isError ? (
          <div className="p-6 text-danger">
            Could not reach the panel API. Make sure you're signed in via Authelia.
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

function NoAccessWall() {
  return (
    <div className="mx-auto max-w-md p-8 sm:p-12">
      <div className="rounded-xl border border-line bg-panel p-8 text-center">
        <div className="mb-3 font-headline text-[14px] tracking-[0.15em] text-dim">NO ACCESS</div>
        <h2 className="mb-3 text-[18px] font-semibold">You're signed in, but not allowed in mcpanel</h2>
        <p className="mb-6 text-[13px] leading-relaxed text-dim">
          You need to be in one of the groups your operator mapped to an
          mcpanel role (admin, operator, or user) in your identity provider.
          Ask the host operator to grant you a role.
        </p>
      </div>
    </div>
  );
}
