import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { normalizeBaseUrl, registerUnauthorizedHandler } from './api';
import { getDeviceId } from './device';
import { claimOfflineWorkspace } from './offline';
import { registerForPushNotifications } from './push';
import {
  biometricSecureDelete,
  biometricSecureGet,
  biometricSecureSet,
  canUseBiometricSecureStorage,
  secureDelete,
  secureGet,
  secureSet,
} from './secure-storage';
import type { Session } from './types';

const SESSION_KEY = 'diamond-shine-session-v1';
const SERVER_KEY = 'diamond-shine-server-v1';
const BIOMETRIC_CREDENTIAL_KEY = 'diamond-shine-biometric-credential-v1';
const BIOMETRIC_ACCOUNT_KEY = 'diamond-shine-biometric-account-v1';
const fallbackUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

type BiometricAccount = {
  email: string;
  serverUrl: string;
};

type BiometricCredential = BiometricAccount & {
  password: string;
};

type SignInResult = {
  biometricSaved: boolean;
};

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signIn(email: string, password: string, serverUrl: string, options?: { rememberBiometric?: boolean }): Promise<SignInResult>;
  signInWithBiometrics(): Promise<void>;
  disableBiometricSignIn(): Promise<void>;
  biometricAvailable: boolean;
  biometricAccount: BiometricAccount | null;
  signOut(): Promise<void>;
  defaultServerUrl: string;
};

class SignInError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'SignInError';
  }
}

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

function parseBiometricAccount(value: string | null): BiometricAccount | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BiometricAccount>;
    if (!parsed.email || !parsed.serverUrl) return null;
    return { email: parsed.email.trim().toLowerCase(), serverUrl: parsed.serverUrl };
  } catch {
    return null;
  }
}

