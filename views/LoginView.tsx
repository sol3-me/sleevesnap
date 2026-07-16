import React, { useState } from 'react';
import { Toaster, toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { describeAuthFieldError } from '../lib/authErrors';
import { validateAuthFields, type AuthFieldErrors } from '../lib/signupValidation';

type EmailMode = 'sign-in' | 'sign-up';

function ProviderIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// Simple-Icons paths (CC0).
const GOOGLE_ICON =
  'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z';
const GITHUB_ICON =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

type LoginViewProps = {
  /** Which email form to open on; the user can still switch. */
  initialMode?: EmailMode;
  /** When set, shows a back link returning to the landing page. */
  onBack?: () => void;
};

export function LoginView({ initialMode = 'sign-in', onBack }: LoginViewProps = {}) {
  const { signInWithGoogle, signInWithGitHub, signInWithEmail, signUpWithEmail, resetPassword } =
    useAuth();
  const [mode, setMode] = useState<EmailMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});

  const switchMode = (next: EmailMode) => {
    setMode(next);
    setFieldErrors({});
  };

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await action();
    } catch (err) {
      const result = describeAuthFieldError(err);
      if (!result) return;
      if (result.field) {
        setFieldErrors((prev) => ({ ...prev, [result.field as 'email' | 'password']: result.message }));
      } else {
        toast.error(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const submitEmailForm = (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateAuthFields(email, password, mode);
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    if (mode === 'sign-in') {
      void run('email', () => signInWithEmail(email, password));
    } else {
      void run('email', async () => {
        await signUpWithEmail(email, password);
        toast.success('Account created — check your inbox to verify your email.');
      });
    }
  };

  const forgotPassword = () => {
    if (!email) {
      toast('Enter your email above first, then tap "Forgot password?" again.');
      return;
    }
    void run('reset', async () => {
      await resetPassword(email);
      toast.success(`Password reset email sent to ${email}.`);
    });
  };

  const providerButtonClassName =
    'flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white hover:bg-white/10 active:scale-[0.99] transition disabled:opacity-50 disabled:pointer-events-none';
  const inputClassName = (hasError: boolean) =>
    `w-full px-4 py-3 rounded-xl bg-white/5 border text-sm text-white placeholder-gray-500 focus:outline-none focus-visible:ring-2 ${
      hasError
        ? 'border-red-500/60 focus-visible:ring-red-500'
        : 'border-white/10 focus-visible:ring-vinyl-accent'
    }`;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-vinyl-950 text-white px-4">
      <div className="w-full max-w-sm">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-4 text-xs text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
        )}
        {/* Brand mark, mirroring the in-app logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <span className="relative w-8 h-8 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 shadow-[0_0_18px_rgba(255,107,107,0.35)]">
            <span className="absolute inset-[10px] rounded-full bg-vinyl-950"></span>
          </span>
          <span className="text-2xl font-bold tracking-tight">
            sleeve<span className="text-vinyl-accent">snap</span>
          </span>
        </div>

        <div
          className={`rounded-2xl bg-white/[0.03] border p-6 space-y-4 transition-colors ${
            mode === 'sign-up' ? 'border-vinyl-accent/30' : 'border-white/10'
          }`}
        >
          <div className="text-center space-y-1">
            <h1 className="text-lg font-semibold">
              {mode === 'sign-in' ? 'Welcome back' : 'Start your collection'}
            </h1>
            <p className="text-xs text-gray-400">
              {mode === 'sign-in'
                ? 'Sign in to pick up where you left off.'
                : 'Save your scans and grow your collection from anywhere.'}
            </p>
          </div>

          <button
            type="button"
            className={providerButtonClassName}
            disabled={busy !== null}
            onClick={() => void run('google', signInWithGoogle)}
          >
            <ProviderIcon path={GOOGLE_ICON} /> Continue with Google
          </button>
          <button
            type="button"
            className={providerButtonClassName}
            disabled={busy !== null}
            onClick={() => void run('github', signInWithGitHub)}
          >
            <ProviderIcon path={GITHUB_ICON} /> Continue with GitHub
          </button>

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-gray-500">
            <span className="h-px flex-1 bg-white/10" /> or email
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={submitEmailForm} className="space-y-3" noValidate>
            <div>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className={inputClassName(Boolean(fieldErrors.email))}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              />
              {fieldErrors.email && (
                <p id="email-error" role="alert" className="mt-1.5 text-xs text-red-400">
                  {fieldErrors.email}
                </p>
              )}
            </div>
            <div>
              <input
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                placeholder="Password"
                className={inputClassName(Boolean(fieldErrors.password))}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              />
              {fieldErrors.password && (
                <p id="password-error" role="alert" className="mt-1.5 text-xs text-red-400">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={busy !== null}
              className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-vinyl-accent text-vinyl-950 hover:brightness-110 active:scale-[0.99] transition disabled:opacity-50"
            >
              {busy === 'email'
                ? 'One moment…'
                : mode === 'sign-in'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>

          <div className="flex items-center justify-between text-xs text-gray-400">
            <button
              type="button"
              className="hover:text-white transition-colors"
              onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            >
              {mode === 'sign-in' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </button>
            {mode === 'sign-in' && (
              <button
                type="button"
                className="hover:text-white transition-colors"
                onClick={forgotPassword}
              >
                Forgot password?
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-500 mt-6">
          Your collection is private to your account.
        </p>
      </div>
      <Toaster theme="dark" position="top-center" richColors />
    </div>
  );
}
