import type { AuthenticatedUser } from './auth.js';

/**
 * One-time adoption of pre-auth data: rows created before user accounts
 * existed have a NULL user_id and are invisible to everyone. When the user
 * configured via LEGACY_CLAIM_EMAIL signs in with that email verified, they
 * adopt every unowned row.
 */
export function claimLegacyRows(_user: AuthenticatedUser): void {
  // Stub — implemented after the red tests are committed.
}
