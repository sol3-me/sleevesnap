import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { setApiTokenGetter } from './apiFetch';

// All values here are public client identifiers, not secrets — Firebase web
// config is safe to ship to the browser. Security comes from the server
// verifying ID tokens, never from hiding these strings.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length > 0) {
  throw new Error(
    `Missing Firebase web config: ${missing.join(', ')}. Copy .env.example to .env and fill in the VITE_FIREBASE_* values from your Firebase project settings.`,
  );
}

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

// Opt-in local dev against the Firebase Auth Emulator instead of the real
// project (`npm run dev:emulators`, see README) — set
// VITE_USE_FIREBASE_EMULATOR=true in .env. The import.meta.env.DEV check is
// belt-and-suspenders: that flag is statically false in a production build,
// so this can never fire there even if the env var leaked into one.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099');
}

// Every app API call attaches the current user's ID token; getIdToken()
// serves a cached token and transparently refreshes it near expiry.
setApiTokenGetter(async () => {
  const user = firebaseAuth.currentUser;
  return user ? await user.getIdToken() : null;
});
