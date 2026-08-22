import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBaseUrl, registerUnauthorizedHandler } from './api';
import { getDeviceId } from './device';
import { secureDelete, secureGet, secureSet } from './secure-storage';
import type { Session } from './types';
import { registerForPushNotifications } from './push';

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
  const pushToken = useRef<string | null>(null);

  useEffect(() => {
    void Promise.all([secureGet(SESSION_KEY), secureGet(SERVER_KEY)])
      .then(([saved, server]) => {
        if (server) setDefaultServerUrl(server);
        if (saved) {
          const restored = JSON.parse(saved) as Session;
          if (!restored.expiresAt || new Date(restored.expiresAt) > new Date()) setSession(restored);
          else void secureDelete(SESSION_KEY);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string, serverUrl: string) => {
    const baseUrl = normalizeBaseUrl(serverUrl || fallbackUrl);
    const deviceName = await getDeviceId();
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password, mobile: true, deviceName }),
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
    if (session) {
      if (pushToken.current) {
        await fetch(`${normalizeBaseUrl(session.baseUrl)}/api/devices/push-token`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: pushToken.current }),
        }).catch(() => undefined);
      }
      await fetch(`${normalizeBaseUrl(session.baseUrl)}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
      }).catch(() => undefined);
    }
    pushToken.current = null;
    await secureDelete(SESSION_KEY);
    setSession(null);
  }, [session]);

  useEffect(() => {
    registerUnauthorizedHandler(() => signOut());
    return () => registerUnauthorizedHandler(null);
  }, [signOut]);

  useEffect(() => {
    if (session) {
      void registerForPushNotifications(session)
        .then((token) => { pushToken.current = token; })
        .catch(() => undefined);
    }
  }, [session]);

  const value = useMemo(() => ({ session, loading, signIn, signOut, defaultServerUrl }), [session, loading, signIn, signOut, defaultServerUrl]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
