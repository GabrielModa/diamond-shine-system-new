import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { addOperationalDays, formatOperationalDate, operationalDateKey, operationalDateTimeInput, operationalInputToUtc } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Availability = { id: string; startsAt: string; endsAt: string; reason?: string | null };

export default function AvailabilityScreen() {
  const { session } = useAuth();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const tomorrow = addOperationalDays(operationalDateKey(new Date(), timezone), 1);
  const dayAfter = addOperationalDays(tomorrow, 1);
  const [entries, setEntries] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [startsAt, setStartsAt] = useState(`${tomorrow}T09:00`);
  const [endsAt, setEndsAt] = useState(`${dayAfter}T09:00`);
  const [reason, setReason] = useState('');

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try { setEntries(await apiFetch<Availability[]>(session, '/api/availability')); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load availability.'); }
    finally { setLoading(false); }
  }, [session]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function save() {
    if (!session) return;
    const start = operationalInputToUtc(startsAt, timezone);
    const end = operationalInputToUtc(endsAt, timezone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setMessage('Enter valid local dates in the format YYYY-MM-DDTHH:mm.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      await apiFetch(session, '/api/availability', { method: 'POST', body: JSON.stringify({ startsAt: start.toISOString(), endsAt: end.toISOString(), reason: reason.trim() || null }) });
      setReason(''); setMessage('Operations will avoid assigning visits in this time window.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save availability.'); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    if (!session) return;
    setBusy(true);
    try { await apiFetch(session, `/api/availability/${id}`, { method: 'DELETE' }); setMessage('Availability entry removed.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove availability.'); }
    finally { setBusy(false); }
  }

  function preset(days: number, durationHours: number) {
    const dateKey = addOperationalDays(operationalDateKey(new Date(), timezone), days);
    const startInput = `${dateKey}T09:00`;
    const startUtc = operationalInputToUtc(startInput, timezone);
    const endUtc = new Date(startUtc.getTime() + durationHours * 3_600_000);
    setStartsAt(startInput);
    setEndsAt(operationalDateTimeInput(endUtc, timezone));
  }

  return <Screen><PageHeader eyebrow="Schedule protection" title="My availability" subtitle={`Declare time you cannot work in ${timezone}. This prevents avoidable assignments; it does not alter your past timesheet.`} />
    {message ? <Text style={styles.message}>{message}</Text> : null}
    <Card><Text style={styles.title}>I cannot work</Text><Text style={styles.help}>Start with a quick option, then adjust the organization-local time if needed.</Text><View style={styles.presets}><Pressable style={styles.preset} onPress={() => preset(1, 8)}><Text style={styles.presetText}>Tomorrow · full day</Text></Pressable><Pressable style={styles.preset} onPress={() => preset(1, 4)}><Text style={styles.presetText}>Tomorrow · morning</Text></Pressable><Pressable style={styles.preset} onPress={() => preset(7, 8)}><Text style={styles.presetText}>Next week · full day</Text></Pressable></View><Text style={styles.label}>From</Text><TextInput value={startsAt} onChangeText={setStartsAt} autoCapitalize="none" style={styles.input} placeholder="2026-08-24T08:00" /><Text style={styles.label}>Until</Text><TextInput value={endsAt} onChangeText={setEndsAt} autoCapitalize="none" style={styles.input} placeholder="2026-08-24T17:00" /><Text style={styles.label}>Reason (optional)</Text><TextInput value={reason} onChangeText={setReason} style={[styles.input, styles.reason]} placeholder="Appointment, leave or availability detail" multiline /><Button title="Save unavailability" loading={busy} onPress={() => void save()} /></Card>
    <View style={styles.section}><Text style={styles.title}>Upcoming unavailable time</Text>{loading ? <ActivityIndicator color={colors.primary} /> : entries.length ? entries.map((entry) => <Card key={entry.id}><View style={styles.entryHead}><View style={styles.entryCopy}><Text style={styles.entryTitle}>{formatOperationalDate(entry.startsAt, timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → {formatOperationalDate(entry.endsAt, timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>{entry.reason ? <Text style={styles.help}>{entry.reason}</Text> : null}</View><Pressable accessibilityRole="button" onPress={() => void cancel(entry.id)} disabled={busy}><Text style={styles.remove}>Remove</Text></Pressable></View></Card>) : <EmptyState title="Nothing declared" body="Add time away before the schedule is created or changed." />}</View>
  </Screen>;
}
const styles = StyleSheet.create({ message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: 12, borderRadius: 12, fontWeight: '700' }, section: { gap: 10 }, title: { color: colors.ink, fontSize: 18, fontWeight: '900' }, help: { color: colors.muted, fontSize: 12, lineHeight: 18 }, presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, preset: { minHeight: 38, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#BFE7D0' }, presetText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' }, label: { color: colors.ink, fontSize: 12, fontWeight: '800', marginTop: 3 }, input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12, color: colors.ink, backgroundColor: '#FBFCFD' }, reason: { minHeight: 78, textAlignVertical: 'top', paddingTop: 10 }, entryHead: { flexDirection: 'row', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' }, entryCopy: { flex: 1, gap: 4 }, entryTitle: { color: colors.ink, fontWeight: '800', lineHeight: 20 }, remove: { color: colors.danger, fontWeight: '800', padding: 6 } });
