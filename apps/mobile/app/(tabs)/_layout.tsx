import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { height: 72, paddingTop: 8, paddingBottom: 9, borderTopColor: colors.border, backgroundColor: colors.surface },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} /> }} />
      <Tabs.Screen name="timesheet" options={{ title: 'Time', tabBarIcon: ({ color, size }) => <Ionicons name="time" color={color} size={size} /> }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: ({ color, size }) => <Ionicons name="mail" color={color} size={size} /> }} />
    </Tabs>
  );
}
