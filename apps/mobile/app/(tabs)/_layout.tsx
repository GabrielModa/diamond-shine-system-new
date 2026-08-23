import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function TabLayout() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <View style={styles.shell}><Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { height: 72, paddingTop: 8, paddingBottom: 9, borderTopColor: colors.border, backgroundColor: colors.surface },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} /> }} />
      <Tabs.Screen name="work" options={{ title: 'Work', tabBarIcon: ({ color, size }) => <Ionicons name="briefcase" color={color} size={size} /> }} />
      <Tabs.Screen name="timesheet" options={{ title: 'Time', tabBarIcon: ({ color, size }) => <Ionicons name="time" color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" color={color} size={size} /> }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
    </Tabs><ActiveVisitBar /></View>
  );
}

function ActiveVisitBar() {
  const { visits } = useVisits();
  const active = visits.find((visit) => visit.status === 'in_progress');
  if (!active) return null;
  const title = active.job?.name ?? active.site.name;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Return to active visit for ${active.site.client.displayName}`} onPress={() => router.push(`/visit/${active.id}`)} style={styles.activeBar}><View style={styles.activeIcon}><Ionicons name="play" size={14} color="#fff" /></View><View style={styles.activeCopy}><Text style={styles.activeLabel}>VISIT IN PROGRESS</Text><Text style={styles.activeTitle} numberOfLines={1}>{active.site.client.displayName} · {title}</Text></View><Text style={styles.activeAction}>Open ›</Text></Pressable>;
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  activeBar: { position: 'absolute', left: 12, right: 12, bottom: 82, minHeight: 56, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', gap: 9, borderRadius: 15, backgroundColor: colors.ink, shadowColor: '#061B24', shadowOpacity: 0.23, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  activeIcon: { width: 29, height: 29, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  activeCopy: { flex: 1, gap: 1 }, activeLabel: { color: '#A7C7B8', fontSize: 9, fontWeight: '900', letterSpacing: .7 }, activeTitle: { color: '#fff', fontSize: 12, fontWeight: '800' }, activeAction: { color: '#9BE5C1', fontSize: 12, fontWeight: '900' },
});
