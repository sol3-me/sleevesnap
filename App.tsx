import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { queryClient } from './lib/queryClient';
import { router } from './router';
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

  // Server data is per-user; cached queries must never survive an account
  // switch (or linger after sign-out) on a shared device.
  const previousUid = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.uid ?? null;
    if (previousUid.current !== null && previousUid.current !== uid) {
      queryClient.clear();
    }
    previousUid.current = uid;
  }, [user?.uid]);

  if (loading) return <AuthLoadingSplash />;
  if (!user) return <LoginView />;
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
