import { useAuth } from '@/lib/auth-context';
import { colors, shadow } from '@/lib/theme';
import { useVisits, VisitsProvider } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const { session, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  if (!loading && !session) return <Redirect href="/login" />;

  const tabBarBase = fontScale >= 1.3 ? 72 : fontScale >= 1.15 ? 67 : 62;
  const tabBarHeight = tabBarBase + insets.bottom;
  return (
    <VisitsProvider>
      <View style={styles.shell}><Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarHideOnKeyboard: true,
          lazy: true,
          freezeOnBlur: true,
          tabBarStyle: {
            height: tabBarHeight,
            paddingTop: 8,
            paddingBottom: Math.max(8, insets.bottom),
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          },
          tabBarItemStyle: { minHeight: 48 },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
          headerShown: false,
        }}>
        <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }} />
        <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} /> }} />
        <Tabs.Screen name="timesheet" options={{ title: 'Time', tabBarIcon: ({ color, size }) => <Ionicons name="time" color={color} size={size} /> }} />
        <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" color={color} size={size} /> }} />
        <Tabs.Screen name="work" options={{ href: null }} />
        <Tabs.Screen name="inbox" options={{ href: null }} />
      </Tabs><ActiveVisitBar bottom={tabBarHeight + 10} /></View>
    </VisitsProvider>
  );
}

function ActiveVisitBar({ bottom }: { bottom: number }) {
  const { session } = useAuth();
  const { visits } = useVisits();
  const email = session?.email.toLowerCase();
  const active = visits.find((visit) => (visit.timeEntries ?? []).some((entry) => (
    entry.kind === 'visit'
    && entry.status === 'running'
    && !entry.endedAt
    && entry.user?.email.toLowerCase() === email
  )));
  if (!active) return null;
  const title = active.job?.name ?? active.site.name;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Return to active visit for ${active.site.client.displayName}`}
    accessibilityHint="Opens the visit currently in progress"
    hitSlop={6}
    onPress={() => router.push(`/visit/${active.id}`)}
    style={({ pressed }) => [styles.activeBar, { bottom }, pressed && styles.activePressed]}
  ><View style={styles.activeIcon}><Ionicons name="play" size={14} color="#fff" /></View><View style={styles.activeCopy}><Text style={styles.activeLabel}>VISIT IN PROGRESS</Text><Text style={styles.activeTitle} numberOfLines={2}>{active.site.client.displayName} · {title}</Text></View><Text style={styles.activeAction}>Open ›</Text></Pressable>;
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  activeBar: { position: 'absolute', left: 12, right: 12, minHeight: 58, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center', flexDirection: 'row', gap: 9, borderRadius: 15, backgroundColor: colors.ink, ...shadow },
  activePressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  activeIcon: { width: 29, height: 29, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  activeCopy: { flex: 1, minWidth: 0, gap: 1 },
  activeLabel: { color: '#A7C7B8', fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: .7 },
  activeTitle: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  activeAction: { color: '#9BE5C1', fontSize: 12, lineHeight: 16, fontWeight: '900' },
});
