import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { pendingCount } from '@/lib/offline';
import { colors } from '@/lib/theme';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function MoreScreen() {
  const { session, signOut } = useAuth(); const [queued, setQueued] = useState(0); const [deviceId, setDeviceId] = useState('');
  const refresh = useCallback(async () => { setQueued(await pendingCount()); setDeviceId(await getDeviceId()); }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <Screen><PageHeader eyebrow="Account & field settings" title="More" subtitle="Your notices, device readiness and privacy information in one place." />
    <Card><Text style={styles.name}>{session?.name ?? 'Field team member'}</Text><Text style={styles.detail}>{session?.email}</Text><Text style={styles.role}>{session?.role ?? 'employee'}</Text></Card>
    <View style={styles.group}><Text style={styles.groupTitle}>Work updates</Text><Pressable style={styles.row} onPress={() => router.push('/inbox')} accessibilityRole="button"><View><Text style={styles.rowTitle}>Operational inbox</Text><Text style={styles.rowCopy}>Schedule changes, instructions and acknowledgements</Text></View><Text style={styles.arrow}>›</Text></Pressable></View>
    <View style={styles.group}><Text style={styles.groupTitle}>Schedule</Text><Pressable style={styles.row} onPress={() => router.push('/availability')} accessibilityRole="button"><View><Text style={styles.rowTitle}>My availability</Text><Text style={styles.rowCopy}>Tell operations when you cannot work so visits are not assigned by mistake.</Text></View><Text style={styles.arrow}>›</Text></Pressable></View>
    <View style={styles.group}><Text style={styles.groupTitle}>Device & sync</Text><Card><View style={styles.infoRow}><View><Text style={styles.rowTitle}>Saved changes</Text><Text style={styles.rowCopy}>{queued ? `${queued} change${queued === 1 ? '' : 's'} waiting to sync` : 'Everything is safely synchronized'}</Text></View><Text style={[styles.state, queued > 0 && styles.statePending]}>{queued ? 'Pending' : 'Ready'}</Text></View><Text style={styles.device}>Device ID: {deviceId ? `${deviceId.slice(0, 8)}…` : 'loading…'}</Text></Card></View>
    <View style={styles.group}><Text style={styles.groupTitle}>Privacy</Text><Pressable style={styles.row} onPress={() => router.push('/time-records')} accessibilityRole="button"><View><Text style={styles.rowTitle}>Location & time records</Text><Text style={styles.rowCopy}>See event-based location records and question an incorrect entry without leaving the app.</Text></View><Text style={styles.arrow}>›</Text></Pressable></View>
    <Button title="Sign out from this device" variant="secondary" onPress={() => void signOut()} />
  </Screen>;
}
const styles = StyleSheet.create({ name: { color: colors.ink, fontSize: 20, fontWeight: '900' }, detail: { color: colors.muted, fontSize: 13 }, role: { alignSelf: 'flex-start', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }, group: { gap: 8 }, groupTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, row: { minHeight: 76, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 17, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface }, rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' }, rowCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 }, arrow: { color: colors.primary, fontSize: 28 }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, state: { alignSelf: 'flex-start', color: colors.success, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, fontSize: 10, fontWeight: '900' }, statePending: { color: colors.warning, backgroundColor: '#FFF4DF' }, device: { color: colors.muted, fontSize: 10, marginTop: 4 }, });
