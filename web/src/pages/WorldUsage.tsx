import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { UsageEvent } from '../api/queries';
import { useUsage } from '../api/queries';
import { Card } from '../components/ui/atoms';

interface WindowDef {
  key: '4h' | '1d' | '3d' | '7d';
  label: string;
  unitLabel: string; // for the offset readout: "hrs" / "day" / "days" etc.
  step: number; // single window-size multiplier in the offset readout
  ms: number;
}

const WINDOWS: WindowDef[] = [
  { key: '4h', label: '4 hours', unitLabel: 'hrs', step: 4, ms: 4 * 3_600_000 },
  { key: '1d', label: '1 day', unitLabel: 'day', step: 1, ms: 24 * 3_600_000 },
  { key: '3d', label: '3 days', unitLabel: 'days', step: 3, ms: 3 * 24 * 3_600_000 },
  { key: '7d', label: '7 days', unitLabel: 'days', step: 7, ms: 7 * 24 * 3_600_000 },
];

interface TimelinePoint {
  t: number;
  count: number;
  online: string[];
  trigger: UsageEvent;
}

export function WorldUsage() {
  const { name } = useParams<{ name: string }>();
  const [windowKey, setWindowKey] = useState<WindowDef['key']>('1d');
  const [offset, setOffset] = useState(0);
  // anchor 'now' once per pick so navigating Prev/Next doesn't drift
  // while the user is reading. Refresh on window change or on reset.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const win = WINDOWS.find((w) => w.key === windowKey)!;
  const untilMs = nowMs - offset * win.ms;
  const sinceMs = untilMs - win.ms;

  const usage = useUsage(name ?? '', sinceMs, untilMs);

  if (!name) return null;

  const pickWindow = (k: WindowDef['key']) => {
    setWindowKey(k);
    setOffset(0);
    setNowMs(Date.now());
  };

  const goPrev = () => setOffset((o) => o + 1);
  const goNext = () => setOffset((o) => Math.max(0, o - 1));
  const goNow = () => {
    setOffset(0);
    setNowMs(Date.now());
  };

  return (
    <div className="grid gap-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 className="text-[14px] font-semibold">Player activity</h2>
          <RangeBadge offset={offset} win={win} sinceMs={sinceMs} untilMs={untilMs} />
          <div className="ml-auto flex items-center gap-2">
            <NavBtn onClick={goPrev} title={`Previous ${win.label}`}>← prev</NavBtn>
            <NavBtn onClick={goNext} disabled={offset === 0} title={`Next ${win.label}`}>next →</NavBtn>
            {offset > 0 && (
              <NavBtn onClick={goNow} title="Jump back to now">now</NavBtn>
            )}
            <select
              value={windowKey}
              onChange={(e) => pickWindow(e.target.value as WindowDef['key'])}
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-[12px]"
            >
              {WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
          </div>
        </div>
        {usage.isLoading ? (
          <div className="text-dim">Loading usage…</div>
        ) : usage.isError ? (
          <div className="text-danger">Could not load usage data.</div>
        ) : (
          <UsageChart
            events={usage.data?.events ?? []}
            initialOnline={usage.data?.online_at_start ?? []}
            sinceMs={sinceMs}
            untilMs={untilMs}
          />
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-semibold">Event log</h2>
        {usage.isLoading ? (
          <div className="text-dim">Loading…</div>
        ) : !usage.data || usage.data.events.length === 0 ? (
          <div className="text-[13px] text-dim">No join or leave events in this window.</div>
        ) : (
          <EventLog events={usage.data.events} />
        )}
      </Card>
    </div>
  );
}

function NavBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-line px-2.5 py-1 text-[12px] text-text hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function RangeBadge({
  offset,
  win,
  sinceMs,
  untilMs,
}: {
  offset: number;
  win: WindowDef;
  sinceMs: number;
  untilMs: number;
}) {
  // "0 to 4 hrs ago" / "4 to 8 hrs ago" / "0 to 1 day ago" / "1 to 2 days ago" / etc.
  const lo = offset * win.step;
  const hi = (offset + 1) * win.step;
  const unit =
    win.key === '4h' ? 'hrs ago' : hi === 1 && win.key === '1d' ? 'day ago' : 'days ago';
  const offsetLabel = offset === 0 ? `past ${win.label}` : `${lo} to ${hi} ${unit}`;
  return (
    <span className="font-mono text-[11px] text-dim">
      {offsetLabel}
      <span className="ml-2 text-sub">
        {formatRange(sinceMs, untilMs, win)}
      </span>
    </span>
  );
}

function formatRange(sinceMs: number, untilMs: number, win: WindowDef): string {
  const since = new Date(sinceMs);
  const until = new Date(untilMs);
  const sameDay =
    since.getFullYear() === until.getFullYear() &&
    since.getMonth() === until.getMonth() &&
    since.getDate() === until.getDate();
  // Sub-day windows: show date once + HH:MM range. Multi-day: show
  // start date + end date, no times.
  if (win.key === '4h' || (win.key === '1d' && sameDay)) {
    const datePart = since.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const t1 = since.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const t2 = until.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `· ${datePart} ${t1}–${t2}`;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `· ${fmt(since)} → ${fmt(until)}`;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

function buildTimeline(events: UsageEvent[], initialOnline: string[]): TimelinePoint[] {
  const online = new Set<string>(initialOnline);
  const out: TimelinePoint[] = [];
  for (const e of events) {
    if (e.type === 'join') online.add(e.player);
    else online.delete(e.player);
    const t = Date.parse(e.t);
    if (out.length && out[out.length - 1].t === t) {
      out[out.length - 1] = {
        t,
        count: online.size,
        online: [...online].sort(),
        trigger: e,
      };
    } else {
      out.push({ t, count: online.size, online: [...online].sort(), trigger: e });
    }
  }
  return out;
}

function chartTickStrategy(durationMs: number): { stepMs: number; format: (d: Date) => string } {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (durationMs <= 4 * HOUR) {
    return {
      stepMs: HOUR,
      format: (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    };
  }
  if (durationMs <= DAY) {
    return {
      stepMs: 4 * HOUR,
      format: (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    };
  }
  if (durationMs <= 3 * DAY) {
    return {
      stepMs: 12 * HOUR,
      format: (d) => {
        const h = d.getHours();
        if (h === 0) return `${d.getMonth() + 1}/${d.getDate()}`;
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      },
    };
  }
  return {
    stepMs: DAY,
    format: (d) => `${d.getMonth() + 1}/${d.getDate()}`,
  };
}

function UsageChart({
  events,
  initialOnline,
  sinceMs,
  untilMs,
}: {
  events: UsageEvent[];
  initialOnline: string[];
  sinceMs: number;
  untilMs: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const timeline = useMemo(() => buildTimeline(events, initialOnline), [events, initialOnline]);
  const initialCount = initialOnline.length;
  const maxCount = Math.max(1, initialCount, ...timeline.map((p) => p.count));

  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const height = 220;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = height - padT - padB;

  const x = (t: number) => padL + ((t - sinceMs) / (untilMs - sinceMs)) * innerW;
  const y = (count: number) => padT + (1 - count / maxCount) * innerH;

  const path = useMemo(() => {
    let d = `M ${x(sinceMs)} ${y(initialCount)}`;
    let prev = initialCount;
    for (const pt of timeline) {
      const tx = x(pt.t);
      d += ` L ${tx} ${y(prev)} L ${tx} ${y(pt.count)}`;
      prev = pt.count;
    }
    d += ` L ${x(untilMs)} ${y(prev)}`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, width, sinceMs, untilMs, initialCount]);

  const [hoverX, setHoverX] = useState<number | null>(null);
  const hoverPoint = useMemo(() => {
    if (hoverX == null) return null;
    const t = sinceMs + ((hoverX - padL) / innerW) * (untilMs - sinceMs);
    let active: TimelinePoint | null = null;
    for (const p of timeline) {
      if (p.t > t) break;
      active = p;
    }
    if (!active) {
      // Before the first event — synthesize a "point" reflecting initial
      // state so the tooltip still has something to show.
      return {
        t,
        point: {
          t: sinceMs,
          count: initialCount,
          online: [...initialOnline].sort(),
          trigger: { t: '', type: 'join' as const, player: '' },
        },
      };
    }
    return { t, point: active };
  }, [hoverX, timeline, sinceMs, untilMs, innerW, initialOnline, initialCount]);

  const yTicks = maxCount <= 1 ? [0, 1] : [0, Math.ceil(maxCount / 2), maxCount];

  const { stepMs, format: fmtTick } = chartTickStrategy(untilMs - sinceMs);
  const xTicks: number[] = [];
  // Ticks aligned to natural boundaries (top of hour for hourly, midnight
  // for daily) — start from the first aligned tick >= sinceMs.
  const stepStart = Math.ceil(sinceMs / stepMs) * stepMs;
  for (let t = stepStart; t <= untilMs; t += stepMs) xTicks.push(t);

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = rect.width / width;
          setHoverX((e.clientX - rect.left) / scale);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {yTicks.map((c) => (
          <g key={c}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y(c)}
              y2={y(c)}
              stroke="var(--line)"
              strokeDasharray="2 3"
            />
            <text x={padL - 6} y={y(c) + 3} textAnchor="end" className="fill-sub text-[10px]">
              {c}
            </text>
          </g>
        ))}
        {xTicks.map((t) => {
          const tx = x(t);
          if (tx < padL - 0.5 || tx > width - padR + 0.5) return null;
          return (
            <g key={t}>
              <line x1={tx} x2={tx} y1={padT} y2={height - padB} stroke="var(--line)" strokeOpacity="0.4" />
              <text x={tx} y={height - padB + 14} textAnchor="middle" className="fill-sub text-[10px]">
                {fmtTick(new Date(t))}
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="miter" />
        {timeline.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.count)} r={2.5} className="fill-accent" />
        ))}
        {hoverX != null && hoverX >= padL && hoverX <= width - padR && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padT}
            y2={height - padB}
            stroke="var(--text)"
            strokeOpacity="0.4"
          />
        )}
      </svg>
      {hoverPoint && hoverPoint.point && hoverX != null && (
        <HoverTooltip
          xPx={hoverX}
          width={width}
          point={hoverPoint.point}
          atTime={hoverPoint.t}
        />
      )}
    </div>
  );
}

function HoverTooltip({
  xPx,
  width,
  point,
  atTime,
}: {
  xPx: number;
  width: number;
  point: TimelinePoint;
  atTime: number;
}) {
  const right = xPx > width * 0.6;
  const style: React.CSSProperties = right
    ? { right: width - xPx + 8 }
    : { left: xPx + 8 };
  return (
    <div
      className="pointer-events-none absolute top-2 max-w-[260px] rounded-md border border-line bg-panel px-3 py-2 text-[11px] shadow-lg"
      style={style}
    >
      <div className="font-mono text-text">{formatLocal(atTime)}</div>
      <div className="mt-1 text-dim">
        {point.count === 0
          ? 'no players online'
          : `${point.count} player${point.count === 1 ? '' : 's'} online`}
      </div>
      {point.online.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {point.online.map((p) => (
            <li key={p} className="font-mono text-text">{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function EventLog({ events }: { events: UsageEvent[] }) {
  const reversed = useMemo(() => [...events].reverse(), [events]);
  return (
    <div className="grid max-h-[320px] gap-px overflow-auto rounded-md border border-line nice-scroll">
      {reversed.map((e, i) => (
        <div
          key={i}
          className="grid grid-cols-[112px_64px_1fr] gap-3 bg-panel-2 px-3 py-1.5 text-[12px]"
        >
          <span className="font-mono text-dim">{formatLocal(Date.parse(e.t))}</span>
          <span className={e.type === 'join' ? 'text-good' : 'text-sub'}>
            {e.type === 'join' ? 'joined' : 'left'}
          </span>
          <span className="min-w-0 truncate font-mono">
            {e.player}
            {e.reason ? <span className="ml-2 text-sub">({e.reason})</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatLocal(t: number): string {
  const d = new Date(t);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
