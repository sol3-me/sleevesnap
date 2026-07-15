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

export function createAuthMiddleware(_verifier: TokenVerifier): RequestHandler {
  return (_req, _res, next) => {
    next();
  };
}
