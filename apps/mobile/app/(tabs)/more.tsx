import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { pendingCount, pendingIssueCount } from '@/lib/offline';
import { isExpoGo, supportsNativePush } from '@/lib/runtime';
import { colors } from '@/lib/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function MoreScreen() {
  const { session, signOut, biometricAvailable, biometricAccount, disableBiometricSignIn } = useAuth();
  const [queued, setQueued] = useState(0);
  const [issues, setIssues] = useState(0);
  const [deviceId, setDeviceId] = useState('');
  const [removingBiometric, setRemovingBiometric] = useState(false);
  const canOpenOperations = session?.membershipRole === 'organization_admin' || session?.membershipRole === 'field_supervisor' || session?.membershipRole === 'scheduler';
  const refresh = useCallback(async () => {
    setQueued(await pendingCount()); setIssues(await pendingIssueCount()); setDeviceId(await getDeviceId());
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function removeBiometric() {
    if (removingBiometric) return;
    setRemovingBiometric(true);
    try {
      await disableBiometricSignIn();
    } finally {
      setRemovingBiometric(false);
    }
  }

  return <Screen><PageHeader eyebrow="Account & field settings" title="More" subtitle="Your notices, device readiness and privacy information in one place." />
    <Card><Text style={styles.name}>{session?.name ?? 'Field team member'}</Text><Text style={styles.detail}>{session?.email}</Text><Text style={styles.role}>{session?.membershipRole?.replaceAll('_', ' ') ?? session?.role ?? 'employee'}</Text><Text style={styles.detail}>Operational timezone: {session?.timezone ?? 'Europe/Dublin'}</Text></Card>
    {canOpenOperations ? <View style={styles.group}><Text style={styles.groupTitle}>Management</Text><Pressable style={styles.row} onPress={() => router.push('../operations')} accessibilityRole="button"><View style={styles.rowBody}><Text style={styles.rowTitle}>Operations today</Text><Text style={styles.rowCopy}>Coverage, missing recurrence, pauses and acknowledgements from the shared schedule-health engine.</Text></View><Text style={styles.arrow}>›</Text></Pressable></View> : null}
    <View style={styles.group}><Text style={styles.groupTitle}>Work updates</Text><Pressable style={styles.row} onPress={() => router.push('/inbox')} accessibilityRole="button"><View style={styles.rowBody}><Text style={styles.rowTitle}>Operational inbox</Text><Text style={styles.rowCopy}>Schedule changes, instructions and acknowledgements</Text></View><Text style={styles.arrow}>›</Text></Pressable></View>
    <View style={styles.group}><Text style={styles.groupTitle}>My details</Text><Pressable style={styles.row} onPress={() => router.push('/profile' as never)} accessibilityRole="button"><View style={styles.rowBody}><Text style={styles.rowTitle}>My profile</Text><Text style={styles.rowCopy}>Phone, mapped home/school locations, travel and weekly availability.</Text></View><Text style={styles.arrow}>›</Text></Pressable></View>

    <View style={styles.group}><Text style={styles.groupTitle}>Security</Text><Card>
      <View style={styles.securityHead}><View style={styles.securityIcon}><Ionicons name="finger-print-outline" size={23} color={colors.primary} /></View><View style={styles.infoCopy}><Text style={styles.rowTitle}>Fingerprint sign-in</Text><Text style={styles.rowCopy}>{biometricAccount ? `Enabled for ${biometricAccount.email}` : biometricAvailable ? 'Available on this phone' : 'No enrolled biometric is available on this device'}</Text></View><Text style={[styles.state, !biometricAccount && styles.stateNeutral]}>{biometricAccount ? 'On' : 'Off'}</Text></View>
      {biometricAccount ? <><Text style={styles.securityHelp}>You can sign out normally and still use your fingerprint or Face ID to sign in again. Remove it here to require the password next time.</Text><Button title="Remove fingerprint sign-in" variant="secondary" compact loading={removingBiometric} onPress={() => void removeBiometric()} /></> : <Text style={styles.securityHelp}>{biometricAvailable ? 'To enable it, select “Use fingerprint next time” the next time you sign in with your password.' : 'Set up fingerprint or Face ID in your phone settings first, then reopen Diamond Shine.'}</Text>}
    </Card></View>

    <View style={styles.group}><Text style={styles.groupTitle}>Device & sync</Text><Card><View style={styles.infoRow}><View style={styles.infoCopy}><Text style={styles.rowTitle}>Saved changes</Text><Text style={styles.rowCopy}>{issues ? `${issues} change${issues === 1 ? '' : 's'} need attention` : queued ? `${queued} change${queued === 1 ? '' : 's'} waiting to sync` : 'Everything is safely synchronized'}</Text></View><Text style={[styles.state, queued > 0 && styles.statePending, issues > 0 && styles.stateIssue]}>{issues ? 'Review' : queued ? 'Pending' : 'Ready'}</Text></View><Text style={styles.device}>Device ID: {deviceId ? `${deviceId.slice(0, 8)}…` : 'loading…'}</Text><Text style={styles.device}>{isExpoGo ? 'Expo Go test mode · remote push intentionally disabled' : supportsNativePush ? 'Native build · remote push available when configured' : 'Push unavailable in this runtime'}</Text></Card></View>
    <View style={styles.group}><Text style={styles.groupTitle}>Privacy</Text><Pressable style={styles.row} onPress={() => router.push('/time-records')} accessibilityRole="button"><View style={styles.rowBody}><Text style={styles.rowTitle}>Location & time records</Text><Text style={styles.rowCopy}>See event-based location records and question an incorrect entry without leaving the app.</Text></View><Text style={styles.arrow}>›</Text></Pressable></View>
    <Button title="About / Diagnostics" variant="secondary" onPress={() => router.push('/diagnostics' as never)} />
    {biometricAccount ? <Text style={styles.signOutHint}>Fingerprint sign-in will remain available on this phone after sign-out.</Text> : null}
    <Button title="Sign out from this device" variant="secondary" onPress={() => void signOut()} />
  </Screen>;
}
const styles = StyleSheet.create({ name: { color: colors.ink, fontSize: 20, fontWeight: '900' }, detail: { color: colors.muted, fontSize: 13 }, role: { alignSelf: 'flex-start', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }, group: { gap: 8 }, groupTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, row: { minHeight: 76, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderRadius: 17, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface }, rowBody: { flex: 1 }, rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' }, rowCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 }, arrow: { color: colors.primary, fontSize: 28 }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, infoCopy: { flex: 1 }, state: { alignSelf: 'flex-start', color: colors.success, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, fontSize: 10, fontWeight: '900' }, stateNeutral: { color: colors.muted, backgroundColor: '#EEF2F5' }, statePending: { color: colors.warning, backgroundColor: '#FFF4DF' }, stateIssue: { color: colors.danger, backgroundColor: '#FDECEA' }, device: { color: colors.muted, fontSize: 10, marginTop: 4 }, securityHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, securityIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, securityHelp: { color: colors.muted, fontSize: 11, lineHeight: 17 }, signOutHint: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' } });
