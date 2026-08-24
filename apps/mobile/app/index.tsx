import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}><ActivityIndicator size="large" color={colors.primary} /></View>;
  return <Redirect href={session ? '/(tabs)' : '/login'} />;
}
