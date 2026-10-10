import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { login, useAuth } from '../lib/auth';
import { Banner, Button, Field, TextInput } from '../components/ui';
import { LoginArt } from '../components/LoginArt';

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const next = await login(email, password);
      setUser(next);
      navigate(next.mustChangePassword ? '/change-password' : '/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-2">
      <section className="hidden bg-nav px-12 py-14 text-[#e5f5f3] lg:flex lg:flex-col lg:justify-between">
        <div>
          <strong className="text-lg">Aquageno Exim</strong>
          <p className="mt-8 max-w-md text-4xl leading-tight font-semibold tracking-tight">
            Purchases, production, and stock in one plant ledger.
          </p>
        </div>
        <div className="my-10 flex justify-center" aria-hidden="true">
          <LoginArt />
        </div>
        <p className="max-w-sm text-sm text-[#9bc0be]">Kochi, Veraval, and Mumbai warehouses share the same ledger.</p>
      </section>
      <section className="grid place-items-center px-5 py-12">
        <form className="w-full max-w-sm" onSubmit={onSubmit}>
          <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
          <p className="mb-6 text-sm text-muted">Use the account issued by your administrator. Seeded accounts are listed in the README.</p>
          {error ? <Banner>{error}</Banner> : null}
          <div className="grid gap-4">
            <Field label="Email">
              <TextInput type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </Field>
            <Field label="Password">
              <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? 'Signing in...' : 'Sign in'}
            </Button>
          </div>
          <Link className="mt-4 inline-block text-sm font-semibold text-sea-ink" to="/forgot-password">
            Forgot password
          </Link>
        </form>
      </section>
    </div>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const { api } = await import('../lib/api');
      const result = await api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email }, skipRefresh: true });
      setMessage(result.data.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset link.');
    }
  }

  return (
    <div className="grid min-h-[100dvh] place-items-center px-5">
      <form className="w-full max-w-sm" onSubmit={onSubmit}>
        <h1 className="mb-2 text-2xl font-semibold">Reset password</h1>
        <p className="mb-5 text-sm text-muted">If the email is on file, the stub mailer records a reset link. Check the API log in this build.</p>
        {message ? <div className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{message}</div> : null}
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <div className="mt-4">
          <Button type="submit">Send reset link</Button>
        </div>
        <Link className="mt-4 inline-block text-sm font-semibold text-sea-ink" to="/login">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}

export function ResetPage() {
  const params = new URLSearchParams(window.location.search);
  const [token] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const { api } = await import('../lib/api');
      const result = await api<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
        skipRefresh: true,
      });
      setMessage(result.data.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.');
    }
  }

  return (
    <div className="grid min-h-[100dvh] place-items-center px-5">
      <form className="w-full max-w-sm" onSubmit={onSubmit}>
        <h1 className="mb-5 text-2xl font-semibold">Choose a new password</h1>
        {message ? <div className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{message}</div> : null}
        {error ? <Banner>{error}</Banner> : null}
        <Field label="New password">
          <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <p className="mt-2 text-xs text-muted">At least 10 characters, with upper case, lower case, and a digit.</p>
        <div className="mt-4">
          <Button type="submit">Update password</Button>
        </div>
        <Link className="mt-4 inline-block text-sm font-semibold text-sea-ink" to="/login">
          Sign in
        </Link>
      </form>
    </div>
  );
}

export function ChangePasswordPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const { api, setAccessToken } = await import('../lib/api');
      const result = await api<{ accessToken: string; user: NonNullable<typeof user> }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setAccessToken(result.data.accessToken);
      setUser(result.data.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    }
  }

  return (
    <div className="grid min-h-[100dvh] place-items-center px-5">
      <form className="w-full max-w-sm" onSubmit={onSubmit}>
        <h1 className="mb-2 text-2xl font-semibold">Set a new password</h1>
        <p className="mb-5 text-sm text-muted">
          {user?.name}, this account must set a new password before it can open the plant records.
        </p>
        {error ? <Banner>{error}</Banner> : null}
        <div className="grid gap-4">
          <Field label="Current password">
            <TextInput type="password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} required />
          </Field>
          <Field label="New password">
            <TextInput type="password" value={newPassword} onChange={(event) => setNext(event.target.value)} required />
          </Field>
          <Button type="submit">Save password</Button>
        </div>
      </form>
    </div>
  );
}
