import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBaseUrl, registerUnauthorizedHandler } from './api';
import { getDeviceId } from './device';
import { claimOfflineWorkspace } from './offline';
import { registerForPushNotifications } from './push';
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

function workspaceOwner(session: Pick<Session, 'organizationId' | 'email'>) {
  return `${session.organizationId}:${session.email.trim().toLowerCase()}`;
}

function validateServerUrl(value: string) {
  const normalized = normalizeBaseUrl(value);
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error('Enter a valid company server URL, for example http://192.168.1.10:3000.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Company server must use http:// or https://.');
  if (!__DEV__ && url.protocol !== 'https:') throw new Error('Production mobile sessions require an HTTPS company server.');
  return normalized;
}

function isRestorableSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<Session>;
  return Boolean(session.accessToken && session.email && session.organizationId && session.baseUrl && session.membershipRole && session.timezone);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultServerUrl, setDefaultServerUrl] = useState(fallbackUrl);
  const pushToken = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [saved, server] = await Promise.all([secureGet(SESSION_KEY), secureGet(SERVER_KEY)]);
      if (server) setDefaultServerUrl(server);
      if (!saved) return;
      try {
        const restored = JSON.parse(saved) as unknown;
        if (!isRestorableSession(restored)) {
          await secureDelete(SESSION_KEY);
          return;
        }
        if (restored.expiresAt && new Date(restored.expiresAt) <= new Date()) {
          await secureDelete(SESSION_KEY);
          return;
        }
        await claimOfflineWorkspace(workspaceOwner(restored));
        setSession(restored);
      } catch {
        await secureDelete(SESSION_KEY);
      }
    })().finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string, serverUrl: string) => {
    const baseUrl = validateServerUrl(serverUrl || fallbackUrl);
    const deviceName = await getDeviceId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, password, mobile: true, deviceName }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') throw new Error('The company server did not respond. Check the server address and network.');
        throw new Error('Cannot reach the company server. Check Wi-Fi, server address, and that the server is running.');
      }
      const payload = await response.json().catch(() => null) as { data?: Omit<Session, 'baseUrl'>; error?: string } | null;
      if (!response.ok || !payload?.data?.accessToken) throw new Error(payload?.error ?? 'Unable to sign in.');
      const next: Session = { ...payload.data, baseUrl };
      try {
        await claimOfflineWorkspace(workspaceOwner(next));
      } catch (error) {
        await fetch(`${baseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${next.accessToken}`, Accept: 'application/json' },
        }).catch(() => undefined);
        throw error;
      }
      await Promise.all([
        secureSet(SESSION_KEY, JSON.stringify(next)),
        secureSet(SERVER_KEY, baseUrl),
      ]);
      setDefaultServerUrl(baseUrl);
      setSession(next);
    } finally {
      clearTimeout(timeout);
    }
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
