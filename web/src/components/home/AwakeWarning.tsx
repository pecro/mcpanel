import { useAdminConfig } from '../../api/queries';

export function AwakeWarning({ awakeCount }: { awakeCount: number }) {
  // Read the admin's concurrent-worlds cap. Warning only fires when the
  // panel is over the cap; below it, multiple-running is the intended
  // state (admin set the cap there on purpose).
  const { data: cfg } = useAdminConfig();
  const cap = cfg?.max_concurrent_worlds ?? 1;
  if (awakeCount <= cap) return null;
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-md border border-warn bg-warn/10 px-4 py-3 text-[13px] text-warn">
      <span className="font-mono font-bold">⚠</span>
      <span>
        {awakeCount} worlds awake (cap is {cap}). Stop {awakeCount - cap} to get back under
        the limit.
      </span>
    </div>
  );
}
