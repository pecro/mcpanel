import { useState } from 'react';
import type { EditablePropertySpec, WorldDetail } from '../../api/types';
import { useAppState, useMe, useSaveProperties } from '../../api/queries';
import { Card } from '../ui/atoms';
import { GhostBtn, PrimaryBtn } from '../ui/Button';
import { FieldShell, SelectField, TextField } from '../ui/Field';

const BASIC_KEYS = ['motd', 'gamemode', 'difficulty'] as const;

export function PropertiesCard({ world }: { world: WorldDetail }) {
  const { data: state } = useAppState();
  const editable = state?.host.editable_props ?? {};
  const save = useSaveProperties(world.name);
  const me = useMe();
  const canMutate = !!me.data?.can.mutate;
  const [advanced, setAdvanced] = useState(false);

  const initial = Object.fromEntries(
    Object.entries(editable).map(([k, spec]) => [k, world.properties[k] ?? spec.default]),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);

  // Viewers see properties as a read-only mini-list (motd / gamemode /
  // difficulty are interesting context); editing is operator+ only.
  // Render-time gate (after all hooks) so React's hook order is stable.
  if (!canMutate) {
    return (
      <Card>
        <h2 className="mb-1 text-[14px] font-semibold">World settings</h2>
        <p className="mb-3 text-[12px] text-dim">Read-only — operator role required to edit.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          {BASIC_KEYS.filter((k) => editable[k]).map((k) => (
            <RowItem key={k} k={k} value={world.properties[k] ?? editable[k]?.default ?? ''} />
          ))}
        </dl>
      </Card>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(values);
  };

  const advKeys = Object.keys(editable).filter((k) => !BASIC_KEYS.includes(k as (typeof BASIC_KEYS)[number]));

  return (
    <Card>
      <h2 className="mb-1 text-[14px] font-semibold">World settings</h2>
      <p className="mb-4 text-[12px] text-dim">Changes apply on next server start.</p>
      <form onSubmit={onSubmit} className="grid gap-3.5">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {BASIC_KEYS.map((k) =>
            editable[k] ? (
              <PropField key={k} k={k} spec={editable[k]} value={values[k] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [k]: v }))} />
            ) : null,
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-left text-[12px] text-dim hover:text-text"
        >
          {advanced ? '▾' : '▸'} Advanced settings
        </button>
        {advanced && (
          <div className="grid gap-3 sm:grid-cols-2">
            {advKeys.map((k) => (
              <PropField
                key={k}
                k={k}
                spec={editable[k]}
                value={values[k] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [k]: v }))}
              />
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          {save.isSuccess && <span className="text-[11px] text-good">Saved · applies on next start</span>}
          <GhostBtn type="reset" onClick={() => setValues(initial)}>RESET</GhostBtn>
          <PrimaryBtn type="submit" disabled={save.isPending}>
            {save.isPending ? 'SAVING…' : 'SAVE SETTINGS'}
          </PrimaryBtn>
        </div>
      </form>
    </Card>
  );
}

function PropField({
  k,
  spec,
  value,
  onChange,
}: {
  k: string;
  spec: EditablePropertySpec;
  value: string;
  onChange: (v: string) => void;
}) {
  if (spec.type === 'select') {
    return (
      <FieldShell label={k}>
        <SelectField
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={(spec.options ?? []).map((o) => ({ value: o, label: o }))}
        />
      </FieldShell>
    );
  }
  if (spec.type === 'boolean') {
    return (
      <FieldShell label={k}>
        <SelectField
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: 'false', label: 'false' },
            { value: 'true', label: 'true' },
          ]}
        />
      </FieldShell>
    );
  }
  const inputType = spec.type === 'number' ? 'number' : 'text';
  return (
    <FieldShell label={k}>
      <TextField
        mono={spec.type === 'text'}
        type={inputType}
        min={spec.min}
        max={spec.max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

function RowItem({ k, value }: { k: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-dim">{k}</dt>
      <dd className="truncate text-text">{value || <span className="text-dim">—</span>}</dd>
    </>
  );
}
