import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { normalizeBaseUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { defaultServerUrl, biometricAccount } = useAuth();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : biometricAccount?.email ?? '');
  const [server, setServer] = useState(defaultServerUrl || biometricAccount?.serverUrl || '');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!server && defaultServerUrl) setServer(defaultServerUrl);
  }, [defaultServerUrl, server]);

  async function submit() {
    if (!email.trim() || !server.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const baseUrl = normalizeBaseUrl(server);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });
      } catch {
        throw new Error('Cannot reach the company server. Check your connection and try again.');
      }
      if (!response.ok) throw new Error('We could not request the reset email right now. Try again in a moment.');
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to request a password reset.');
    } finally {
      setBusy(false);
    }
  }

  return <Screen>
    <PageHeader eyebrow="Account recovery" title="Reset your password" subtitle="Enter your work email. We’ll send a secure link so you can choose a new password." />
    {sent ? <Card style={styles.successCard}>
      <View style={styles.successIcon}><Ionicons name="mail-open-outline" size={28} color={colors.success} /></View>
      <Text style={styles.successTitle}>Check your email</Text>
      <Text style={styles.successCopy}>If an account exists for <Text style={styles.email}>{email.trim().toLowerCase()}</Text>, a Diamond Shine password reset link has been sent.</Text>
      <Text style={styles.safeCopy}>For security, we show the same message whether or not the address is registered.</Text>
      <Button title="Back to sign in" onPress={() => router.replace('/login')} />
    </Card> : <Card style={styles.form}>
      <Text style={styles.label}>Work email</Text>
      <TextInput
        accessibilityLabel="Work email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="send"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => void submit()}
        style={styles.input}
        placeholder="you@company.com"
      />
      <Text style={styles.help}>The link is sent to your work email and opens the secure Diamond Shine reset page.</Text>

      <Pressable onPress={() => setAdvanced((value) => !value)} accessibilityRole="button" style={styles.serverButton}>
        <Ionicons name="settings-outline" size={16} color={colors.primary} />
        <Text style={styles.serverToggle}>{advanced ? 'Hide server settings' : 'Server settings'}</Text>
      </Pressable>
      {advanced ? <>
        <Text style={styles.label}>Company server</Text>
        <TextInput accessibilityLabel="Company server" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={server} onChangeText={setServer} style={styles.input} placeholder="https://company.example.com" />
      </> : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button title="Send reset link" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !server.trim()} />
      <Button title="Back to sign in" variant="secondary" onPress={() => router.back()} disabled={busy} />
    </Card>}
  </Screen>;
}

const styles = StyleSheet.create({
  form: { gap: 10 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FBFCFD' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  serverButton: { alignSelf: 'flex-start', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  serverToggle: { color: colors.primary, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700', padding: 10, borderRadius: 10, backgroundColor: '#FDECEA' },
  successCard: { alignItems: 'stretch', gap: 12, borderColor: '#B8E0D2', backgroundColor: '#F5FCF8' },
  successIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  successTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  successCopy: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  email: { color: colors.primary, fontWeight: '900' },
  safeCopy: { color: colors.muted, fontSize: 11, lineHeight: 17 },
});
