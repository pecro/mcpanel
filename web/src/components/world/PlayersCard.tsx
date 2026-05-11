import { useMemo, useState } from 'react';
import type { WorldDetail } from '../../api/types';
import { ApiError } from '../../api/client';
import {
  useKnownPlayers,
  useOpToggle,
  useWhitelistAdd,
  useWhitelistRemove,
} from '../../api/queries';
import { Card } from '../ui/atoms';
import { TextField } from '../ui/Field';
import { PrimaryBtn } from '../ui/Button';

export function PlayersCard({ world }: { world: WorldDetail }) {
  const [player, setPlayer] = useState('');
  const opsSet = new Set(world.ops.map((p) => p.toLowerCase()));
  const add = useWhitelistAdd(world.name);
  const remove = useWhitelistRemove(world.name);
  const toggle = useOpToggle(world.name);
  const known = useKnownPlayers();

  // Suggest only players who aren't already on this world's whitelist —
  // re-suggesting somebody already added is just noise.
  const suggestions = useMemo(() => {
    const onList = new Set(world.whitelist.map((n) => n.toLowerCase()));
    return (known.data ?? [])
      .map((p) => p.name)
      .filter((n) => !onList.has(n.toLowerCase()));
  }, [known.data, world.whitelist]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = player.trim();
    if (!trimmed) return;
    add.mutate(trimmed, {
      onSuccess: () => setPlayer(''),
    });
  };

  const error = add.error instanceof ApiError ? add.error.message : null;

  return (
    <Card>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">Whitelist & operators</h2>
        <span className="font-mono text-[11px] text-sub">
          {world.whitelist.length} whitelisted · {world.ops.length} op{world.ops.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mb-4 text-[12px] text-dim">
        Only whitelisted players can join. Op grants admin commands. Names are validated against Mojang on add.
      </p>

      {world.whitelist.length === 0 ? (
        <div className="rounded-md border border-dashed border-line bg-panel-2 p-4 text-center text-[12px] text-dim">
          No players yet. Add one below.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {world.whitelist.map((name) => {
            const isOp = opsSet.has(name.toLowerCase());
            return (
              <li
                key={name}
                className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1.5"
              >
                <div className="pixel tex-grass-side h-7 w-7 flex-none rounded" />
                <div className="flex-1 truncate font-mono text-[13px]">{name}</div>
                <button
                  type="button"
                  onClick={() => toggle.mutate({ player: name, op: !isOp })}
                  disabled={toggle.isPending}
                  className={`rounded-full px-2.5 py-0.5 font-headline text-[9px] tracking-[0.1em] ${
                    isOp
                      ? 'bg-accent text-accent-fg'
                      : 'border border-line text-dim hover:border-accent hover:text-text'
                  }`}
                  title={isOp ? 'remove op' : 'make op'}
                >
                  {isOp ? '✓ OP' : 'OP'}
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(name)}
                  disabled={remove.isPending}
                  className="rounded-md px-1.5 text-dim hover:text-danger"
                  title="remove from whitelist"
                  aria-label={`remove ${name}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <TextField
          mono
          placeholder="Minecraft username"
          value={player}
          onChange={(e) => setPlayer(e.target.value)}
          autoComplete="off"
          list="known-players"
        />
        <datalist id="known-players">
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <PrimaryBtn type="submit" disabled={add.isPending}>
          {add.isPending ? 'ADDING…' : 'ADD'}
        </PrimaryBtn>
      </form>
      {error && <div className="mt-2 text-[11px] text-danger">{error}</div>}
      {(remove.error instanceof ApiError) && (
        <div className="mt-2 text-[11px] text-danger">{remove.error.message}</div>
      )}
      {(toggle.error instanceof ApiError) && (
        <div className="mt-2 text-[11px] text-danger">{toggle.error.message}</div>
      )}
    </Card>
  );
}
