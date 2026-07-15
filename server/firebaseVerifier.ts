import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { TokenVerifier } from './auth.js';

/**
 * Builds the production TokenVerifier on top of firebase-admin.
 *
 * Verifying ID tokens only needs the project id (the SDK fetches Google's
 * public signing certificates itself) — no service-account JSON is required
 * for this self-hosted setup, and none should be added unless a feature
 * later needs privileged Admin API calls (user management, custom claims).
 */
export function createFirebaseVerifier(projectId: string): TokenVerifier {
  const app = getApps()[0] ?? initializeApp({ projectId });
  const auth = getAuth(app);

  return async (token) => {
    const decoded = await auth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
    };
  };
}
