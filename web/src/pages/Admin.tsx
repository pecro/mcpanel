import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAdminConfig, useMe, useUpdateAdminConfig } from '../api/queries';
import { Card, Eyebrow } from '../components/ui/atoms';
import { GhostBtn, PrimaryBtn } from '../components/ui/Button';

export function Admin() {
  const me = useMe();
  // Bounce non-admins. Frontend gate; backend enforces too.
  if (me.data && !me.data.can.admin) return <Navigate to="/" replace />;
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="font-headline text-[22px] tracking-[0.05em]">Admin settings</h1>
        <p className="mt-1 text-[13px] text-dim">
          Panel-wide knobs only mc-admins can change. New-world creation and per-world edits use
          these bounds — operators cannot exceed them.
        </p>
      </div>
      <div className="grid gap-5">
        <MemoryBoundsCard />
        <ConcurrencyCapCard />
      </div>
    </div>
  );
}

function MemoryBoundsCard() {
  const { data: cfg } = useAdminConfig();
  const update = useUpdateAdminConfig();
  const [minGb, setMinGb] = useState<number | null>(null);
  const [maxGb, setMaxGb] = useState<number | null>(null);
  // Seed local state once the config arrives. Keep edits local until Save —
  // dragging a slider shouldn't fire a PATCH on every tick.
  useEffect(() => {
    if (!cfg) return;
    if (minGb === null) setMinGb(cfg.world_memory_min_gb);
    if (maxGb === null) setMaxGb(cfg.world_memory_max_gb);
  }, [cfg, minGb, maxGb]);

  if (!cfg || minGb === null || maxGb === null) {
    return (
      <Card>
        <div className="text-[13px] text-dim">Loading…</div>
      </Card>
    );
  }

  const dirty = minGb !== cfg.world_memory_min_gb || maxGb !== cfg.world_memory_max_gb;
  const valid = minGb >= cfg.memory_gb_floor && maxGb <= cfg.memory_gb_ceiling && minGb <= maxGb;

  // Keep min ≤ max as the user drags either slider — clamp the other one.
  const setMin = (v: number) => {
    setMinGb(v);
    if (v > maxGb) setMaxGb(v);
  };
  const setMax = (v: number) => {
    setMaxGb(v);
    if (v < minGb) setMinGb(v);
  };

  return (
    <Card>
      <Eyebrow className="mb-2">WORLD MEMORY BOUNDS</Eyebrow>
      <p className="mb-5 text-[12px] text-dim">
        Range of JVM heap (<code>-Xmx</code>) sizes operators may pick when creating or editing a
        world. Set both to the same value to lock the panel at one size. Container cgroup limit
        adds 1 GiB headroom on top.
      </p>

      <div className="mb-6 grid gap-5">
        <Slider
          label="Minimum"
          value={minGb}
          floor={cfg.memory_gb_floor}
          ceiling={cfg.memory_gb_ceiling}
          onChange={setMin}
        />
        <Slider
          label="Maximum"
          value={maxGb}
          floor={cfg.memory_gb_floor}
          ceiling={cfg.memory_gb_ceiling}
          onChange={setMax}
        />
      </div>

      <div className="mb-4 rounded-md border border-line bg-panel-2 p-3 font-mono text-[12px]">
        Operators can pick:{' '}
        <span className="text-text">
          {minGb === maxGb ? `${minGb} GB only` : `${minGb}–${maxGb} GB`}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <PrimaryBtn
          disabled={!dirty || !valid || update.isPending}
          onClick={() =>
            update.mutate({
              world_memory_min_gb: minGb,
              world_memory_max_gb: maxGb,
              max_concurrent_worlds: cfg.max_concurrent_worlds,
            })
          }
        >
          {update.isPending ? 'SAVING…' : 'SAVE'}
        </PrimaryBtn>
        {dirty && (
          <GhostBtn
            type="button"
            onClick={() => {
              setMinGb(cfg.world_memory_min_gb);
              setMaxGb(cfg.world_memory_max_gb);
            }}
          >
            REVERT
          </GhostBtn>
        )}
        {update.isError && (
          <span className="text-[11px] text-danger">
            {update.error instanceof ApiError ? update.error.message : 'Save failed'}
          </span>
        )}
        {update.isSuccess && !dirty && <span className="text-[11px] text-good">Saved.</span>}
      </div>
    </Card>
  );
}

function Slider({
  label,
  value,
  floor,
  ceiling,
  onChange,
}: {
  label: string;
  value: number;
  floor: number;
  ceiling: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-dim">{label}</span>
        <span className="font-mono text-[14px] font-semibold text-text">{value} GB</span>
      </div>
      <input
        type="range"
        min={floor}
        max={ceiling}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-accent"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-sub">
        <span>{floor} GB</span>
        <span>{ceiling} GB</span>
      </div>
    </div>
  );
}

function ConcurrencyCapCard() {
  const { data: cfg } = useAdminConfig();
  const update = useUpdateAdminConfig();
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => {
    if (cfg && cap === null) setCap(cfg.max_concurrent_worlds);
  }, [cfg, cap]);

  if (!cfg || cap === null) {
    return (
      <Card>
        <div className="text-[13px] text-dim">Loading…</div>
      </Card>
    );
  }

  const dirty = cap !== cfg.max_concurrent_worlds;
  const valid = cap >= 1 && cap <= cfg.max_concurrent_worlds_ceiling;

  return (
    <Card>
      <Eyebrow className="mb-2">CONCURRENT WORLDS LIMIT</Eyebrow>
      <p className="mb-5 text-[12px] text-dim">
        Hardest cap on how many worlds may run at the same time. Operators can create as many
        worlds as they want; they just can't START a new one if the panel is already at this
        limit. Existing running worlds are unaffected when you lower the cap — they keep
        running until someone stops them.
      </p>

      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-dim">1</span>
        <span className="font-mono text-[14px] font-semibold text-text">
          {cap} world{cap === 1 ? '' : 's'}
        </span>
        <span className="font-mono text-[11px] text-dim">
          {cfg.max_concurrent_worlds_ceiling}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={cfg.max_concurrent_worlds_ceiling}
        step={1}
        value={cap}
        onChange={(e) => setCap(parseInt(e.target.value, 10))}
        className="mb-5 w-full accent-accent"
      />

      <div className="flex items-center gap-3">
        <PrimaryBtn
          disabled={!dirty || !valid || update.isPending}
          onClick={() =>
            update.mutate({
              world_memory_min_gb: cfg.world_memory_min_gb,
              world_memory_max_gb: cfg.world_memory_max_gb,
              max_concurrent_worlds: cap,
            })
          }
        >
          {update.isPending ? 'SAVING…' : 'SAVE'}
        </PrimaryBtn>
        {dirty && (
          <GhostBtn type="button" onClick={() => setCap(cfg.max_concurrent_worlds)}>
            REVERT
          </GhostBtn>
        )}
        {update.isError && (
          <span className="text-[11px] text-danger">
            {update.error instanceof ApiError ? update.error.message : 'Save failed'}
          </span>
        )}
      </div>
    </Card>
  );
}
