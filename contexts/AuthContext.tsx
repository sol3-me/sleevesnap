import {
  GithubAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { firebaseAuth } from '../lib/firebase';

interface AuthContextValue {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
  /** True until the first auth-state snapshot arrives — render a splash, not the login screen. */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    // Popup over redirect: browsers now block the third-party storage the
    // redirect flow relies on (see Firebase's redirect-best-practices doc).
    signInWithGoogle: async () => {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    },
    signInWithGitHub: async () => {
      await signInWithPopup(firebaseAuth, new GithubAuthProvider());
    },
    signInWithEmail: async (email, password) => {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
    },
    signUpWithEmail: async (email, password) => {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      // The legacy-data claim (and any future email-trust feature) requires a
      // verified address, so kick the verification email off immediately.
      await sendEmailVerification(credential.user);
    },
    resetPassword: async (email) => {
      await sendPasswordResetEmail(firebaseAuth, email);
    },
    signOut: async () => {
      await firebaseSignOut(firebaseAuth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
