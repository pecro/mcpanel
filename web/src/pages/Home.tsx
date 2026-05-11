import { Navigate } from 'react-router-dom';
import { useAppState } from '../api/queries';
import { Hero } from '../components/home/Hero';
import { AwakeWarning } from '../components/home/AwakeWarning';
import { HomeTabs } from '../components/home/HomeTabs';

export function Home() {
  const { data } = useAppState();
  if (!data) return null;
  const featured = data.worlds[0];

  // No worlds yet → land directly on the new-world page so the user has
  // somewhere to act, instead of an empty home with a CTA.
  if (!featured) return <Navigate to="/worlds/new" replace />;

  return (
    <div className="grid gap-5 p-4 sm:p-6">
      <div className="min-w-0">
        <Hero world={featured} />
        <div className="h-4" />
        <AwakeWarning awakeCount={data.host.awake_count} />
        <HomeTabs world={featured} gameHostname={data.host.game_hostname} />
      </div>
    </div>
  );
}
