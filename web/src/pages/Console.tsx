import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppState, useRconCommand } from '../api/queries';
import { useConsoleStream } from '../hooks/useConsoleStream';
import { ApiError } from '../api/client';
import type { WorldSummary } from '../api/types';

type Level = 'INFO' | 'WARN' | 'ERROR' | 'OTHER';

interface ParsedLine {
  raw: string;
  ts: string | null;
  src: string | null;
  level: Level;
  body: string;
}

const LINE_RE = /^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]+?)\/(INFO|WARN|ERROR)\]: (.*)$/;

function parseLine(raw: string): ParsedLine {
  const m = LINE_RE.exec(raw);
  if (!m) return { raw, ts: null, src: null, level: 'OTHER', body: raw };
  return { raw, ts: m[1], src: m[2], level: m[3] as Level, body: m[4] };
}

const LEVELS: Level[] = ['INFO', 'WARN', 'ERROR', 'OTHER'];

const HISTORY_KEY = 'mcpanel.console.history';
const AUTOSCROLL_KEY = 'mcpanel.console.autoScroll';
const WRAP_KEY = 'mcpanel.console.wrapLines';

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === 'true';
  } catch {
    return defaultValue;
  }
}

function readHistory(): string[] {
  try {
    const v = localStorage.getItem(HISTORY_KEY);
    if (!v) return [];
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(-50) : [];
  } catch {
    return [];
  }
}

export function Console() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { data } = useAppState();

  if (!name) return null;

  const world = data?.worlds.find((w) => w.name === name);
  const worlds = data?.worlds ?? [];

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-3 p-3 sm:gap-4 sm:p-6">
      <ConsoleHeader name={name} world={world} worlds={worlds} onPick={(n) => navigate(`/worlds/${n}/console`)} />
      <ConsoleBody key={name} name={name} running={world?.awake ?? false} />
    </div>
  );
}

