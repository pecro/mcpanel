import { Navigate } from 'react-router-dom';
import { useAppState, useMe } from '../api/queries';
import { CreateWorldForm } from '../components/home/CreateWorldForm';

export function NewWorld() {
  const { data } = useAppState();
  const me = useMe();
  if (!data) return null;
  // Viewers shouldn't see the create form at all — bounce them home. The
  // backend would 403 the actual POST anyway, but the form's a dead end.
  if (me.data && !me.data.can.mutate) return <Navigate to="/" replace />;
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="font-headline text-[22px] tracking-[0.05em]">New world</h1>
        <p className="mt-1 text-[13px] text-dim">
          Spin up a fresh server, or import an existing world from a zip.
        </p>
      </div>
      <CreateWorldForm host={data.host} imports={data.imports} />
    </div>
  );
}
