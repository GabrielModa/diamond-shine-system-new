import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Profile = {
  phone: string | null;
  home: { label: string; address: string; latitude: number | null; longitude: number | null };
  travelMode: 'driving' | 'transit' | 'cycling';
  emergencyContact: { name: string; phone: string } | null;
  weeklyTargetMinutes: number | null;
  employmentStartDate: string | null;
  school: { name: string; address: string } | null;
};
type Data = {
  user: { name: string | null; email: string };
  profile: Profile | null;
  setupRequired: boolean;
  managerSetupRequired: boolean;
};

export default function ProfileScreen() {
  const { session } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [travelMode, setTravelMode] = useState<Profile['travelMode']>('transit');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const next = await apiFetch<Data>(session, '/api/workforce/profile');
      setData(next);
      setPhone(next.profile?.phone ?? '');
      setAddress(next.profile?.home.address ?? '');
      setTravelMode(next.profile?.travelMode ?? 'transit');
      setEmergencyName(next.profile?.emergencyContact?.name ?? '');
      setEmergencyPhone(next.profile?.emergencyContact?.phone ?? '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load profile.');
    }
  }, [session]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function save() {
    if (!session) return;
    if (!address.trim()) {
      setMessage('Operational starting address is required.');
      return;
    }
    if (Boolean(emergencyName.trim()) !== Boolean(emergencyPhone.trim())) {
      setMessage('Enter both emergency contact name and phone, or leave both blank.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const next = await apiFetch<Data>(session, '/api/workforce/profile', {
        method: 'PUT',
        body: JSON.stringify({
          phone: phone.trim() || null,
          home: { address: address.trim() },
          travelMode,
          emergencyContact: emergencyName.trim() && emergencyPhone.trim()
            ? { name: emergencyName.trim(), phone: emergencyPhone.trim() }
            : null,
        }),
      });
      setData(next);
      setMessage(next.managerSetupRequired
        ? 'Saved. Operations still needs to confirm your weekly target before automatic scheduling.'
        : 'Profile saved. Future routing can use your updated details.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Screen>
    <PageHeader eyebrow="My details" title="My profile" subtitle="Loading your operational profile." />
    {message ? <Text style={styles.message}>{message}</Text> : <ActivityIndicator color={colors.primary} />}
  </Screen>;

  return <Screen>
    <PageHeader eyebrow="My details" title="My profile" subtitle="Keep your contact and starting-location details accurate. Contract and recurring study rules stay under management control." />
    {message ? <Text style={styles.message}>{message}</Text> : null}

    {data.setupRequired ? <Card>
      <Text style={styles.title}>Setup required</Text>
      <Text style={styles.help}>Complete your details. Automatic scheduling stays off until operations confirms the manager-owned fields.</Text>
    </Card> : null}

    <Card>
      <Text style={styles.title}>Personal & operational</Text>
      <Text style={styles.help}>Changing your starting address can affect future routing. Existing published visits are not moved automatically.</Text>
      <Text style={styles.label}>Name</Text><Text style={styles.readonly}>{data.user.name ?? '—'}</Text>
      <Text style={styles.label}>Work email</Text><Text style={styles.readonly}>{data.user.email}</Text>
      <Text style={styles.label}>Phone</Text><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+353…" />
      <Text style={styles.label}>Operational starting address</Text><TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Home / regular starting address" />

      <Text style={styles.label}>Travel mode</Text>
      <View style={styles.modes}>
        {(['driving', 'transit', 'cycling'] as const).map((mode) => <Pressable key={mode} onPress={() => setTravelMode(mode)} accessibilityRole="button" style={[styles.mode, travelMode === mode && styles.modeActive]}>
          <Text style={[styles.modeText, travelMode === mode && styles.modeTextActive]}>{mode === 'driving' ? 'Drive' : mode === 'transit' ? 'Transit' : 'Cycle'}</Text>
        </Pressable>)}
      </View>

      <Text style={styles.label}>Emergency contact name (optional)</Text><TextInput style={styles.input} value={emergencyName} onChangeText={setEmergencyName} />
      <Text style={styles.label}>Emergency contact phone (optional)</Text><TextInput style={styles.input} value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" />
      <Button title="Save my profile" onPress={() => void save()} loading={busy} />
    </Card>

    <Card>
      <Text style={styles.title}>Managed by operations</Text>
      <Text style={styles.help}>These affect contractual capacity or recurring scheduling.</Text>
      <Text style={styles.label}>Weekly target</Text><Text style={styles.readonly}>{data.profile?.weeklyTargetMinutes == null ? 'Not configured' : `${Math.round(data.profile.weeklyTargetMinutes / 6) / 10} hours`}</Text>
      <Text style={styles.label}>Employment start date</Text><Text style={styles.readonly}>{data.profile?.employmentStartDate ? new Date(data.profile.employmentStartDate).toLocaleDateString() : 'Not configured'}</Text>
      <Text style={styles.label}>School / study</Text><Text style={styles.readonly}>{data.profile?.school ? `${data.profile.school.name} · ${data.profile.school.address}` : 'Not configured / not applicable'}</Text>
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '800', marginTop: 4 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12, color: colors.ink, backgroundColor: '#FBFCFD' },
  readonly: { color: colors.muted, minHeight: 34, paddingVertical: 7 },
  message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: 12, borderRadius: 12, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  mode: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  modeActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  modeText: { color: colors.ink, fontWeight: '800' },
  modeTextActive: { color: colors.primaryDark },
});
