import type { User } from 'firebase/auth';

const providerLabels: Record<string, string> = {
  'google.com': 'Google',
  'github.com': 'GitHub',
  password: 'Email',
};

/** Friendly label for the sign-in method behind this account, e.g. "Google". */
export function getProviderLabel(user: User): string | null {
  const providerId = user.providerData[0]?.providerId;
  return providerId ? providerLabels[providerId] ?? null : null;
}
