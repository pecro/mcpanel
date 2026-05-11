import { Navigate } from 'react-router-dom';
import { useAppState } from '../api/queries';

/** TopBar's `/console` tab pointer. Forwards to the most useful per-world
 * console: the first running world if any, else the first world we know
 * about, else home. */
export function ConsoleRedirect() {
  const { data, isLoading } = useAppState();
  if (isLoading) return null;
  const worlds = data?.worlds ?? [];
  const target = worlds.find((w) => w.awake) ?? worlds[0];
  if (!target) return <Navigate to="/" replace />;
  return <Navigate to={`/worlds/${target.name}/console`} replace />;
}
