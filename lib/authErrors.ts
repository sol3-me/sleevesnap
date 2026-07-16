import { FirebaseError } from 'firebase/app';

export interface AuthFieldError {
  field: 'email' | 'password' | null;
  message: string;
}

/**
 * Maps a Firebase Auth error to a message and, where the error clearly
 * belongs to one input, the field it should be shown under. `field: null`
 * means the error applies to the attempt as a whole (rate limiting, popup
 * blocked, etc.) and should only be toasted.
 */
export function describeAuthFieldError(err: unknown): AuthFieldError | null {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return null; // the user changed their mind — not an error worth surfacing
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return { field: 'password', message: 'Email or password is incorrect.' };
      case 'auth/email-already-in-use':
        return {
          field: 'email',
          message: 'An account with this email already exists — try signing in instead.',
        };
      case 'auth/weak-password':
        return { field: 'password', message: 'Password needs to be at least 6 characters.' };
      case 'auth/invalid-email':
        return { field: 'email', message: "That doesn't look like a valid email address." };
      case 'auth/account-exists-with-different-credential':
        return {
          field: 'email',
          message:
            'This email is already linked to a different sign-in method — try the provider you used before.',
        };
      case 'auth/too-many-requests':
        return { field: null, message: 'Too many attempts — wait a moment and try again.' };
      case 'auth/popup-blocked':
        return {
          field: null,
          message: 'Your browser blocked the sign-in popup — allow popups for this site and retry.',
        };
      default:
        return { field: null, message: `Sign-in failed (${err.code}).` };
    }
  }
  return { field: null, message: 'Sign-in failed. Please try again.' };
}
