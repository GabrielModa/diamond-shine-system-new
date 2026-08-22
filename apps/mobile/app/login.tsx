import { Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

export default function LoginScreen() {
  const { session, loading, signIn, defaultServerUrl } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [server, setServer] = useState(defaultServerUrl);
  const [advanced, setAdvanced] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => setServer(defaultServerUrl), [defaultServerUrl]);
  if (!loading && session) return <Redirect href="/(tabs)" />;
  async function submit() { setBusy(true); setError(''); try { await signIn(email, password, server); router.replace('/(tabs)'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); } finally { setBusy(false); } }

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Screen>
    <View style={styles.brand}><View style={styles.gem}><Text style={styles.gemText}>◆</Text></View><Text style={styles.brandName}>Diamond Shine</Text><Text style={styles.brandTag}>Field Operations</Text></View>
    <View style={styles.welcome}><Text style={styles.title}>Your workday, clear and under control.</Text><Text style={styles.subtitle}>Visits, proof of service, materials and important updates — even when the signal disappears.</Text></View>
    <Card style={styles.form}><Text style={styles.formTitle}>Sign in</Text>
      <Text style={styles.label}>Work email</Text><TextInput accessibilityLabel="Work email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} placeholder="you@company.com" />
      <Text style={styles.label}>Password</Text><TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} placeholder="••••••••" />
      <Text onPress={() => setAdvanced((value) => !value)} style={styles.serverToggle}>{advanced ? 'Hide server settings' : 'Server settings'}</Text>
      {advanced ? <><Text style={styles.label}>Company server</Text><TextInput accessibilityLabel="Company server" autoCapitalize="none" value={server} onChangeText={setServer} style={styles.input} placeholder="http://192.168.1.10:3000" /><Text style={styles.help}>On a phone, use the computer&apos;s local network address.</Text></> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Button title="Sign in securely" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !password || !server.trim()} />
    </Card>
  </Screen></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 18 }, gem: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }, gemText: { color: '#fff', fontSize: 20, fontWeight: '900' }, brandName: { color: colors.ink, fontSize: 20, fontWeight: '900' }, brandTag: { color: colors.muted, fontSize: 11, fontWeight: '700', marginLeft: 'auto' },
  welcome: { gap: 10, paddingVertical: 24 }, title: { color: colors.ink, fontSize: 35, lineHeight: 40, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 16, lineHeight: 24 }, form: { gap: 9 }, formTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', marginBottom: 5 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { minHeight: 49, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FBFCFD' }, serverToggle: { color: colors.primary, fontWeight: '800', paddingVertical: 4 }, help: { color: colors.muted, fontSize: 12, lineHeight: 17 }, error: { color: colors.danger, fontWeight: '700', padding: 10, borderRadius: 10, backgroundColor: '#FDECEA' },
});
