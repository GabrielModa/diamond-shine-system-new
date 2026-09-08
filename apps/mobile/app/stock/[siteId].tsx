import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cachedStock, cacheStock, enqueue, mutationId } from '@/lib/offline';
import { colors } from '@/lib/theme';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type StockItem = { id: string; name: string; category: string; unit: string; onHand: number; parLevel: number; reorderPoint: number; state: string };
type CatalogItem = { id: string; name: string; category: string; unit: string };
type Priority = 'urgent' | 'normal' | 'low';

export default function StockScreen() {
  const { siteId, visitId, mode } = useLocalSearchParams<{ siteId: string; visitId?: string; mode?: string }>();
  const { session } = useAuth();
  const canCount = session?.membershipRole === 'organization_admin' || session?.membershipRole === 'field_supervisor' || session?.membershipRole === 'stock_controller';
  const requestMode = mode === 'request' || !canCount;

  const [stock, setStock] = useState<StockItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [requestQuantities, setRequestQuantities] = useState<Record<string, number>>({});
  const [priority, setPriority] = useState<Priority>('normal');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session || !siteId) return;
    setLoading(true);
    setError('');
    try {
      if (requestMode) {
        setCatalog(await apiFetch<CatalogItem[]>(session, '/api/materials/catalog'));
      } else {
        const data = await apiFetch<StockItem[]>(session, `/api/sites/${siteId}/stock`);
        setStock(data);
        await cacheStock(siteId, data);
        setCounts(Object.fromEntries(data.map((item) => [item.id, String(item.onHand)])));
      }
    } catch {
      if (requestMode) {
        setError('Reconnect to load the material list and send a request.');
      } else {
        const saved = await cachedStock<StockItem>(siteId);
        setStock(saved);
        setCounts(Object.fromEntries(saved.map((item) => [item.id, String(item.onHand)])));
        setMessage(saved.length ? 'Showing the last downloaded count. Changes can be saved offline.' : 'Reconnect once to download this site’s material list.');
      }
    } finally {
      setLoading(false);
    }
  }, [requestMode, session, siteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const selectedRequestItems = useMemo(
    () => Object.entries(requestQuantities).filter(([, quantity]) => quantity > 0),
    [requestQuantities],
  );
  const shortages = useMemo(() => stock.filter((item) => Number(counts[item.id] ?? item.onHand) <= item.reorderPoint).length, [counts, stock]);
  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, CatalogItem[]>();
    for (const item of catalog) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    return [...groups.entries()];
  }, [catalog]);

  async function submitRequest() {
    if (!session || !siteId || !selectedRequestItems.length) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!(await NetInfo.fetch()).isConnected) throw new Error('Reconnect briefly to send this material request.');
      await apiFetch(session, '/api/supplies', {
        method: 'POST',
        body: JSON.stringify({
          siteId,
          visitId: visitId || undefined,
          priority,
          notes: note.trim() || undefined,
          items: selectedRequestItems.map(([catalogItemId, quantity]) => ({ catalogItemId, quantity })),
        }),
      });
      setRequestQuantities({});
      setNote('');
      setPriority('normal');
      setMessage('Material request sent to Operations.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the material request.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCount() {
    if (!session || !siteId || !canCount) return;
    setBusy(true);
    setError('');
    setMessage('');
    const lines = stock.map((item) => ({ catalogItemId: item.id, quantity: Math.max(0, Number(counts[item.id] ?? 0)) }));
    const payload = { visitId: visitId || null, source: visitId ? 'visit' : 'adjustment', note: note.trim() || undefined, lines };
    const saveOffline = async () => {
      const clientMutationId = mutationId('stock-count');
      await enqueue({ clientMutationId, type: 'material.stock.count', entityId: siteId, clientCreatedAt: new Date().toISOString(), payload });
      const updated = stock.map((item) => ({ ...item, onHand: Math.max(0, Number(counts[item.id] ?? 0)) }));
      await cacheStock(siteId, updated);
      setStock(updated);
      setMessage('Count saved offline. Replenishment will be evaluated after sync.');
    };
    try {
      if (!(await NetInfo.fetch()).isConnected) await saveOffline();
      else {
        try {
          const data = await apiFetch<{ replenishment?: { id: string; priority: string; items: unknown[] } | null }>(session, `/api/sites/${siteId}/stock-counts`, { method: 'POST', body: JSON.stringify(payload) });
          setMessage(data.replenishment ? `Count saved. A ${data.replenishment.priority} replenishment request was created.` : 'Count saved. No new request was needed.');
          setNote('');
          await load();
        } catch (cause) {
          if (!isNetworkApiError(cause)) throw cause;
          await saveOffline();
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the count.');
    } finally {
      setBusy(false);
    }
  }

  if (requestMode) {
    return <Screen>
      <PageHeader eyebrow="Materials" title="Request supplies" subtitle="Ask for what you need at this site. Operations receives one tracked request instead of a chat message." />
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Card style={styles.requestIntro}>
        <Text style={styles.requestIntroTitle}>What do you need?</Text>
        <Text style={styles.requestIntroCopy}>Choose the material and quantity. Stock counts stay with supervisors; cleaners only request what is needed.</Text>
      </Card>
      <View style={styles.priorityRow}>
        {(['urgent', 'normal', 'low'] as const).map((value) => <Pressable key={value} accessibilityRole="button" onPress={() => setPriority(value)} style={[styles.priorityChoice, priority === value && styles.priorityChoiceActive]}>
          <Text style={[styles.priorityText, priority === value && styles.priorityTextActive]}>{value === 'urgent' ? 'Urgent' : value === 'normal' ? 'Normal' : 'Low'}</Text>
        </Pressable>)}
      </View>
      {loading ? <ActivityIndicator color={colors.primary} size="large" /> : groupedCatalog.map(([category, items]) => <View key={category} style={styles.group}>
        <Text style={styles.groupTitle}>{category}</Text>
        {items.map((item) => {
          const quantity = requestQuantities[item.id] ?? 0;
          return <Card key={item.id} style={[styles.requestItem, quantity > 0 && styles.requestItemSelected]}>
            <View style={styles.itemBody}><Text style={styles.name}>{item.name}</Text><Text style={styles.target}>{item.unit}</Text></View>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" onPress={() => setRequestQuantities((current) => ({ ...current, [item.id]: Math.max(0, quantity - 1) }))} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable>
              <Text style={styles.stepValue}>{quantity}</Text>
              <Pressable accessibilityRole="button" onPress={() => setRequestQuantities((current) => ({ ...current, [item.id]: Math.min(999, quantity + 1) }))} style={styles.stepButton}><Text style={styles.stepText}>+</Text></Pressable>
            </View>
          </Card>;
        })}
      </View>)}
      <TextInput value={note} onChangeText={setNote} maxLength={500} multiline style={[styles.textInput, styles.note]} placeholder="Reason or delivery note (optional)" />
      <Button title={selectedRequestItems.length ? `Request ${selectedRequestItems.length} material${selectedRequestItems.length === 1 ? '' : 's'}` : 'Select materials'} loading={busy} disabled={loading || !selectedRequestItems.length} onPress={() => void submitRequest()} />
    </Screen>;
  }

  return <Screen>
    <PageHeader eyebrow="Supervisor materials" title="Count site stock" subtitle="Record what is actually on site. Shortages can create replenishment automatically." />
    {shortages ? <View style={styles.alert}><Text style={styles.alertTitle}>{shortages} item{shortages === 1 ? '' : 's'} at or below reorder point</Text><Text style={styles.alertBody}>Saving this count evaluates shortages without creating duplicate requests.</Text></View> : null}
    {message ? <Text style={styles.success}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : stock.map((item) => {
      const quantity = Number(counts[item.id] ?? item.onHand);
      const state = quantity <= 0 ? 'Out' : quantity <= item.reorderPoint ? 'Low' : 'Healthy';
      return <Card key={item.id} style={styles.item}><View style={styles.itemBody}><Text style={styles.category}>{item.category}</Text><Text style={styles.name}>{item.name}</Text><Text style={styles.target}>Target {item.parLevel} {item.unit} · reorder at {item.reorderPoint}</Text></View><View style={styles.count}><TextInput accessibilityLabel={`${item.name} quantity`} keyboardType="number-pad" value={counts[item.id] ?? ''} onChangeText={(value) => setCounts((current) => ({ ...current, [item.id]: value.replace(/[^0-9]/g, '') }))} style={styles.countInput} /><Text style={[styles.state, state === 'Out' && styles.out, state === 'Low' && styles.low]}>{state}</Text></View></Card>;
    })}
    <TextInput value={note} onChangeText={setNote} maxLength={1000} multiline style={[styles.textInput, styles.note]} placeholder="Count note (optional)" />
    <Button title="Save count & evaluate shortages" loading={busy} disabled={loading || !stock.length || !canCount} onPress={() => void submitCount()} />
  </Screen>;
}

const styles = StyleSheet.create({
  alert: { padding: 14, gap: 5, borderRadius: 14, borderWidth: 1, borderColor: '#F3C98B', backgroundColor: '#FFF5E8' },
  alertTitle: { color: colors.warning, fontSize: 15, fontWeight: '900' },
  alertBody: { color: colors.ink, fontSize: 12, lineHeight: 17 },
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft },
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '800', backgroundColor: '#FDECEA' },
  requestIntro: { gap: 5, borderColor: '#BFD9CE', backgroundColor: '#F7FCF9' },
  requestIntroTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  requestIntroCopy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  priorityChoiceActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  priorityText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  priorityTextActive: { color: colors.primaryDark },
  group: { gap: 8 },
  groupTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  requestItem: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  requestItemSelected: { borderColor: '#8DCDB5', backgroundColor: '#FBFEFC' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemBody: { flex: 1, gap: 3 },
  category: { color: colors.accent, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  name: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  target: { color: colors.muted, fontSize: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepButton: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  stepText: { color: colors.primaryDark, fontSize: 22, lineHeight: 24, fontWeight: '800' },
  stepValue: { minWidth: 26, textAlign: 'center', color: colors.ink, fontSize: 17, fontWeight: '900' },
  count: { alignItems: 'center', gap: 4 },
  countInput: { width: 64, height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 11, textAlign: 'center', color: colors.ink, fontSize: 18, fontWeight: '900', backgroundColor: '#FBFCFD' },
  state: { color: colors.success, fontSize: 9, fontWeight: '900' },
  low: { color: colors.warning },
  out: { color: colors.danger },
  textInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, backgroundColor: colors.surface },
  note: { minHeight: 88, textAlignVertical: 'top' },
});
