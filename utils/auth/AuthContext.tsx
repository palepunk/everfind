import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

// FOSS placeholder: the cloud edition replaces this file from the private repo.
// Keep this contract in public so shared screens can call auth hooks without
// depending on Supabase, Google sign-in, Apple sign-in, or account deletion APIs.

export type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

export type AuthSession = {
  access_token: string;
  user: AuthUser;
};

type AuthContextValue = {
  session: AuthSession | null;
  user: AuthUser | null;
  isLoading: boolean;
  lastAuthEvent: string | null;
  lastSignInAt: number | null;
  consumeAuthEvent: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const unavailable = async () => undefined;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      session: null,
      user: null,
      isLoading: false,
      lastAuthEvent: null,
      lastSignInAt: null,
      consumeAuthEvent: () => undefined,
      signInWithGoogle: unavailable,
      signInWithApple: unavailable,
      signOut: unavailable,
      deleteAccount: unavailable,
    }),
    []
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export const getUserAvatarUrl = (user?: AuthUser | null) => {
  const metadata = user?.user_metadata;
  const value = metadata?.avatar_url ?? metadata?.picture;
  return typeof value === 'string' ? value : undefined;
};
