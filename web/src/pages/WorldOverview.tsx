import { useParams } from 'react-router-dom';
import { useWorld } from '../api/queries';
import { LiveConsole } from '../components/world/LiveConsole';
import { PlayersCard } from '../components/world/PlayersCard';
import { PropertiesCard } from '../components/world/PropertiesCard';

export function WorldOverview() {
  const { name } = useParams<{ name: string }>();
  const { data } = useWorld(name);
  if (!data) return null;
  return (
    <div className="grid gap-4">
      <LiveConsole name={data.name} status={data.status} />
      <PlayersCard world={data} />
      <PropertiesCard world={data} />
    </div>
  );
}