function parseBiometricCredential(value: string | null): BiometricCredential | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BiometricCredential>;
    if (!parsed.email || !parsed.password || !parsed.serverUrl) return null;
    return { email: parsed.email.trim().toLowerCase(), password: parsed.password, serverUrl: parsed.serverUrl };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultServerUrl, setDefaultServerUrl] = useState(fallbackUrl);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricAccount, setBiometricAccount] = useState<BiometricAccount | null>(null);
  const pushToken = useRef<string | null>(null);

  const clearBiometricSignIn = useCallback(async () => {
    await Promise.all([
      biometricSecureDelete(BIOMETRIC_CREDENTIAL_KEY).catch(() => undefined),
      secureDelete(BIOMETRIC_ACCOUNT_KEY),
    ]);
    setBiometricAccount(null);
  }, []);

  useEffect(() => {
    void (async () => {
      const [saved, server, savedBiometricAccount] = await Promise.all([
        secureGet(SESSION_KEY),
        secureGet(SERVER_KEY),
        secureGet(BIOMETRIC_ACCOUNT_KEY),
      ]);
      const biometrics = canUseBiometricSecureStorage();
      setBiometricAvailable(biometrics);
      const account = parseBiometricAccount(savedBiometricAccount);
      if (account && biometrics) setBiometricAccount(account);
      else if (savedBiometricAccount && !account) await secureDelete(BIOMETRIC_ACCOUNT_KEY);

      if (server && !fallbackUrl) setDefaultServerUrl(server);
      if (!saved) return;
      try {
        const restored = JSON.parse(saved) as unknown;
        if (!isRestorableSession(restored)) {
          await secureDelete(SESSION_KEY);
          return;
        }
        if (fallbackUrl && normalizeBaseUrl(restored.baseUrl) !== normalizeBaseUrl(fallbackUrl)) {
          // Never send an old environment's credentials/queued work to a new API.
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

  const authenticate = useCallback(async (email: string, password: string, serverUrl: string) => {
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
        if (cause instanceof Error && cause.name === 'AbortError') throw new SignInError('The company server did not respond. Check the server address and network.');
        throw new SignInError('Cannot reach the company server. Check Wi-Fi, server address, and that the server is running.');
      }
      const payload = await response.json().catch(() => null) as { data?: Omit<Session, 'baseUrl'>; error?: string } | null;
      if (!response.ok || !payload?.data?.accessToken) throw new SignInError(payload?.error ?? 'Unable to sign in.', response.status);
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
      return { next, baseUrl };
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const signIn = useCallback(async (
    email: string,
    password: string,
    serverUrl: string,
    options: { rememberBiometric?: boolean } = {},
  ): Promise<SignInResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    const { baseUrl } = await authenticate(normalizedEmail, password, serverUrl);
    let biometricSaved = false;

    if (options.rememberBiometric && canUseBiometricSecureStorage()) {
      const credential: BiometricCredential = { email: normalizedEmail, password, serverUrl: baseUrl };
      const account: BiometricAccount = { email: normalizedEmail, serverUrl: baseUrl };
      try {
        // The password is never written to AsyncStorage/plain storage. It is
        // encrypted by the OS and can be read only after the enrolled biometric
        // authenticates. Non-secret metadata lets the login screen show which
        // account is available without triggering a biometric prompt.
        await biometricSecureSet(BIOMETRIC_CREDENTIAL_KEY, JSON.stringify(credential), 'Enable fingerprint sign-in for Diamond Shine');
        await secureSet(BIOMETRIC_ACCOUNT_KEY, JSON.stringify(account));
        setBiometricAccount(account);
        setBiometricAvailable(true);
        biometricSaved = true;
      } catch {
        await clearBiometricSignIn();
      }
    } else if (biometricAccount && biometricAccount.email !== normalizedEmail) {
      // Never leave another employee's quick-login identity behind after a
      // different account signs in on the same field device.
      await clearBiometricSignIn();
    }

    return { biometricSaved };
  }, [authenticate, biometricAccount, clearBiometricSignIn]);

  const signInWithBiometrics = useCallback(async () => {
    if (!biometricAccount || !canUseBiometricSecureStorage()) {
      throw new Error('Fingerprint sign-in is not set up on this device.');
    }

    let stored: string | null;
    try {
      stored = await biometricSecureGet(BIOMETRIC_CREDENTIAL_KEY, 'Sign in to Diamond Shine');
    } catch {
      throw new Error('Fingerprint sign-in was cancelled.');
    }
    const credential = parseBiometricCredential(stored);
    if (!credential || credential.email !== biometricAccount.email) {
      await clearBiometricSignIn();
      throw new Error('Fingerprint sign-in needs to be set up again.');
    }

    try {
      await authenticate(credential.email, credential.password, credential.serverUrl);
    } catch (error) {
      if (error instanceof SignInError && (error.status === 401 || error.status === 403)) {
        await clearBiometricSignIn();
        throw new Error('Your account credentials changed. Sign in with your password to set up fingerprint access again.');
      }
      throw error;
    }
  }, [authenticate, biometricAccount, clearBiometricSignIn]);

  const disableBiometricSignIn = useCallback(async () => {
    await clearBiometricSignIn();
  }, [clearBiometricSignIn]);

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
    if (!session) return;
    let disposed = false;
    // Notification registration is useful but not needed to paint Today or
    // restore offline work. Keep it off the startup critical path.
    const task = InteractionManager.runAfterInteractions(() => {
      if (disposed) return;
      void registerForPushNotifications(session)
        .then((token) => { if (!disposed) pushToken.current = token; })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      task.cancel();
    };
  }, [session]);

  const value = useMemo(() => ({
    session,
    loading,
    signIn,
    signInWithBiometrics,
    disableBiometricSignIn,
    biometricAvailable,
    biometricAccount,
    signOut,
    defaultServerUrl,
  }), [
    session,
    loading,
    signIn,
    signInWithBiometrics,
    disableBiometricSignIn,
    biometricAvailable,
    biometricAccount,
    signOut,
    defaultServerUrl,
  ]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
