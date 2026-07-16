import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

/**
 * Catch-all for any URL that doesn't match a route in the currently-mounted
 * router. This mainly covers the auth-transition edge case: the app and
 * public route trees are separate (see App.tsx's Gate), so a URL owned by
 * one tree (e.g. /login) briefly doesn't exist in the other right after
 * sign-in/sign-out, before the browser URL catches up. Bounces to `/`
 * instead of showing a dead page.
 */
export function NotFoundRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: '/', replace: true });
  }, [navigate]);

  return null;
}
