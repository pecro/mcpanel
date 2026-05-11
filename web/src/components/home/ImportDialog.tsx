import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ApiError,
  uploadWithProgress,
  type UploadHandle,
} from '../../api/client';
import {
  useImportCancel,
  useImportCommit,
  useImportFrom,
} from '../../api/queries';
import type { StagingResponse } from '../../api/types';
import { GhostBtn, PrimaryBtn } from '../ui/Button';
import { FieldShell, SelectField, TextField } from '../ui/Field';
import { KeyValue } from '../ui/atoms';

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

const schema = z.object({
  name: z.string().regex(NAME_RE, 'lowercase letters, digits, dashes; must start with a letter'),
  mc_type: z.string(),
  version: z.string(),
});
type FormValues = z.infer<typeof schema>;

type Phase =
  | { kind: 'uploading'; loaded: number; total: number; cancel: () => void }
  | { kind: 'analyzing'; cancel: () => void }
  | { kind: 'staging' }
  | { kind: 'confirming'; staging: StagingResponse }
  | { kind: 'committing' }
  | { kind: 'error'; message: string };

export function ImportDialog({
  file,
  source,
  onClose,
}: {
  file: File | null;
  source: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const fromHost = useImportFrom();
  const cancel = useImportCancel();
  const commit = useImportCommit();

  const [phase, setPhase] = useState<Phase>(() => {
    if (file) {
      return { kind: 'uploading', loaded: 0, total: file.size, cancel: () => {} };
    }
    return { kind: 'staging' };
  });

  // Track the staging id even after we transition to the next phase, so
  // that backing out via Cancel can DELETE it server-side.
  const stagingIdRef = useRef<string | null>(null);

  // Fire the upload (file path) or the from-imports staging (source path)
  // exactly once on mount. The dependency list deliberately omits the
  // mutations to avoid restarts; we capture them via closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    let handle: UploadHandle<StagingResponse> | null = null;

    if (file) {
      handle = uploadWithProgress<StagingResponse>('/api/v1/imports/upload', file, {
        onProgress: (loaded, total) => {
          if (cancelled) return;
          setPhase((p) =>
            p.kind === 'uploading' ? { ...p, loaded, total } : p,
          );
        },
        onUploadComplete: () => {
          if (cancelled) return;
          // Last byte sent. The server still has work to do (extract the
          // zip, parse level.dat) — switch to an indeterminate "analyzing"
          // phase until the response arrives.
          setPhase({ kind: 'analyzing', cancel: handle!.cancel });
        },
      });
      // Patch in the cancel function now that we have the handle.
      setPhase((p) =>
        p.kind === 'uploading' ? { ...p, cancel: handle!.cancel } : p,
      );
      handle.promise
        .then((res) => {
          if (cancelled) return;
          stagingIdRef.current = res.staging_id;
          setPhase({ kind: 'confirming', staging: res });
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError && err.message === 'upload cancelled') {
            // User-initiated. The dialog already called onClose; nothing
            // else to do.
            return;
          }
          setPhase({
            kind: 'error',
            message: err instanceof ApiError ? err.message : String(err),
          });
        });
    } else if (source) {
      fromHost.mutate(source, {
        onSuccess: (res) => {
          if (cancelled) return;
          stagingIdRef.current = res.staging_id;
          setPhase({ kind: 'confirming', staging: res });
        },
        onError: (err) => {
          if (cancelled) return;
          setPhase({
            kind: 'error',
            message: err instanceof ApiError ? err.message : String(err),
          });
        },
      });
    }

    return () => {
      cancelled = true;
      if (handle) handle.cancel();
    };
  }, []);

  const onCancelUpload = () => {
    if (phase.kind === 'uploading' || phase.kind === 'analyzing') {
      phase.cancel();
    }
    onClose();
  };

  const onCancelConfirm = () => {
    if (stagingIdRef.current) {
      cancel.mutate(stagingIdRef.current);
    }
    onClose();
  };

  const onCommit = (v: FormValues) => {
    if (phase.kind !== 'confirming') return;
    setPhase({ kind: 'committing' });
    commit.mutate(
      {
        staging_id: phase.staging.staging_id,
        name: v.name,
        mc_type: v.mc_type,
        version: v.version,
      },
      {
        onSuccess: (w) => {
          onClose();
          navigate(`/worlds/${w.name}`);
        },
        onError: (err) => {
          setPhase({
            kind: 'error',
            message: err instanceof ApiError ? err.message : String(err),
          });
        },
      },
    );
  };

  return (
    <Backdrop>
      <DialogShell>
        {phase.kind === 'uploading' && (
          <UploadingView
            filename={file?.name ?? '—'}
            loaded={phase.loaded}
            total={phase.total}
            onCancel={onCancelUpload}
          />
        )}
        {phase.kind === 'analyzing' && (
          <AnalyzingView filename={file?.name ?? '—'} onCancel={onCancelUpload} />
        )}
        {phase.kind === 'staging' && (
          <StagingView source={source ?? '—'} onCancel={onCancelUpload} />
        )}
        {phase.kind === 'confirming' && (
          <ConfirmingView
            staging={phase.staging}
            onCancel={onCancelConfirm}
            onCommit={onCommit}
          />
        )}
        {phase.kind === 'committing' && (
          <div className="p-6 text-center text-[13px] text-dim">Creating world…</div>
        )}
        {phase.kind === 'error' && (
          <ErrorView message={phase.message} onClose={onCancelConfirm} />
        )}
      </DialogShell>
    </Backdrop>
  );
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      {children}
    </div>
  );
}

function DialogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[95vh] w-full max-w-[560px] overflow-y-auto rounded-t-xl border border-line bg-panel sm:rounded-xl nice-scroll">
      {children}
    </div>
  );
}

function UploadingView({
  filename,
  loaded,
  total,
  onCancel,
}: {
  filename: string;
  loaded: number;
  total: number;
  onCancel: () => void;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div className="p-5 sm:p-6">
      <h2 className="mb-1 text-[15px] font-semibold">Importing world</h2>
      <p className="mb-4 truncate font-mono text-[12px] text-dim">{filename}</p>
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mb-5 flex items-center justify-between font-mono text-[11px] text-dim">
        <span>
          {humanBytes(loaded)} / {humanBytes(total)}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="flex justify-end">
        <GhostBtn onClick={onCancel}>Cancel upload</GhostBtn>
      </div>
    </div>
  );
}

function AnalyzingView({ filename, onCancel }: { filename: string; onCancel: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <h2 className="mb-1 text-[15px] font-semibold">Analyzing world</h2>
      <p className="mb-4 truncate font-mono text-[12px] text-dim">{filename}</p>
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-panel-2">
        <div className="indeterminate-bar h-full rounded-full bg-accent" />
      </div>
      <p className="mb-5 text-[11px] text-dim">
        Server is extracting the archive and reading <code className="font-mono text-text">level.dat</code>.
        For a multi-gigabyte world this can take a minute.
      </p>
      <div className="flex justify-end">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
      </div>
    </div>
  );
}

function StagingView({ source, onCancel }: { source: string; onCancel: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <h2 className="mb-1 text-[15px] font-semibold">Staging from imports/</h2>
      <p className="mb-4 truncate font-mono text-[12px] text-dim">{source}</p>
      <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-panel-2">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      </div>
      <div className="flex justify-end">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
      </div>
    </div>
  );
}

function ConfirmingView({
  staging,
  onCancel,
  onCommit,
}: {
  staging: StagingResponse;
  onCancel: () => void;
  onCommit: (v: FormValues) => void;
}) {
  const defaults = useMemo(
    () => ({
      name: staging.metadata.name_suggestion ?? '',
      mc_type: staging.default_type ?? 'VANILLA',
      version: staging.default_version ?? 'LATEST',
    }),
    [staging],
  );
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  return (
    <form className="p-5 sm:p-6" onSubmit={handleSubmit(onCommit)}>
      <h2 className="mb-3 text-[15px] font-semibold">Confirm import</h2>

      <div className="mb-4 rounded-md border border-line bg-panel-2 p-3 sm:p-4">
        <div className="eyebrow mb-2 text-[8px]">DETECTED METADATA</div>
        <KeyValue
          rows={[
            ['level name', staging.metadata.level_name ?? '—'],
            ['version', staging.metadata.mc_version ?? '—'],
            ['data version',
              staging.metadata.dataversion != null
                ? String(staging.metadata.dataversion)
                : '—',
            ],
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

      <div className="grid gap-3">
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
      </div>

      <p className="mt-3 text-[11px] italic leading-relaxed text-dim">
        We'll preserve the imported <code className="font-mono text-text">server.properties</code>
        {' '}and only overlay our policy keys (whitelist, rcon, pause-when-empty).
      </p>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <GhostBtn type="button" onClick={onCancel}>Cancel &amp; discard</GhostBtn>
        <PrimaryBtn type="submit">Import world</PrimaryBtn>
      </div>
    </form>
  );
}

function ErrorView({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="p-5 sm:p-6">
      <h2 className="mb-2 text-[15px] font-semibold text-danger">Import failed</h2>
      <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
        {message}
      </div>
      <div className="flex justify-end">
        <GhostBtn onClick={onClose}>Close</GhostBtn>
      </div>
    </div>
  );
}

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

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  for (const unit of ['KB', 'MB', 'GB']) {
    n /= 1024;
    if (n < 1024) return `${n.toFixed(1)} ${unit}`;
  }
  return `${(n / 1024).toFixed(1)} TB`;
}
