import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConsoleStream } from '../../hooks/useConsoleStream';
import { Card } from '../ui/atoms';

export function LiveConsole({ name, status }: { name: string; status: string }) {
  const [open, setOpen] = useState(false);
  const { lines, live } = useConsoleStream(name, open);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open || !boxRef.current) return;
    const el = boxRef.current;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  if (status === 'created' || status === 'none') {
    return (
      <Card>
        <h2 className="mb-3 text-[14px] font-semibold">Live console</h2>
        <pre className="rounded-md bg-[#0a0c10] p-4 font-mono text-[12px] leading-relaxed text-sub">
          Server hasn't been started yet. Click <span className="text-text">Start server</span> above
          (or have a player connect on port {/* port unknown here */}—) to begin.
        </pre>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold">Live console</h2>
        {open && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] ${
              live ? 'bg-good/15 text-good' : 'bg-sub/20 text-sub'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-good' : 'bg-sub'}`} />
            {live ? 'live' : 'offline'}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[12px] text-dim hover:text-text"
        >
          {open ? '▾ hide log stream' : '▸ show log stream'}
        </button>
        <Link
          to={`/worlds/${name}/console`}
          className="text-[12px] text-dim hover:text-text"
        >
          open full console →
        </Link>
      </div>
      {open && (
        <pre
          ref={boxRef}
          className="nice-scroll max-h-[260px] overflow-auto rounded-md bg-[#0a0c10] p-4 font-mono text-[12px] leading-relaxed text-[#cfd6e1]"
        >
          {lines.length === 0 ? (
            <span className="text-sub">waiting for events…</span>
          ) : (
            lines.map((l, i) => <div key={i}>{l}</div>)
          )}
        </pre>
      )}
    </Card>
  );
}
