import type { RequestHandler } from 'express';

/** The identity attached to a request after its Firebase ID token verifies. */
export interface AuthenticatedUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

/**
 * Verifies a raw bearer token and resolves the user it belongs to, or throws.
 * Production wires this to firebase-admin's verifyIdToken; tests inject fakes.
 */
export type TokenVerifier = (token: string) => Promise<AuthenticatedUser>;

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function createAuthMiddleware(verifier: TokenVerifier): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    verifier(token)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(() => {
        // Never echo verifier errors to the client — they can carry token
        // internals. An invalid token and a missing one look identical.
        res.status(401).json({ error: 'Invalid or expired credentials' });
      });
  };
}
