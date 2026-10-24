import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { ensureUserAccount, seedEtfDemoData } from '../services/zamioService';
import { UserPrivate, UserProfile, UserRole } from '../types/zamio';

export type ActivePortalMode = 'student' | 'professor';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  privateData: UserPrivate | null;
  isAdminUser: boolean;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  portalMode: ActivePortalMode;
  setPortalMode: (mode: ActivePortalMode) => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateData, setPrivateData] = useState<UserPrivate | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [portalMode, setPortalModeState] = useState<ActivePortalMode>('student');

  const syncAccount = useCallback(async (user: User, isFirstBootSeed = false) => {
    const res = await ensureUserAccount({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || 'Korisnik',
    });

    setProfile(res.profile);
    setPrivateData(res.privateData);
    setIsAdminUser(res.isAdminUser);

    if (res.isAdminUser || res.profile.role === UserRole.PROFESSOR) {
      setPortalModeState((prev) =>
        res.profile.role === UserRole.PROFESSOR ? 'professor' : prev
      );
    } else {
      setPortalModeState('student');
    }

    // Automatically initialize realistic ETF Sarajevo seed data once for admin if DB has no seed course yet
    if (isFirstBootSeed && res.isAdminUser) {
      try {
        await seedEtfDemoData({
          adminUid: user.uid,
          adminName: res.profile.fullName,
          adminIndex: res.profile.studentIndex || '19001',
        });
      } catch (err) {
        console.warn('Initial seed skipped:', err);
      }
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setPrivateData(null);
        setIsAdminUser(false);
        setAuthReady(true);
        return;
      }

      try {
        setAuthError(null);
        await syncAccount(user, true);
      } catch (err) {
        console.error('Greška pri inicijalizaciji profila:', err);
        setAuthError(
          err instanceof Error
            ? err.message
            : 'Nije moguće učitati korisnički profil iz baze podataka.'
        );
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, [syncAccount]);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user') {
        setAuthError(
          err instanceof Error
            ? err.message
            : 'Prijava putem Google računa nije uspjela. Pokušajte ponovo.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setPrivateData(null);
    setIsAdminUser(false);
    setPortalModeState('student');
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    await syncAccount(auth.currentUser, false);
  };

  const setPortalMode = (mode: ActivePortalMode) => {
    if (mode === 'professor' && !isAdminUser && profile?.role !== UserRole.PROFESSOR) {
      return;
    }
    setPortalModeState(mode);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        privateData,
        isAdminUser,
        authReady,
        signingIn,
        authError,
        portalMode,
        setPortalMode,
        signInWithGoogle,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth mora biti korišten unutar AuthProvider komponente.');
  }
  return ctx;
}
