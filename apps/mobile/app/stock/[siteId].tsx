import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cachedStock, cacheStock, enqueue, mutationId } from '@/lib/offline';
import { colors } from '@/lib/theme';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

type StockItem = { id: string; name: string; category: string; unit: string; onHand: number; parLevel: number; reorderPoint: number; state: string };

export default function StockScreen() {
  const { siteId, visitId } = useLocalSearchParams<{ siteId: string; visitId?: string }>();
  const { session } = useAuth();
  const [items, setItems] = useState<StockItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!session || !siteId) return;
    setLoading(true); setError('');
    try {
      const data = await apiFetch<StockItem[]>(session, `/api/sites/${siteId}/stock`);
      setItems(data); await cacheStock(siteId, data); setCounts(Object.fromEntries(data.map((item) => [item.id, String(item.onHand)])));
    } catch {
      const saved = await cachedStock<StockItem>(siteId); setItems(saved); setCounts(Object.fromEntries(saved.map((item) => [item.id, String(item.onHand)])));
      setMessage(saved.length ? 'Showing the last downloaded count. Changes can be saved offline.' : 'Reconnect once to download this site’s material list.');
    } finally { setLoading(false); }
  }, [session, siteId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const shortages = useMemo(() => items.filter((item) => Number(counts[item.id] ?? item.onHand) <= item.reorderPoint).length, [counts, items]);

  async function submit() {
    if (!session || !siteId) return;
    setBusy(true); setError(''); setMessage('');
    const lines = items.map((item) => ({ catalogItemId: item.id, quantity: Math.max(0, Number(counts[item.id] ?? 0)) }));
    const payload = { visitId: visitId || null, source: visitId ? 'visit' : 'adjustment', lines };
    const saveOffline = async () => {
      const clientMutationId = mutationId('stock-count');
      await enqueue({ clientMutationId, type: 'material.stock.count', entityId: siteId, clientCreatedAt: new Date().toISOString(), payload });
      const updated = items.map((item) => ({ ...item, onHand: Math.max(0, Number(counts[item.id] ?? 0)) }));
      await cacheStock(siteId, updated); setItems(updated);
      setMessage('Count saved offline. Replenishment will be calculated automatically after sync.');
    };
    try {
      if (!(await NetInfo.fetch()).isConnected) await saveOffline();
      else {
        try {
          const data = await apiFetch<{ replenishment?: { id: string; priority: string; items: unknown[] } | null }>(session, `/api/sites/${siteId}/stock-counts`, { method: 'POST', body: JSON.stringify(payload) });
          setMessage(data.replenishment ? `Count saved. A ${data.replenishment.priority} replenishment request was created automatically.` : 'Count saved. No new request was needed.');
          await load();
        } catch (cause) {
          if (!isNetworkApiError(cause)) throw cause;
          await saveOffline();
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the count.'); }
    finally { setBusy(false); }
  }

  return <Screen><PageHeader eyebrow="Smart inventory" title="Site materials" subtitle="Count what is really on site. Shortages become actionable requests automatically." />
    {shortages ? <View style={styles.alert}><Text style={styles.alertTitle}>{shortages} item{shortages === 1 ? '' : 's'} at or below reorder point</Text><Text style={styles.alertBody}>Saving this count will create only the replenishment requests that are not already open.</Text></View> : null}
    {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : items.map((item) => { const quantity = Number(counts[item.id] ?? item.onHand); const state = quantity <= 0 ? 'Out' : quantity <= item.reorderPoint ? 'Low' : 'Healthy'; return <Card key={item.id} style={styles.item}><View style={styles.itemBody}><Text style={styles.category}>{item.category}</Text><Text style={styles.name}>{item.name}</Text><Text style={styles.target}>Target {item.parLevel} {item.unit} · reorder at {item.reorderPoint}</Text></View><View style={styles.count}><TextInput accessibilityLabel={`${item.name} quantity`} keyboardType="number-pad" value={counts[item.id] ?? ''} onChangeText={(value) => setCounts((current) => ({ ...current, [item.id]: value.replace(/[^0-9]/g, '') }))} style={styles.input} /><Text style={[styles.state, state === 'Out' && styles.out, state === 'Low' && styles.low]}>{state}</Text></View></Card>; })}
    <Button title="Save count & request shortages" loading={busy} disabled={loading || !items.length} onPress={() => void submit()} />
  </Screen>;
}

const styles = StyleSheet.create({ alert: { padding: 14, gap: 5, borderRadius: 14, borderWidth: 1, borderColor: '#F3C98B', backgroundColor: '#FFF5E8' }, alertTitle: { color: colors.warning, fontSize: 15, fontWeight: '900' }, alertBody: { color: colors.ink, fontSize: 12, lineHeight: 17 }, success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft }, error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '800', backgroundColor: '#FDECEA' }, item: { flexDirection: 'row', alignItems: 'center', gap: 12 }, itemBody: { flex: 1, gap: 3 }, category: { color: colors.accent, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' }, name: { color: colors.ink, fontSize: 16, fontWeight: '800' }, target: { color: colors.muted, fontSize: 10 }, count: { alignItems: 'center', gap: 4 }, input: { width: 64, height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 11, textAlign: 'center', color: colors.ink, fontSize: 18, fontWeight: '900', backgroundColor: '#FBFCFD' }, state: { color: colors.success, fontSize: 9, fontWeight: '900' }, low: { color: colors.warning }, out: { color: colors.danger } });
