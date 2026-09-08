import { Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function LoginScreen() {
  const { session, loading, signIn, defaultServerUrl } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(defaultServerUrl);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => setServer(defaultServerUrl), [defaultServerUrl]);
  if (!loading && session) return <Redirect href="/(tabs)" />;

  async function submit() {
    if (!email.trim() || !password || !server.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await signIn(email, password, server);
      router.replace('/(tabs)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return <KeyboardAvoidingView
    style={styles.keyboard}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
  ><Screen>
    <View style={styles.brand}><View style={styles.gem}><Text style={styles.gemText}>◆</Text></View><View style={styles.brandCopy}><Text style={styles.brandName}>Diamond Shine</Text><Text style={styles.brandTag}>Field Operations</Text></View></View>
    <View style={styles.welcome}><Text style={styles.title}>Your workday, clear and under control.</Text><Text style={styles.subtitle}>Visits, proof of service, materials and important updates — even when the signal disappears.</Text></View>
    <Card style={styles.form}><Text style={styles.formTitle}>Sign in</Text>
      <Text style={styles.label}>Work email</Text>
      <TextInput
        accessibilityLabel="Work email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="next"
        blurOnSubmit={false}
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => passwordRef.current?.focus()}
        style={styles.input}
        placeholder="you@company.com"
      />
      <Text style={styles.label}>Password</Text>
      <View style={styles.passwordShell}>
        <TextInput
          ref={passwordRef}
          accessibilityLabel="Password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          style={styles.passwordInput}
          placeholder="Enter your password"
        />
        <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={10} onPress={() => setShowPassword((value) => !value)} style={styles.eyeButton}>
          <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={styles.keyboardHelp}>You can scroll this form while the keyboard is open.</Text>
      <Pressable onPress={() => setAdvanced((value) => !value)} accessibilityRole="button" style={styles.serverButton}><Ionicons name="settings-outline" size={16} color={colors.primary} /><Text style={styles.serverToggle}>{advanced ? 'Hide server settings' : 'Server settings'}</Text></Pressable>
      {advanced ? <><Text style={styles.label}>Company server</Text><TextInput accessibilityLabel="Company server" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={server} onChangeText={setServer} style={styles.input} placeholder="http://192.168.1.10:3000" /><Text style={styles.help}>On a phone, use the computer&apos;s local network address.</Text></> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button title="Sign in securely" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !password || !server.trim()} />
    </Card>
  </Screen></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1, backgroundColor: colors.canvas },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  brandCopy: { flex: 1 },
  gem: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  gemText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  brandName: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  brandTag: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 1 },
  welcome: { gap: 8, paddingVertical: 18 },
  title: { color: colors.ink, fontSize: 31, lineHeight: 36, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  form: { gap: 9 },
  formTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', marginBottom: 5 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FBFCFD' },
  passwordShell: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: '#FBFCFD' },
  passwordInput: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: colors.ink },
  eyeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  keyboardHelp: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  serverButton: { alignSelf: 'flex-start', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  serverToggle: { color: colors.primary, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontWeight: '700', padding: 10, borderRadius: 10, backgroundColor: '#FDECEA' },
});
