import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { normalizeBaseUrl } from './api';
import { secureDelete, secureGet, secureSet } from './secure-storage';
import type { Session } from './types';

const SESSION_KEY = 'diamond-shine-session-v1';
const SERVER_KEY = 'diamond-shine-server-v1';
const fallbackUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signIn(email: string, password: string, serverUrl: string): Promise<void>;
  signOut(): Promise<void>;
  defaultServerUrl: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultServerUrl, setDefaultServerUrl] = useState(fallbackUrl);

  useEffect(() => {
    void Promise.all([secureGet(SESSION_KEY), secureGet(SERVER_KEY)])
      .then(([saved, server]) => {
        if (server) setDefaultServerUrl(server);
        if (saved) setSession(JSON.parse(saved) as Session);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string, serverUrl: string) => {
    const baseUrl = normalizeBaseUrl(serverUrl || fallbackUrl);
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password, mobile: true }),
    });
    const payload = await response.json().catch(() => null) as { data?: Omit<Session, 'baseUrl'>; error?: string } | null;
    if (!response.ok || !payload?.data?.accessToken) throw new Error(payload?.error ?? 'Unable to sign in.');
    const next: Session = { ...payload.data, baseUrl };
    await Promise.all([
      secureSet(SESSION_KEY, JSON.stringify(next)),
      secureSet(SERVER_KEY, baseUrl),
    ]);
    setDefaultServerUrl(baseUrl);
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await secureDelete(SESSION_KEY);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, loading, signIn, signOut, defaultServerUrl }), [session, loading, signIn, signOut, defaultServerUrl]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
