import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updatePassword,
  User,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { ensureUserAccount, seedEtfDemoData } from '../services/zamioService';
import { UserPrivate, UserProfile, UserRole } from '../types/zamio';

export type ActivePortalMode = 'student' | 'professor' | 'admin';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  privateData: UserPrivate | null;
  isAdminUser: boolean;
  hasPasswordProvider: boolean;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  clearAuthError: () => void;
  portalMode: ActivePortalMode;
  setPortalMode: (mode: ActivePortalMode) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithCredentials: (email: string, password: string) => Promise<void>;
  changeOwnPassword: (params: { currentPassword?: string; newPassword: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function translateFirebaseAuthError(
  err: unknown,
  context: 'login' | 'reauth' = 'login'
): string {
  const code = (err as { code?: string })?.code || '';
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-email'
  ) {
    if (context === 'reauth') {
      return 'Trenutna šifra nije tačna. Provjerite unos i pokušajte ponovo.';
    }
    return 'Pogrešna e-mail adresa ili lozinka. Provjerite pristupne podatke koje vam je dodijelio administrator.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Prijava putem e-maila i lozinke trenutno nije uključena u Firebase konzoli (Authentication → Sign-in method → Email/Password).';
  }
  if (code === 'auth/too-many-requests') {
    return 'Previše neuspješnih pokušaja potvrde lozinke. Sačekajte nekoliko minuta pa pokušajte ponovo.';
  }
  if (code === 'auth/weak-password') {
    return 'Nova šifra mora sadržavati najmanje 6 karaktera.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Radi sigurnosti je potrebna ponovna potvrda trenutne šifre prije izmjene.';
  }
  if (code === 'auth/provider-already-linked') {
    return 'Šifra je već povezana sa ovim nalogom. Unesite trenutnu šifru za promjenu.';
  }
  return err instanceof Error
    ? err.message
    : 'Autentifikacija nije uspjela. Pokušajte ponovo.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateData, setPrivateData] = useState<UserPrivate | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [hasPasswordProvider, setHasPasswordProvider] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [portalMode, setPortalModeState] = useState<ActivePortalMode>('student');

  const computeHasPassword = (user: User | null): boolean => {
    if (!user) return false;
    return user.providerData.some((p) => p.providerId === 'password');
  };

  const syncAccount = useCallback(async (user: User, isFirstBootSeed = false) => {
    setHasPasswordProvider(computeHasPassword(user));

    const res = await ensureUserAccount({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Korisnik',
      emailVerified: user.emailVerified,
    });

    setProfile(res.profile);
    setPrivateData(res.privateData);
    setIsAdminUser(res.isAdminUser);

    setPortalModeState((prev) => {
      const adminAllowed = res.isAdminUser || res.profile.role === UserRole.ADMIN;
      const profAllowed = adminAllowed || res.profile.role === UserRole.PROFESSOR;

      if (isFirstBootSeed) {
        if (adminAllowed) return 'admin';
        if (res.profile.role === UserRole.PROFESSOR) return 'professor';
        return 'student';
      }

      if (prev === 'admin' && adminAllowed) return 'admin';
      if (prev === 'professor' && profAllowed) return 'professor';
      if (prev === 'student') return 'student';

      if (adminAllowed) return 'admin';
      if (profAllowed) return 'professor';
      return 'student';
    });

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
      setHasPasswordProvider(computeHasPassword(user));
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
        setAuthError(translateFirebaseAuthError(err));
      }
    } finally {
      setSigningIn(false);
    }
  };

  const signInWithCredentials = async (email: string, password: string) => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setAuthError('Unesite e-mail adresu i lozinku.');
      return;
    }
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, cleanEmail, password);
    } catch (err: unknown) {
      setAuthError(translateFirebaseAuthError(err));
      throw err;
    } finally {
      setSigningIn(false);
    }
  };

  const changeOwnPassword = async (params: {
    currentPassword?: string;
    newPassword: string;
  }) => {
    const user = auth.currentUser;
    if (!user || !user.email) {
      throw new Error('Korisnik nije prijavljen ili nema registrovanu e-mail adresu.');
    }
    const rawNewPassword = params.newPassword;
    if (rawNewPassword.length < 6 || rawNewPassword.length > 64) {
      throw new Error('Nova šifra mora imati između 6 i 64 karaktera.');
    }

    const alreadyHasPassword = computeHasPassword(user);

    try {
      if (alreadyHasPassword) {
        if (!params.currentPassword || params.currentPassword.length === 0) {
          throw new Error('Unesite trenutnu šifru radi sigurnosne potvrde identiteta.');
        }
        if (rawNewPassword === params.currentPassword) {
          throw new Error('Nova šifra mora biti različita od trenutne šifre.');
        }
        const credential = EmailAuthProvider.credential(user.email, params.currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, rawNewPassword);
      } else {
        const credential = EmailAuthProvider.credential(user.email, rawNewPassword);
        await linkWithCredential(user, credential);
      }
      setHasPasswordProvider(true);
    } catch (err: unknown) {
      throw new Error(translateFirebaseAuthError(err, 'reauth'));
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setPrivateData(null);
    setIsAdminUser(false);
    setHasPasswordProvider(false);
    setPortalModeState('student');
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    await syncAccount(auth.currentUser, false);
  };

  const setPortalMode = (mode: ActivePortalMode) => {
    const adminAllowed = isAdminUser || profile?.role === UserRole.ADMIN;
    if (mode === 'admin' && !adminAllowed) {
      return;
    }
    if (mode === 'professor' && !adminAllowed && profile?.role !== UserRole.PROFESSOR) {
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
        hasPasswordProvider,
        authReady,
        signingIn,
        authError,
        clearAuthError: () => setAuthError(null),
        portalMode,
        setPortalMode,
        signInWithGoogle,
        signInWithCredentials,
        changeOwnPassword,
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
