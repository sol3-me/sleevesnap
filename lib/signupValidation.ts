const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

export interface AuthFieldErrors {
  email?: string;
  password?: string;
}

/** Client-side pre-submit checks, so the user sees a problem before a round trip to Firebase. */
export function validateAuthFields(
  email: string,
  password: string,
  mode: 'sign-in' | 'sign-up',
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = "That doesn't look like a valid email address.";
  }

  if (!password) {
    errors.password = 'Password is required.';
  } else if (mode === 'sign-up' && password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password needs to be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return errors;
}
