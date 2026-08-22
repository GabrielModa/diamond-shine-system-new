import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import { StyleSheet, Text, View } from 'react-native';

export default function TimesheetScreen() {
  const { visits } = useVisits(); const entries = visits.flatMap((visit) => (visit.timeEntries ?? []).map((entry) => ({ ...entry, visit })));
  const total = entries.reduce((sum, entry) => sum + (entry.durationSeconds ?? (entry.endedAt ? (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000 : 0)), 0);
  return <Screen><PageHeader eyebrow="Verified time" title="Timesheet" subtitle="Every visit timer with its location-aware audit trail." />
    <Card style={styles.total}><Text style={styles.totalLabel}>Tracked in this schedule window</Text><Text style={styles.totalValue}>{duration(total)}</Text></Card>
    <Text style={styles.section}>Time log</Text>{entries.length ? entries.map((entry) => <Card key={entry.id} style={styles.entry}><View style={styles.dot} /><View style={styles.body}><Text style={styles.site}>{entry.visit.site.client.displayName}</Text><Text style={styles.meta}>{formatDate(entry.startedAt)} · {formatTime(entry.startedAt)}{entry.endedAt ? `–${formatTime(entry.endedAt)}` : ' · Running'}</Text></View><Text style={styles.duration}>{entry.endedAt ? duration(entry.durationSeconds ?? (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000) : 'Live'}</Text></Card>) : <EmptyState title="No tracked time yet" body="Starting a visit creates a verified entry here." />}
  </Screen>;
}
function duration(seconds: number) { const minutes = Math.round(seconds / 60); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
const styles = StyleSheet.create({ total: { backgroundColor: colors.ink }, totalLabel: { color: '#C9D6E2', fontSize: 12, fontWeight: '700' }, totalValue: { color: '#fff', fontSize: 35, fontWeight: '900' }, section: { color: colors.ink, fontSize: 20, fontWeight: '900' }, entry: { flexDirection: 'row', alignItems: 'center', gap: 11 }, dot: { width: 11, height: 11, borderRadius: 99, backgroundColor: colors.primary }, body: { flex: 1 }, site: { color: colors.ink, fontSize: 15, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 11, marginTop: 3 }, duration: { color: colors.primary, fontSize: 14, fontWeight: '900' } });
