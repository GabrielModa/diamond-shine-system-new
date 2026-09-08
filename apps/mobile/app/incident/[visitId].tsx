import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { enqueue, mutationId } from '@/lib/offline';
import { colors } from '@/lib/theme';
import type { Visit } from '@/lib/types';
import { useVisits } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import NetInfo from '@react-native-community/netinfo';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const CATEGORIES = [
  { value: 'access', label: 'Access', icon: 'key-outline' },
  { value: 'safety', label: 'Safety', icon: 'warning-outline' },
  { value: 'damage', label: 'Damage', icon: 'construct-outline' },
  { value: 'equipment', label: 'Equipment', icon: 'build-outline' },
  { value: 'materials', label: 'Materials', icon: 'cube-outline' },
  { value: 'client', label: 'Client', icon: 'people-outline' },
  { value: 'security', label: 'Security', icon: 'shield-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
] as const;

type Category = typeof CATEGORIES[number]['value'];
type Severity = 'medium' | 'high' | 'critical';
type CreatedIncident = { id: string; category: string; severity: string; title: string };

function evidencePhase(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const phase = (metadata as Record<string, unknown>).phase;
  return typeof phase === 'string' ? phase : null;
}

export default function IncidentScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { session } = useAuth();
  const { visits } = useVisits();
  const visit = visits.find((item) => item.id === visitId);
  const [category, setCategory] = useState<Category>('other');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<CreatedIncident | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offlineSaved, setOfflineSaved] = useState(false);

  const refreshEvidence = useCallback(async () => {
    if (!session || !visitId || !created) return;
    try {
      const remote = await apiFetch<Visit>(session, `/api/visits/${visitId}`);
      setPhotoCount((remote.evidenceAssets ?? []).filter((asset) => evidencePhase(asset.metadata) === `incident:${created.id}`).length);
    } catch {
      // The issue is already saved. Evidence count is a convenience and must
      // never turn a successful report into an error state.
    }
  }, [created, session, visitId]);
  useFocusEffect(useCallback(() => { void refreshEvidence(); }, [refreshEvidence]));

  const selectedLabel = useMemo(() => CATEGORIES.find((item) => item.value === category)?.label ?? 'Other', [category]);

  async function submit() {
    if (!session || !visitId || !description.trim()) return;
    setBusy(true);
    setError('');
    const payload = {
      category,
      severity,
      title: `${selectedLabel} issue`,
      description: description.trim(),
    };
    try {
      if (!(await NetInfo.fetch()).isConnected) {
        await enqueue({
          clientMutationId: mutationId('incident'),
          type: 'visit.incident.create',
          entityId: visitId,
          clientCreatedAt: new Date().toISOString(),
          payload,
        });
        setOfflineSaved(true);
        return;
      }
      try {
        const incident = await apiFetch<CreatedIncident>(session, `/api/visits/${visitId}/incidents`, { method: 'POST', body: JSON.stringify(payload) });
        setCreated(incident);
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await enqueue({
          clientMutationId: mutationId('incident'),
          type: 'visit.incident.create',
          entityId: visitId,
          clientCreatedAt: new Date().toISOString(),
          payload,
        });
        setOfflineSaved(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not report this issue.');
    } finally {
      setBusy(false);
    }
  }

  if (created || offlineSaved) {
    return <Screen>
      <PageHeader eyebrow="Field issue" title="Issue reported" subtitle={offlineSaved ? 'Saved safely on this phone. It will be sent when the device reconnects.' : 'Operations can now see this issue against the visit.'} />
      <Card style={styles.successCard}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={24} color="#fff" /></View>
        <View style={styles.successCopy}><Text style={styles.successTitle}>{selectedLabel}</Text><Text style={styles.successText}>{description.trim()}</Text></View>
      </Card>
      {!offlineSaved && created ? <Card style={styles.photoCard}>
        <View style={styles.photoHead}>
          <View style={styles.photoIcon}><Ionicons name="camera-outline" size={21} color={colors.primary} /></View>
          <View style={styles.photoCopy}><Text style={styles.photoTitle}>Photos are optional</Text><Text style={styles.photoText}>Add one or several only when a picture helps Operations understand the issue.</Text></View>
        </View>
        {photoCount ? <Text style={styles.photoCount}>{photoCount} photo{photoCount === 1 ? '' : 's'} attached</Text> : null}
        <Button title={photoCount ? 'Add another photo' : 'Add photo'} variant="secondary" onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId, phase: `incident:${created.id}` } })} />
      </Card> : null}
      <Button title="Done" onPress={() => router.back()} />
    </Screen>;
  }

  return <Screen>
    <PageHeader eyebrow="Field issue" title="Report an issue" subtitle={visit ? `${visit.site.client.displayName} · ${visit.site.name}` : 'Tell Operations what happened at this visit.'} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    <View style={styles.sectionCopy}><Text style={styles.sectionTitle}>What happened?</Text><Text style={styles.sectionSub}>Pick the closest type. Keep the description practical — what is wrong and what is needed.</Text></View>
    <View style={styles.categories}>
      {CATEGORIES.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: category === item.value }} onPress={() => setCategory(item.value)} style={[styles.category, category === item.value && styles.categorySelected]}>
        <Ionicons name={item.icon} size={18} color={category === item.value ? colors.primaryDark : colors.muted} />
        <Text style={[styles.categoryText, category === item.value && styles.categoryTextSelected]}>{item.label}</Text>
      </Pressable>)}
    </View>

    <TextInput
      value={description}
      onChangeText={setDescription}
      maxLength={6000}
      multiline
      textAlignVertical="top"
      style={styles.description}
      placeholder="Example: Main entrance key is not opening the second lock. Please contact the site manager before the next visit."
      returnKeyType="default"
    />

    <View style={styles.sectionCopy}><Text style={styles.sectionTitle}>How urgent is it?</Text><Text style={styles.sectionSub}>Use Critical only for an immediate safety or security risk.</Text></View>
    <View style={styles.priority}>
      {([
        ['medium', 'Normal'],
        ['high', 'High'],
        ['critical', 'Critical'],
      ] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: severity === value }} onPress={() => setSeverity(value)} style={[styles.priorityChoice, severity === value && styles.prioritySelected, value === 'critical' && severity === value && styles.criticalSelected]}><Text style={[styles.priorityText, severity === value && styles.priorityTextSelected]}>{label}</Text></Pressable>)}
    </View>

    <Card style={styles.photoHint}><Ionicons name="camera-outline" size={20} color={colors.primary} /><View style={styles.photoHintCopy}><Text style={styles.photoHintTitle}>Photo optional</Text><Text style={styles.photoHintText}>After sending the issue you can add one or multiple photos.</Text></View></Card>

    <Button title="Send to Operations" loading={busy} disabled={!description.trim()} onPress={() => void submit()} />
  </Screen>;
}

const styles = StyleSheet.create({
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '800', backgroundColor: '#FDECEA' },
  sectionCopy: { gap: 3 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { width: '31%', minWidth: 92, minHeight: 58, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface },
  categorySelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  categoryText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  categoryTextSelected: { color: colors.primaryDark },
  description: { minHeight: 150, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, color: colors.ink, backgroundColor: colors.surface, fontSize: 14, lineHeight: 20 },
  priority: { flexDirection: 'row', gap: 8 },
  priorityChoice: { flex: 1, minHeight: 45, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  prioritySelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  criticalSelected: { borderColor: '#E39A86', backgroundColor: '#FFF2EF' },
  priorityText: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  priorityTextSelected: { color: colors.ink },
  photoHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F8FAFC' },
  photoHintCopy: { flex: 1 },
  photoHintTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  photoHintText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  successCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderColor: '#A9DEC3', backgroundColor: '#F4FCF7' },
  successIcon: { width: 42, height: 42, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  successCopy: { flex: 1 },
  successTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  successText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  photoCard: { gap: 12 },
  photoHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  photoIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  photoCopy: { flex: 1 },
  photoTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  photoText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 2 },
  photoCount: { color: colors.success, fontSize: 11, fontWeight: '900' },
});
