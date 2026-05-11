import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import type { HostInfo } from '../../api/types';
import { ApiError } from '../../api/client';
import { useAdminConfig, useCreateWorld, useMcVersions } from '../../api/queries';
import { PrimaryBtn } from '../ui/Button';
import { FieldShell, TextField, SelectField } from '../ui/Field';
import { Eyebrow, SectionTitle } from '../ui/atoms';
import { ImportDialog } from './ImportDialog';

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

const schema = z.object({
  name: z.string().regex(NAME_RE, 'lowercase letters, digits, dashes; must start with a letter'),
  version: z.string(),
  mc_type: z.string(),
  seed: z.string(),
  motd: z.string(),
  gamemode: z.string(),
  difficulty: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function CreateWorldForm({ host, imports }: { host: HostInfo; imports: string[] }) {
  const navigate = useNavigate();
  const create = useCreateWorld({
    onSuccess: (w) => navigate(`/worlds/${w.name}`),
  });
  const { data: adminCfg } = useAdminConfig();

  // Import-dialog state. Either a file (upload path) or a host source
  // (imports/ pick path) opens the modal; both are mutually exclusive.
  const [importing, setImporting] = useState<{ file: File | null; source: string | null } | null>(null);

  // Mojang's published version manifest. While loading we still render the
  // form with just the LATEST option; the dropdown fills in once the fetch
  // resolves, no jarring layout shift since the row was already there.
  const versionsQuery = useMcVersions();
  const versionOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [
      { value: 'LATEST', label: 'LATEST (auto-update)' },
    ];
    const data = versionsQuery.data;
    if (data) {
      opts.push({ value: 'SNAPSHOT', label: 'SNAPSHOT (latest snapshot)' });
      // Releases first (sorted by recency from Mojang), then snapshots,
      // then anything else. Filter out duplicates of LATEST/SNAPSHOT ids.
      const releases = data.versions.filter((v) => v.type === 'release');
      const snapshots = data.versions.filter((v) => v.type === 'snapshot');
      const other = data.versions.filter((v) => v.type !== 'release' && v.type !== 'snapshot');
      for (const v of releases) opts.push({ value: v.id, label: v.id });
      for (const v of snapshots) opts.push({ value: v.id, label: `${v.id} (snapshot)` });
      for (const v of other) opts.push({ value: v.id, label: `${v.id} (${v.type})` });
    }
    return opts;
  }, [versionsQuery.data]);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      version: host.default_version,
      mc_type: host.default_type,
      seed: '',
      motd: '',
      gamemode: 'survival',
      difficulty: 'normal',
    },
  });

  const [advanced, setAdvanced] = useState(false);
  // Admin range bounds the slider. Default to the upper bound (most-generous
  // setting). Re-seed if the user opens the form before /admin/config resolves.
  const [memoryGb, setMemoryGb] = useState<number | null>(null);
  const effectiveMemory = memoryGb ?? adminCfg?.world_memory_max_gb ?? 4;

  const onSubmit = (v: FormValues) =>
    create.mutate({
      name: v.name,
      version: v.version,
      seed: v.seed,
      mc_type: v.mc_type,
      memory_gb: effectiveMemory,
      properties: { motd: v.motd, gamemode: v.gamemode, difficulty: v.difficulty },
    });

  return (
    <aside className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">New world</h2>
        <span className="font-mono text-[11px] text-sub">{effectiveMemory} GB · auto-port</span>
      </div>

      <form className="grid gap-3.5" onSubmit={handleSubmit(onSubmit)}>
        <FieldShell label="name" error={errors.name?.message}>
          <TextField mono placeholder="my-world" autoComplete="off" {...register('name')} />
        </FieldShell>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell label="version">
            <SelectField options={versionOptions} {...register('version')} />
          </FieldShell>
          <FieldShell label="server type">
            <SelectField
              options={[
                { value: 'VANILLA', label: 'Vanilla' },
                { value: 'PAPER', label: 'Paper' },
                { value: 'FABRIC', label: 'Fabric' },
                { value: 'FORGE', label: 'Forge' },
              ]}
              {...register('mc_type')}
            />
          </FieldShell>
        </div>

        <FieldShell label="seed">
          <TextField mono placeholder="random" {...register('seed')} />
        </FieldShell>

        {adminCfg && adminCfg.world_memory_min_gb < adminCfg.world_memory_max_gb && (
          <FieldShell label="memory">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[11px] text-dim">
                  {adminCfg.world_memory_min_gb} GB
                </span>
                <span className="font-mono text-[14px] font-semibold text-text">
                  {effectiveMemory} GB
                </span>
                <span className="font-mono text-[11px] text-dim">
                  {adminCfg.world_memory_max_gb} GB
                </span>
              </div>
              <input
                type="range"
                min={adminCfg.world_memory_min_gb}
                max={adminCfg.world_memory_max_gb}
                step={1}
                value={effectiveMemory}
                onChange={(e) => setMemoryGb(parseInt(e.target.value, 10))}
                className="w-full accent-accent"
              />
            </div>
          </FieldShell>
        )}

        <Eyebrow className="mt-2">GAMEPLAY</Eyebrow>

        <FieldShell label="motd">
          <TextField placeholder="A Minecraft Server" {...register('motd')} />
        </FieldShell>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell label="gamemode">
            <SelectField
              options={['survival', 'creative', 'adventure', 'spectator'].map((v) => ({ value: v, label: v }))}
              {...register('gamemode')}
            />
          </FieldShell>
          <FieldShell label="difficulty">
            <SelectField
              options={['peaceful', 'easy', 'normal', 'hard'].map((v) => ({ value: v, label: v }))}
              {...register('difficulty')}
            />
          </FieldShell>
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-left text-[12px] text-dim hover:text-text"
        >
          {advanced ? '▾' : '▸'} Advanced settings
        </button>

        {advanced && (
          <div className="rounded-md border border-line bg-panel-2 p-3 text-[12px] text-dim">
            View distance, max players, hardcore, pvp — edit on the world page after creation.
          </div>
        )}

        {create.isError && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {create.error instanceof ApiError ? create.error.message : 'Could not create world'}
          </div>
        )}

        <PrimaryBtn type="submit" disabled={create.isPending} className="mt-2 w-full">
          {create.isPending ? 'CREATING…' : '+ CREATE WORLD'}
        </PrimaryBtn>
      </form>

      <div className="mt-6 border-t border-line pt-5">
        <SectionTitle>IMPORT EXISTING WORLD</SectionTitle>
        <UploadDrop onPick={(file) => setImporting({ file, source: null })} />
        {imports.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] text-dim">or pick from imports/ on the host:</div>
            <div className="flex flex-wrap gap-1.5">
              {imports.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setImporting({ file: null, source: src })}
                  className="rounded-md border border-line bg-panel-2 px-2.5 py-1 font-mono text-[11px] text-text hover:border-accent"
                >
                  {src}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 font-mono text-[11px] text-sub">
        Port range: {host.port_range[0]}–{host.port_range[1]} (auto-allocated)
      </div>

      {importing && (
        <ImportDialog
          file={importing.file}
          source={importing.source}
          onClose={() => setImporting(null)}
        />
      )}
    </aside>
  );
}

function UploadDrop({ onPick }: { onPick: (file: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files[0];
        if (file) onPick(file);
      }}
      className={`rounded-md border border-dashed p-4 text-center text-[12px] ${
        drag ? 'border-accent text-text' : 'border-line text-dim'
      }`}
    >
      <div>drop a .zip here</div>
      <label className="mt-1 inline-block cursor-pointer text-accent">
        or browse
        <input
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.currentTarget.value = '';
          }}
        />
      </label>
    </div>
  );
}