function ConsoleHeader({
  name,
  world,
  worlds,
  onPick,
}: {
  name: string;
  world?: WorldSummary;
  worlds: WorldSummary[];
  onPick: (n: string) => void;
}) {
  const sc = world?.awake ? 'var(--good)' : 'var(--sub)';
  const status = world?.awake ? 'online' : 'stopped';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Link to={`/worlds/${name}`} className="text-[12px] text-dim hover:text-text">← back</Link>
      <h1 className="text-[16px] font-semibold sm:text-[18px]">{name}</h1>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[11px]">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: sc }} />
        {status}
      </span>
      <div className="ml-auto">
        <select
          value={name}
          onChange={(e) => onPick(e.target.value)}
          className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[13px]"
          aria-label="Switch world"
        >
          {worlds.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name} {w.awake ? '· online' : '· stopped'}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ConsoleBody({ name, running }: { name: string; running: boolean }) {
  // Stream the live log. If the world is stopped, useConsoleStream still
  // pulls the historical tail (docker logs --tail 500), then EventSource
  // closes when the upstream gen() drains.
  const { lines: rawLines } = useConsoleStream(name, true);
  const parsed = useMemo(() => rawLines.map(parseLine), [rawLines]);

  const [grep, setGrep] = useState('');
  const [debouncedGrep, setDebouncedGrep] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedGrep(grep), 150);
    return () => clearTimeout(t);
  }, [grep]);

  const [activeLevels, setActiveLevels] = useState<Set<Level>>(() => new Set(LEVELS));
  const toggleLevel = (l: Level) =>
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  const [autoScroll, setAutoScroll] = useState(() => readBool(AUTOSCROLL_KEY, true));
  const [wrap, setWrap] = useState(() => readBool(WRAP_KEY, false));
  useEffect(() => {
    try { localStorage.setItem(AUTOSCROLL_KEY, String(autoScroll)); } catch {}
  }, [autoScroll]);
  useEffect(() => {
    try { localStorage.setItem(WRAP_KEY, String(wrap)); } catch {}
  }, [wrap]);

  // Local-only Clear: drops everything we've seen so far. The server log
  // is untouched; new lines coming in via SSE will repopulate.
  const [clearedAt, setClearedAt] = useState(0);

  // Locally echoed lines (commands you sent + their RCON responses) that
  // weren't actually emitted by the MC server log stream.
  const [echo, setEcho] = useState<ParsedLine[]>([]);

  const visible = useMemo(() => {
    const all = [...parsed.slice(clearedAt), ...echo];
    const q = debouncedGrep.toLowerCase();
    return all.filter((l) => activeLevels.has(l.level) && (q === '' || l.raw.toLowerCase().includes(q)));
  }, [parsed, clearedAt, echo, debouncedGrep, activeLevels]);

  const scrollRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible, autoScroll]);

  return (
    <div className="grid grid-rows-[auto_1fr_auto] gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => {
          const on = activeLevels.has(l);
          return (
            <button
              key={l}
              type="button"
              onClick={() => toggleLevel(l)}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                on ? `${LEVEL_BG[l]} ${LEVEL_TEXT[l]} border-transparent` : 'border-line text-sub'
              }`}
            >
              {l}
            </button>
          );
        })}
        <input
          type="text"
          value={grep}
          onChange={(e) => setGrep(e.target.value)}
          placeholder="grep…"
          className="w-full rounded-md border border-line bg-panel-2 px-2.5 py-1 text-[12px] sm:ml-2 sm:w-48"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-dim sm:ml-2">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          auto-scroll
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-dim">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          wrap lines
        </label>
        <button
          type="button"
          onClick={() => {
            setClearedAt(parsed.length);
            setEcho([]);
          }}
          className="ml-auto rounded-md border border-line px-2.5 py-1 text-[12px] text-dim hover:text-text"
        >
          Clear
        </button>
      </div>

      <pre
        ref={scrollRef}
        className={`nice-scroll min-h-0 overflow-auto rounded-md bg-[#0a0c10] p-4 font-mono text-[12px] leading-relaxed text-[#cfd6e1] ${
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        }`}
      >
        {visible.length === 0 ? (
          <span className="text-sub">{rawLines.length === 0 ? 'waiting for events…' : 'no lines match the current filters'}</span>
        ) : (
          visible.map((l, i) => <LogRow key={i} line={l} />)
        )}
      </pre>

      <CommandBar name={name} disabled={!running} onEcho={(line) => setEcho((p) => [...p, line])} />
    </div>
  );
}

const LEVEL_BG: Record<Level, string> = {
  INFO: 'bg-good/15',
  WARN: 'bg-warn/15',
  ERROR: 'bg-danger/15',
  OTHER: 'bg-panel-2',
};
const LEVEL_TEXT: Record<Level, string> = {
  INFO: 'text-good',
  WARN: 'text-warn',
  ERROR: 'text-danger',
  OTHER: 'text-dim',
};

function LogRow({ line }: { line: ParsedLine }) {
  if (line.level === 'OTHER' && line.ts === null) {
    return <div>{line.body}</div>;
  }
  return (
    <div>
      {line.ts && <span className="text-sub">[{line.ts}] </span>}
      {line.src && <span className="text-dim">[{line.src}/</span>}
      <span className={LEVEL_TEXT[line.level]}>{line.level}</span>
      {line.src && <span className="text-dim">]</span>}
      <span className="text-dim">: </span>
      {line.body}
    </div>
  );
}

function CommandBar({
  name,
  disabled,
  onEcho,
}: {
  name: string;
  disabled: boolean;
  onEcho: (line: ParsedLine) => void;
}) {
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState<string[]>(() => readHistory());
  const [cursor, setCursor] = useState<number | null>(null);
  const rcon = useRconCommand(name);

  // Persist history (capped at 50) on every change.
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-50)));
    } catch {}
  }, [history]);

  const tsNow = () => new Date().toTimeString().slice(0, 8);

  const send = async () => {
    const v = cmd.trim();
    if (!v) return;
    setHistory((p) => (p[p.length - 1] === v ? p : [...p.slice(-49), v]));
    setCursor(null);
    setCmd('');
    onEcho({ raw: `(you) ${v}`, ts: tsNow(), src: 'rcon', level: 'INFO', body: `(you) ${v}` });
    try {
      const { output } = await rcon.mutateAsync(v);
      const body = output.trim() === '' ? '(no output)' : output;
      for (const part of body.split('\n')) {
        onEcho({ raw: part, ts: tsNow(), src: 'rcon', level: 'INFO', body: part });
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      onEcho({ raw: msg, ts: tsNow(), src: 'rcon', level: 'ERROR', body: msg });
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      e.preventDefault();
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next);
      setCmd(history[next]);
    } else if (e.key === 'ArrowDown') {
      if (cursor === null) return;
      e.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) {
        setCursor(null);
        setCmd('');
      } else {
        setCursor(next);
        setCmd(history[next]);
      }
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2">
      <span className="font-mono text-[12px] text-dim">{disabled ? 'rcon (offline)' : 'rcon ›'}</span>
      <input
        type="text"
        value={cmd}
        onChange={(e) => setCmd(e.target.value)}
        onKeyDown={onKey}
        placeholder={disabled ? 'start the world to send commands' : 'list, say <msg>, time set day, …'}
        disabled={disabled || rcon.isPending}
        className="flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-sub disabled:opacity-50"
      />
      {rcon.isPending && <span className="font-mono text-[11px] text-dim">…</span>}
    </div>
  );
}
