import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuthStatus, useLogin } from '../api/queries';
import { Card } from '../components/ui/atoms';
import { PrimaryBtn } from '../components/ui/Button';

/** Login screen — built-in mode only. In forward-headers mode the panel
 *  never sees an unauthenticated request, so this route just bounces home. */
export function Login() {
  const status = useAuthStatus();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');

  if (status.data?.mode === 'forward-headers') {
    return <Navigate to="/" replace />;
  }
  if (status.data?.authenticated) {
    const next = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={next} replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(password, {
      onSuccess: () => {
        const next = (location.state as { from?: string } | null)?.from ?? '/';
        navigate(next, { replace: true });
      },
    });
  };

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="font-headline text-[26px] tracking-[0.1em]">MCPANEL</h1>
          <p className="mt-1 text-[12px] text-dim">Sign in to continue.</p>
        </div>
        <Card>
          <form onSubmit={onSubmit} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="font-mono text-[11px] text-dim">PASSWORD</span>
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-md border border-line bg-panel-2 px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
            </label>
            {login.isError && (
              <div className="text-[12px] text-danger">
                {login.error instanceof ApiError ? login.error.message : 'Sign-in failed'}
              </div>
            )}
            <PrimaryBtn type="submit" disabled={!password || login.isPending || !status.data}>
              {login.isPending ? 'SIGNING IN…' : 'SIGN IN'}
            </PrimaryBtn>
          </form>
        </Card>
      </div>
    </div>
  );
}
