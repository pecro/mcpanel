import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useImportCancel,
  useImportCommit,
  useImportFrom,
  useStaging,
} from '../api/queries';
import { ApiError } from '../api/client';
import type { StagingResponse } from '../api/types';
import { HeroBand } from '../components/art/HeroBand';
import { Card, KeyValue } from '../components/ui/atoms';
import { GhostBtn, PrimaryBtn } from '../components/ui/Button';
import { FieldShell, SelectField, TextField } from '../components/ui/Field';

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

const schema = z.object({
  name: z.string().regex(NAME_RE, 'lowercase letters, digits, dashes; must start with a letter'),
  mc_type: z.string(),
  version: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function Import() {
  const [params] = useSearchParams();
  const stagingFromQuery = params.get('staging') ?? '';
  const sourceFromQuery = params.get('source') ?? '';
  const navigate = useNavigate();

  const [staging, setStaging] = useState<StagingResponse | null>(null);
  const fromHost = useImportFrom();
  const cancel = useImportCancel();
  const commit = useImportCommit();
  // Re-fetch the staging metadata when the user lands on this page with
  // only ?staging=<id> in the URL — the upload mutation that produced the
  // metadata fired on Home and its result doesn't survive the navigation.
  const recovered = useStaging(staging || sourceFromQuery ? null : stagingFromQuery || null);

  // Hydrate staging payload: either Home navigated us with ?staging=<id>
  // (recover via GET /imports/:id), ?source=<dir> (stage from imports/),
  // or — common case in this same render — the recovered query just
  // resolved.
  useEffect(() => {
    if (staging) return;
    if (sourceFromQuery) {
      fromHost.mutate(sourceFromQuery, {
        onSuccess: (res) => setStaging(res),
      });
    } else if (recovered.data) {
      setStaging(recovered.data);
    }
  }, [stagingFromQuery, sourceFromQuery, fromHost, staging, recovered.data]);

  const defaults = useMemo(
    () => ({
      name: staging?.metadata.name_suggestion ?? '',
      mc_type: staging?.default_type ?? 'VANILLA',
      version: staging?.default_version ?? 'LATEST',
    }),
    [staging],
  );

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  const cancelFlow = () => {
    if (staging) cancel.mutate(staging.staging_id);
    navigate('/');
  };

  const onSubmit = (v: FormValues) => {
    if (!staging) return;
    commit.mutate(
      { staging_id: staging.staging_id, name: v.name, mc_type: v.mc_type, version: v.version },
      { onSuccess: (w) => navigate(`/worlds/${w.name}`) },
    );
  };

  const error = commit.error instanceof ApiError ? commit.error.message : null;

  return (
    <div className="mx-auto max-w-[880px] p-4 sm:p-6">
      <div className="mb-4 text-[12px] text-dim">
        <Link to="/" className="hover:text-text">worlds</Link> / new world / <span className="text-text">import</span>
      </div>
      <Card className="overflow-hidden p-0">
        <HeroBand height={180}>
          <div className="absolute left-7 top-7 text-white" style={{ textShadow: '2px 2px 0 rgba(0,0,0,.45)' }}>
            <div className="font-headline text-[11px] tracking-[0.15em] mb-3">IMPORT WORLD</div>
            <div className="font-headline text-[28px] leading-tight">Confirm details</div>
          </div>
        </HeroBand>

        {fromHost.isPending || recovered.isLoading ? (
          <div className="p-6 text-dim">Inspecting upload…</div>
        ) : recovered.isError ? (
          <div className="p-6 text-[13px] text-danger">
            Could not load this upload — it may have been canceled or expired.
            Go back to <Link to="/" className="underline">Home</Link> and re-upload.
          </div>
        ) : !staging ? (
          <div className="p-6 text-[13px] text-dim">
            Nothing to import. Drop a <code className="font-mono text-text">.zip</code> on the
            create form on the <Link to="/" className="text-accent hover:underline">home page</Link>
            , or pick a directory from <code className="font-mono text-text">imports/</code> there.
          </div>
        ) : (
          <form className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <div className="eyebrow text-[9px] mb-2">DETECTED METADATA</div>
              <div className="rounded-md border border-line bg-panel-2 p-4">
                <KeyValue
                  rows={[
                    ['level name', staging.metadata.level_name ?? '—'],
                    ['version', staging.metadata.mc_version ?? '—'],
                    ['data version', staging.metadata.dataversion != null ? String(staging.metadata.dataversion) : '—'],
                    ['motd', staging.metadata.motd ?? '—'],
                    ['difficulty', difficultyLabel(staging.metadata.difficulty)],
                    ['gamemode', gamemodeLabel(staging.metadata.gametype)],
                    ['hardcore', staging.metadata.hardcore ? 'yes' : 'no'],
                    ['whitelist entries', String(staging.metadata.whitelist_count)],
                    ['ops entries', String(staging.metadata.ops_count)],
                    ['server type', `${staging.metadata.server_type_guess} (guess)`],
                    ['level.dat', staging.metadata.has_level_dat ? '✓ found' : '✗ missing'],
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <FieldShell label="name on this server" error={errors.name?.message}>
                <TextField mono placeholder="my-world" autoComplete="off" {...register('name')} />
              </FieldShell>
              <div className="grid gap-3 sm:grid-cols-2">
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
                <FieldShell
                  label="version"
                  hint={staging.metadata.mc_version ? `detected: ${staging.metadata.mc_version}` : undefined}
                >
                  <TextField mono {...register('version')} />
                </FieldShell>
              </div>
              <p className="text-[11px] italic leading-relaxed text-dim">
                We'll preserve the imported <code className="font-mono text-text">server.properties</code>
                {' '}(motd, gamemode, etc.) and only overlay our policy keys (whitelist, pause-when-empty).
              </p>
              {error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                  {error}
                </div>
              )}
              <div className="mt-auto flex justify-end gap-2">
                <GhostBtn type="button" onClick={cancelFlow}>Cancel</GhostBtn>
                <PrimaryBtn type="submit" disabled={commit.isPending}>
                  {commit.isPending ? 'IMPORTING…' : 'IMPORT WORLD'}
                </PrimaryBtn>
              </div>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

// level.dat encodes Difficulty and GameType as ints (0-3). Mirror the
// mapping in app/world.py so the confirm page surfaces the same values
// we'll write into the imported world's server.properties.

const DIFFICULTY: Record<number, string> = {
  0: 'peaceful',
  1: 'easy',
  2: 'normal',
  3: 'hard',
};
const GAMEMODE: Record<number, string> = {
  0: 'survival',
  1: 'creative',
  2: 'adventure',
  3: 'spectator',
};

function difficultyLabel(d: number | undefined): string {
  if (d == null) return '—';
  return DIFFICULTY[d] ?? `int ${d}`;
}
function gamemodeLabel(g: number | undefined): string {
  if (g == null) return '—';
  return GAMEMODE[g] ?? `int ${g}`;
}
