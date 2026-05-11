import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeleteWorld, useMe } from '../../api/queries';
import { ApiError } from '../../api/client';
import { Eyebrow } from '../ui/atoms';
import { GhostBtn } from '../ui/Button';
import { TextField } from '../ui/Field';

export function DangerCard({ name }: { name: string }) {
  const [confirm, setConfirm] = useState('');
  const navigate = useNavigate();
  const del = useDeleteWorld(name);
  const me = useMe();
  const armed = confirm === name;

  // Permanent world deletion is admin-only. Operators don't see the card
  // at all, matching the policy on the backend.
  if (!me.data?.can.delete_world) return null;

  return (
    <section className="rounded-md border border-danger/40 bg-panel p-[18px]">
      <Eyebrow className="mb-2 text-danger">DANGER ZONE</Eyebrow>
      <h2 className="mb-1 text-[14px] font-semibold">Delete world</h2>
      <p className="mb-3 text-[12px] text-dim">
        The container is removed and world data is moved to an archive directory — not erased.
        Type the world name below to confirm.
      </p>
      <div className="flex gap-2">
        <TextField
          mono
          placeholder={`type ${name} to confirm`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />
        <GhostBtn
          danger
          disabled={!armed || del.isPending}
          onClick={() =>
            del.mutate(confirm, {
              onSuccess: () => navigate('/'),
            })
          }
        >
          {del.isPending ? 'DELETING…' : 'Delete'}
        </GhostBtn>
      </div>
      {del.isError && (
        <div className="mt-2 text-[11px] text-danger">
          {del.error instanceof ApiError ? del.error.message : 'Delete failed'}
        </div>
      )}
    </section>
  );
}
