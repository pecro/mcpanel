import type { ReactNode } from 'react';

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow text-[9px] ${className}`}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <Eyebrow>{children}</Eyebrow>
      {sub && <div className="font-mono text-[11px] text-sub">{sub}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow text-[7px]" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div className={`text-[16px] font-semibold ${accent ? 'text-accent' : ''}`}>{value}</div>
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'sub';
}) {
  const map: Record<typeof tone, string> = {
    neutral: 'bg-panel-2 text-text border border-line',
    good: 'bg-good/15 text-good border border-good/40',
    warn: 'bg-warn/10 text-warn border border-warn/40',
    danger: 'bg-danger/10 text-danger border border-danger/40',
    sub: 'bg-panel-2 text-sub border border-line',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] ${map[tone]}`}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <Pill tone="good">
        <span className="h-1.5 w-1.5 rounded-full bg-good" /> ONLINE
      </Pill>
    );
  }
  if (status === 'created' || status === 'none') {
    return <Pill tone="sub">IDLE · NEVER STARTED</Pill>;
  }
  return <Pill tone="sub">STOPPED</Pill>;
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-line bg-panel p-[18px] ${className}`}>
      {children}
    </section>
  );
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="text-[13px]">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className={`flex flex-col gap-0.5 py-[7px] sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${i > 0 ? 'border-t border-line' : ''}`}
        >
          <dt className="flex-none text-dim">{k}</dt>
          <dd className="min-w-0 break-all font-mono text-text sm:text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
