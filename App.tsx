import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { queryClient } from './lib/queryClient';
import { router } from './router';
import { LandingView } from './views/LandingView';
import { LoginView } from './views/LoginView';

/** Full-screen splash shown only until Firebase reports the initial auth state. */
function AuthLoadingSplash() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-vinyl-950">
      <span className="relative w-10 h-10 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 animate-spin-slow">
        <span className="absolute inset-[13px] rounded-full bg-vinyl-950"></span>
      </span>
    </div>
  );
}

function Gate() {
  const { user, loading } = useAuth();

  // Logged-out flow: the landing page is the front door; the auth forms are
  // reached from it. Reset on any auth change so a sign-out always lands
  // back on the landing page, not a stale login form.
  const [entry, setEntry] = useState<'landing' | 'sign-in' | 'sign-up'>('landing');

  // Server data is per-user; cached queries must never survive an account
  // switch (or linger after sign-out) on a shared device.
  const previousUid = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.uid ?? null;
    if (previousUid.current !== null && previousUid.current !== uid) {
      queryClient.clear();
      setEntry('landing');
    }
    previousUid.current = uid;
  }, [user?.uid]);

  if (loading) return <AuthLoadingSplash />;
  if (!user) {
    if (entry === 'landing') {
      return (
        <LandingView onSignIn={() => setEntry('sign-in')} onSignUp={() => setEntry('sign-up')} />
      );
    }
    return <LoginView initialMode={entry} onBack={() => setEntry('landing')} />;
  }
  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Gate />
      </QueryClientProvider>
    </AuthProvider>
  );
}
