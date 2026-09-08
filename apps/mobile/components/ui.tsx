import { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadow } from '@/lib/theme';

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 360 ? 14 : width >= 700 ? 24 : 18;
  const contentStyle = [
    styles.content,
    {
      paddingHorizontal: horizontalPadding,
      paddingBottom: Math.max(28, insets.bottom + 28),
    },
  ];
  const body = scroll
    ? <ScrollView
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === 'android'}
      >{children}</ScrollView>
    : <View style={[contentStyle, styles.flex]}>{children}</View>;
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>{body}</SafeAreaView>;
}

export function PageHeader({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return <View style={styles.header}><View style={styles.headerCopy}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{right ? <View style={styles.headerRight}>{right}</View> : null}</View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) { return <View style={[styles.card, style]}>{children}</View>; }

export function Button({ title, onPress, variant = 'primary', disabled, loading, compact }: { title: string; onPress(): void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; loading?: boolean; compact?: boolean }) {
  const unavailable = Boolean(disabled || loading);
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled: unavailable, busy: Boolean(loading) }}
    onPress={onPress}
    disabled={unavailable}
    style={({ pressed }) => [styles.button, styles[`button_${variant}`], compact && styles.compact, unavailable && styles.disabled, pressed && styles.pressed]}
  >{loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : colors.primary} /> : <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{title}</Text>}</Pressable>;
}

export function EmptyState({ title, body }: { title: string; body: string }) { return <Card style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.subtitle}>{body}</Text></Card>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingTop: 18, gap: 16 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingTop: 6, marginBottom: 4 },
  headerCopy: { flexGrow: 1, flexShrink: 1, minWidth: 220, gap: 5 },
  headerRight: { flexShrink: 0 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 29, lineHeight: 35, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  card: { padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, ...shadow },
  button: { minHeight: 50, minWidth: 44, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  compact: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 8 },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: { backgroundColor: colors.surface, borderColor: colors.primary },
  button_danger: { backgroundColor: colors.danger },
  button_ghost: { backgroundColor: colors.primarySoft },
  buttonText: { fontSize: 15, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  buttonText_primary: { color: '#fff' },
  buttonText_secondary: { color: colors.primary },
  buttonText_danger: { color: '#fff' },
  buttonText_ghost: { color: colors.primaryDark },
  disabled: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: '800', textAlign: 'center' },
});
