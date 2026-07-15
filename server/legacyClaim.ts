import type { AuthenticatedUser } from './auth.js';
import { db } from './db.js';

/**
 * One-time adoption of pre-auth data: rows created before user accounts
 * existed have a NULL user_id and are invisible to everyone. When the user
 * configured via LEGACY_CLAIM_EMAIL signs in with that email verified, they
 * adopt every unowned row. Requiring a *verified* email is load-bearing —
 * anyone can register an email/password account with an address they don't
 * control, and an unverified match must never hand over the data.
 *
 * Idempotent and cheap once claimed (both UPDATEs match zero rows), so it's
 * safe to call on every authenticated request.
 */
export function claimLegacyRows(user: AuthenticatedUser): void {
  const claimEmail = process.env.LEGACY_CLAIM_EMAIL;
  if (!claimEmail || !user.email || !user.emailVerified) return;
  if (user.email.toLowerCase() !== claimEmail.toLowerCase()) return;

  const collection = db
    .prepare('UPDATE collection SET user_id = ? WHERE user_id IS NULL')
    .run(user.uid);
  const scanHistory = db
    .prepare('UPDATE scan_history SET user_id = ? WHERE user_id IS NULL')
    .run(user.uid);

  if (collection.changes > 0 || scanHistory.changes > 0) {
    console.log(
      `[legacy-claim] ${user.uid} adopted ${collection.changes} collection row(s) and ${scanHistory.changes} scan-history row(s)`,
    );
  }
}
