import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export default function ScheduleScreen() {
  const { visits, loading, offline } = useVisits();
  const groups = visits.reduce<Record<string, typeof visits>>((result, visit) => { const key = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(visit.scheduledStart)); (result[key] ??= []).push(visit); return result; }, {});
  return <Screen><PageHeader eyebrow={offline ? 'Saved schedule' : 'Live schedule'} title="My schedule" subtitle="The next 14 days, ordered for action." />
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : Object.entries(groups).length ? Object.entries(groups).map(([day, dayVisits]) => <View key={day} style={styles.group}><Text style={styles.day}>{day}</Text>{dayVisits.map((visit) => <Pressable key={visit.id} onPress={() => router.push(`/visit/${visit.id}`)}><Card style={styles.visit}><View style={styles.time}><Text style={styles.timeMain}>{formatTime(visit.scheduledStart)}</Text><Text style={styles.timeEnd}>{formatTime(visit.scheduledEnd)}</Text></View><View style={styles.body}><Text style={styles.client}>{visit.site.client.displayName}</Text><Text style={styles.name}>{visit.job?.name ?? visit.site.name}</Text><Text style={styles.address}>{visit.site.addressLine1}, {visit.site.city}</Text></View><Text style={styles.arrow}>›</Text></Card></Pressable>)}</View>) : <EmptyState title="Schedule is clear" body="Assigned visits will be available here and cached for offline use." />}
  </Screen>;
}
function formatTime(value: string) { return new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
const styles = StyleSheet.create({ group: { gap: 10 }, day: { color: colors.ink, fontSize: 18, fontWeight: '900', textTransform: 'capitalize' }, visit: { flexDirection: 'row', alignItems: 'center', gap: 12 }, time: { width: 54, gap: 2 }, timeMain: { color: colors.primary, fontSize: 15, fontWeight: '900' }, timeEnd: { color: colors.muted, fontSize: 11 }, body: { flex: 1, gap: 3 }, client: { color: colors.ink, fontSize: 16, fontWeight: '900' }, name: { color: colors.ink, fontSize: 13, fontWeight: '600' }, address: { color: colors.muted, fontSize: 11 }, arrow: { color: colors.primary, fontSize: 28, fontWeight: '600' } });
