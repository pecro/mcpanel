// Thin fetch wrapper. Same-origin so Authelia's session cookie rides along.
// Throws ApiError on non-2xx with the server's "detail" message when present.

import type { Job } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) return body.detail;
    } catch {
      /* fall through */
    }
  }
  return res.statusText || `HTTP ${res.status}`;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) =>
    fetch(path, { credentials: 'include' }).then(handle<T>),

  post: <T>(path: string, body?: unknown) =>
    fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(handle<T>),

  patch: <T>(path: string, body: unknown) =>
    fetch(path, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle<T>),

  del: <T>(path: string, body?: unknown) =>
    fetch(path, {
      method: 'DELETE',
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(handle<T>),

  upload: <T>(path: string, file: File, fieldName = 'world_zip') => {
    const fd = new FormData();
    fd.append(fieldName, file);
    return fetch(path, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    }).then(handle<T>);
  },
};

/** Upload a single file with progress + cancellation. fetch() can't
 * expose upload.onprogress without ReadableStream-body hackery, and its
 * abort path is awkward — XHR does both natively, so use that here. */
export interface UploadHandle<T> {
  promise: Promise<T>;
  cancel: () => void;
}

export function uploadWithProgress<T>(
  path: string,
  file: File,
  opts: {
    fieldName?: string;
    onProgress?: (loaded: number, total: number) => void;
    /** Fires once the last byte has been sent. After this, the server is
     * still running (saving the temp file, extracting the zip, parsing
     * level.dat) before it returns the response — for a multi-GB world
     * that gap can be 30+ seconds, so the UI should show a different
     * phase ("analyzing") here instead of leaving the upload bar at
     * 100%. */
    onUploadComplete?: () => void;
  } = {},
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', path);
    xhr.responseType = 'json';
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) opts.onProgress(e.loaded, e.total);
    };
    xhr.upload.onload = () => {
      opts.onUploadComplete?.();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as T);
      } else {
        const body = xhr.response as { detail?: string } | string | null;
        const detail =
          typeof body === 'object' && body && 'detail' in body && body.detail
            ? body.detail
            : xhr.statusText || `HTTP ${xhr.status}`;
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network error'));
    xhr.onabort = () => reject(new ApiError(0, 'upload cancelled'));
    const fd = new FormData();
    fd.append(opts.fieldName ?? 'world_zip', file);
    xhr.send(fd);
  });
  return { promise, cancel: () => xhr.abort() };
}

/** POST a mutation that returns 202 { job_id }, then poll the job until
 * it terminates. Resolves with the job's `result` on success; throws an
 * ApiError on failure (so TanStack Query's `isPending` covers the entire
 * lifecycle and `error` carries the server's message). */
export async function runJob<T = unknown>(
  path: string,
  body?: unknown,
  pollMs = 1000,
): Promise<T> {
  const start = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!start.ok) throw new ApiError(start.status, await parseError(start));
  const { job_id } = (await start.json()) as { job_id: string };
  // Poll. The backend caps job execution time implicitly via docker
  // operations; on the client we just keep polling — the user can
  // navigate away to abort the wait without affecting the work itself.
  while (true) {
    await new Promise((r) => setTimeout(r, pollMs));
    const job = await api.get<Job>(`/api/v1/jobs/${job_id}`);
    if (job.status === 'success') return (job.result ?? {}) as T;
    if (job.status === 'failed') throw new ApiError(500, job.error ?? 'job failed');
  }
}
