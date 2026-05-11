import { useState } from 'react';
import type { WorldSummary } from '../../api/types';
import { SectionTitle, KeyValue } from '../ui/atoms';
import { useClipboard } from '../../hooks/useClipboard';
import { useIsMigrating } from '../../api/queries';

const TABS = ['Overview', 'Players', 'Backups', 'Properties'] as const;
type Tab = (typeof TABS)[number];

export function HomeTabs({ world, gameHostname }: { world: WorldSummary; gameHostname: string }) {
  const [tab, setTab] = useState<Tab>('Overview');
  return (
    <div className="mt-1.5">
      <div className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px flex-none cursor-pointer border-b-2 px-3 py-3 text-[13px] font-medium sm:px-4 ${
              t === tab ? 'border-accent text-text' : 'border-transparent text-dim hover:text-text'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' && <OverviewPane world={world} gameHostname={gameHostname} />}
      {tab !== 'Overview' && (
        <div className="rounded-md border border-line bg-panel p-5 text-[13px] text-dim">
          Open the world detail page to manage <span className="text-text">{tab.toLowerCase()}</span>.
        </div>
      )}
    </div>
  );
}

function OverviewPane({ world, gameHostname }: { world: WorldSummary; gameHostname: string }) {
  const migrating = useIsMigrating(world.name);
  const connect = `${gameHostname}:${world.port}`;
  const { copy, copied } = useClipboard();
  return (
    <div className="grid gap-6 rounded-lg border border-line bg-panel p-4 sm:p-5 md:grid-cols-2">
      <div>
        <SectionTitle>CONNECT</SectionTitle>
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <div className="min-w-0 flex-1 break-all font-mono text-[13px] font-semibold sm:text-[16px]">{connect}</div>
          <button
            type="button"
            onClick={() => copy(connect)}
            className="flex-none rounded-md bg-accent px-3 py-1.5 font-headline text-[12px] tracking-[1px] text-accent-fg"
          >
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-dim">
          Players paste this into <strong className="text-text">Multiplayer → Add Server</strong>{' '}
          while the server is online.
        </div>
      </div>
      <div>
        <SectionTitle>WORLD INFO</SectionTitle>
        <KeyValue
          rows={[
            ['status', world.awake ? 'online' : world.status === 'created' ? 'idle' : 'stopped'],
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
            ['port', `:${world.port}`],
            ['container', world.container_name],
          ]}
        />
      </div>
    </div>
  );
}
