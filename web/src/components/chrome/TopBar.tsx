import { NavLink, useMatch } from 'react-router-dom';
import type { HostInfo, Role } from '../../api/types';
import { useMe } from '../../api/queries';

interface Tab {
  to: string;
  label: string;
  enabled: boolean;
  /** Optional extra route patterns (besides `to`) that should highlight
   * this tab. e.g. `/worlds/:name/console` should light up Console. */
  alsoActive?: string[];
}

const TABS: Tab[] = [
  { to: '/', label: 'Worlds', enabled: true },
  { to: '/backups', label: 'Backups', enabled: true },
  { to: '/console', label: 'Console', enabled: true, alsoActive: ['/worlds/:name/console'] },
];

const ADMIN_TAB: Tab = { to: '/admin', label: 'Admin', enabled: true };

export function TopBar({
  host,
  user,
  onMenuClick,
}: {
  host?: HostInfo;
  user?: string;
  onMenuClick: () => void;
}) {
  const me = useMe();
  const tabs = me.data?.can.admin ? [...TABS, ADMIN_TAB] : TABS;
  const portRange = host
    ? `:${host.port_range[0]}–${host.port_range[1]}`
    : '';
  return (
    <header className="col-span-full row-start-1 flex items-center justify-between gap-2 border-b border-line bg-bg px-3 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 lg:gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Toggle navigation"
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-md text-dim hover:bg-panel-2 hover:text-text lg:hidden"
        >
          <Hamburger />
        </button>
        <Logo />
        <div className="hidden font-headline text-[11px] tracking-[0.1em] sm:block">MC-PANEL</div>
        <nav className="ml-1 flex gap-0.5 lg:ml-4 lg:gap-1">
          {tabs.map((t) =>
            t.enabled ? <TabLink key={t.to} tab={t} /> : (
              <span
                key={t.to}
                className="rounded-md px-2 py-2 text-[12px] font-medium text-sub lg:px-3.5 lg:text-[13px]"
                title="Coming in Phase 2"
              >
                {t.label}
              </span>
            ),
          )}
        </nav>
      </div>
      <div className="flex min-w-0 items-center gap-2 lg:gap-3">
        {host && (
          <div className="hidden truncate font-mono text-[12px] text-dim xl:block">
            host: <span className="text-text">{host.game_hostname}</span> · ports {portRange}
          </div>
        )}
        <RoleChip />
        {user && (
          <div className="flex flex-none items-center gap-2 rounded-full bg-panel-2 py-1.5 pl-1.5 pr-2.5 lg:pr-3">
            <div className="h-6 w-6 flex-none rounded bg-accent/80" />
            <div className="hidden text-[13px] font-medium sm:block">{user}</div>
            <div className="h-1.5 w-1.5 rounded-full bg-good" />
          </div>
        )}
      </div>
    </header>
  );
}

// Color cues so the user knows at a glance whether they can change anything.
const ROLE_STYLE: Record<Role, { label: string; cls: string }> = {
  admin: { label: 'ADMIN', cls: 'bg-accent/20 text-accent' },
  operator: { label: 'OPERATOR', cls: 'bg-good/20 text-good' },
  user: { label: 'VIEWER', cls: 'bg-panel-2 text-dim' },
};

function RoleChip() {
  const { data } = useMe();
  if (!data?.role) return null;
  const s = ROLE_STYLE[data.role];
  return (
    <span
      className={`hidden flex-none rounded px-1.5 py-0.5 font-headline text-[10px] tracking-[1.5px] sm:inline-block ${s.cls}`}
      title={`Your panel role: ${s.label.toLowerCase()}`}
    >
      {s.label}
    </span>
  );
}

function TabLink({ tab }: { tab: Tab }) {
  // Hooks must be called unconditionally; we always check up to two extra
  // patterns. NavLink already covers `tab.to`.
  const extra1 = useMatch(tab.alsoActive?.[0] ?? '__never__');
  const extra2 = useMatch(tab.alsoActive?.[1] ?? '__never__');
  const extraActive = !!(extra1 || extra2);
  return (
    <NavLink
      to={tab.to}
      end={tab.to === '/'}
      className={({ isActive }) =>
        `rounded-md px-2 py-2 text-[12px] font-medium lg:px-3.5 lg:text-[13px] ${
          isActive || extraActive ? 'bg-panel-2 text-text' : 'text-dim hover:text-text'
        }`
      }
    >
      {tab.label}
    </NavLink>
  );
}

function Hamburger() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="1" y1="2" x2="17" y2="2" />
      <line x1="1" y1="7" x2="17" y2="7" />
      <line x1="1" y1="12" x2="17" y2="12" />
    </svg>
  );
}

function Logo() {
  // 4×4 pixel block — outer ring is the accent, inner 2×2 is a darker shade.
  // Mirrors D1_TopBar's <div className="pixel"> grid in d1-launcher.jsx.
  const cells = [1, 1, 1, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 1, 1, 1];
  return (
    <div className="pixel grid h-7 w-7 flex-none" style={{ gridTemplateColumns: 'repeat(4,1fr)', gridTemplateRows: 'repeat(4,1fr)' }}>
      {cells.map((c, i) => (
        <div
          key={i}
          style={{
            background:
              c === 2
                ? 'color-mix(in srgb, var(--accent) 75%, black)'
                : 'var(--accent)',
          }}
        />
      ))}
    </div>
  );
}
