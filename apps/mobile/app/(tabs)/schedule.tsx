import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalDate, formatOperationalTime, operationalDateKey } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

function visitMinutes(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export default function ScheduleScreen() {
  const { session } = useAuth();
  const { visits, loading, offline } = useVisits();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const groups = visits.reduce<Record<string, typeof visits>>((result, visit) => {
    const visitZone = visit.timezone ?? timezone;
    const key = operationalDateKey(visit.scheduledStart, visitZone);
    (result[key] ??= []).push(visit);
    return result;
  }, {});
  const totalMinutes = visits.reduce((sum, visit) => sum + visitMinutes(visit.scheduledStart, visit.scheduledEnd), 0);

  return <Screen><PageHeader eyebrow={offline ? 'Saved schedule' : 'Live schedule'} title="My schedule" subtitle={`${formatMinutes(totalMinutes)} planned across the next 14 days. Open any visit for details.`} />
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : Object.entries(groups).length ? Object.entries(groups).map(([dayKey, dayVisits]) => {
      const plannedMinutes = dayVisits.reduce((sum, visit) => sum + visitMinutes(visit.scheduledStart, visit.scheduledEnd), 0);
      return <View key={dayKey} style={styles.group}>
        <View style={styles.dayHead}>
          <Text style={styles.day}>{formatOperationalDate(dayVisits[0].scheduledStart, dayVisits[0].timezone ?? timezone, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
          <View style={styles.dayLoad}><Text style={styles.dayLoadValue}>{formatMinutes(plannedMinutes)}</Text><Text style={styles.dayLoadLabel}>{dayVisits.length} visit{dayVisits.length === 1 ? '' : 's'}</Text></View>
        </View>
        {dayVisits.map((visit) => <Pressable key={visit.id} onPress={() => router.push(`/visit/${visit.id}`)}><Card style={styles.visit}>
          <View style={styles.time}><Text style={styles.timeMain}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}</Text><Text style={styles.timeEnd}>{formatOperationalTime(visit.scheduledEnd, visit.timezone ?? timezone)}</Text><Text style={styles.duration}>{formatMinutes(visitMinutes(visit.scheduledStart, visit.scheduledEnd))}</Text></View>
          <View style={styles.body}><Text style={styles.client}>{visit.site.client.displayName}</Text><Text style={styles.name}>{visit.job?.name ?? visit.site.name}</Text><Text style={styles.address}>{visit.site.addressLine1}, {visit.site.city}</Text></View><Text style={styles.arrow}>›</Text>
        </Card></Pressable>)}
      </View>;
    }) : <EmptyState title="Schedule is clear" body="Assigned visits will be available here and cached for offline use." />}
  </Screen>;
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  day: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '900', textTransform: 'capitalize' },
  dayLoad: { alignItems: 'flex-end' },
  dayLoadValue: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  dayLoadLabel: { color: colors.muted, fontSize: 10, marginTop: 1 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { width: 58, gap: 2 },
  timeMain: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  timeEnd: { color: colors.muted, fontSize: 11 },
  duration: { color: colors.ink, fontSize: 9, fontWeight: '800', marginTop: 2 },
  body: { flex: 1, gap: 3 },
  client: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  address: { color: colors.muted, fontSize: 11 },
  arrow: { color: colors.primary, fontSize: 28, fontWeight: '600' },
});
