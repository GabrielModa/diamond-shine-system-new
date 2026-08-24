import { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, shadow } from '@/lib/theme';

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const body = scroll ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[styles.content, styles.flex]}>{children}</View>;
  return <SafeAreaView style={styles.safe}>{body}</SafeAreaView>;
}

export function PageHeader({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  return <View style={styles.header}><View style={styles.headerCopy}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{right}</View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) { return <View style={[styles.card, style]}>{children}</View>; }

export function Button({ title, onPress, variant = 'primary', disabled, loading, compact }: { title: string; onPress(): void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; loading?: boolean; compact?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [styles.button, styles[`button_${variant}`], compact && styles.compact, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>{loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : colors.primary} /> : <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{title}</Text>}</Pressable>;
}

export function EmptyState({ title, body }: { title: string; body: string }) { return <Card style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.subtitle}>{body}</Text></Card>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, flex: { flex: 1 }, content: { padding: 18, paddingBottom: 120, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingTop: 6, marginBottom: 4 }, headerCopy: { flex: 1, gap: 5 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' }, title: { color: colors.ink, fontSize: 29, lineHeight: 34, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, ...shadow },
  button: { minHeight: 48, paddingHorizontal: 18, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' }, compact: { minHeight: 40, paddingHorizontal: 13 },
  button_primary: { backgroundColor: colors.primary }, button_secondary: { backgroundColor: colors.surface, borderColor: colors.primary }, button_danger: { backgroundColor: colors.danger }, button_ghost: { backgroundColor: colors.primarySoft },
  buttonText: { fontSize: 15, fontWeight: '800' }, buttonText_primary: { color: '#fff' }, buttonText_secondary: { color: colors.primary }, buttonText_danger: { color: '#fff' }, buttonText_ghost: { color: colors.primaryDark },
  disabled: { opacity: 0.5 }, pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 }, empty: { alignItems: 'center', paddingVertical: 28 }, emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
});
