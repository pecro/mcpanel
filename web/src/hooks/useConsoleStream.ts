import { useEffect, useRef, useState } from 'react';

const MAX_LINES = 500;

export function useConsoleStream(name: string, enabled: boolean) {
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`/api/v1/worlds/${name}/console`);
    esRef.current = es;
    setLive(true);

    es.onmessage = (e) => {
      setLines((prev) => {
        const next = prev.length >= MAX_LINES ? prev.slice(-MAX_LINES + 1) : prev;
        return [...next, e.data];
      });
    };
    es.onerror = () => {
      setLive(false);
      es.close();
    };
    return () => {
      es.close();
      esRef.current = null;
      setLive(false);
    };
  }, [name, enabled]);

  return { lines, live };
}
