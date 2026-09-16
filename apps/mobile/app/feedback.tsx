import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type FeedbackItem = {
  id: string;
  clientLocation: string;
  cleanliness: number;
  punctuality: number;
  equipment: number;
  clientRelations: number;
  overall: number;
  category: string;
  comments: string | null;
  createdAt: string;
};

type FeedbackPage = {
  total: number;
  items: FeedbackItem[];
  metrics: {
    overall: number;
    cleanliness: number;
    punctuality: number;
    equipment: number;
    clientRelations: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    hasMore: boolean;
  };
};

export default function FeedbackScreen() {
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FeedbackPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setMessage('');
    void apiFetch<FeedbackPage>(session, `/api/feedback/me?page=${page}&pageSize=10`)
      .then((next) => { if (active) setData(next); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load your feedback.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, session]);

  return <Screen>
    <PageHeader
      eyebrow="My service feedback"
      title="My feedback"
      subtitle="See ratings and comments recorded about your own work. Only your feedback is shown here."
    />

    {message ? <Card style={styles.errorCard}><Text style={styles.errorText}>{message}</Text></Card> : null}

    {loading && !data ? <ActivityIndicator color={colors.primary} size="large" /> : data ? <>
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}><Ionicons name="star" size={22} color={colors.primary} /></View>
          <View style={styles.heroCopy}><Text style={styles.heroLabel}>AVERAGE RATING</Text><Text style={styles.heroValue}>{data.metrics.overall ? data.metrics.overall.toFixed(1) : '—'}<Text style={styles.heroOutOf}> / 5</Text></Text><Text style={styles.heroSub}>{data.total} evaluation{data.total === 1 ? '' : 's'} recorded</Text></View>
        </View>
        <View style={styles.scoreGrid}>
          <Score label="Cleanliness" value={data.metrics.cleanliness} icon="sparkles-outline" />
          <Score label="Punctuality" value={data.metrics.punctuality} icon="time-outline" />
          <Score label="Equipment" value={data.metrics.equipment} icon="build-outline" />
          <Score label="Client relations" value={data.metrics.clientRelations} icon="people-outline" />
        </View>
      </Card>

      <View style={styles.sectionHead}>
        <View><Text style={styles.sectionTitle}>Recent feedback</Text><Text style={styles.sectionCopy}>Ratings are read-only and stay connected to your work record.</Text></View>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      {data.items.length ? data.items.map((item) => <Card key={item.id} style={styles.feedbackCard}>
        <View style={styles.feedbackHead}>
          <View style={styles.locationIcon}><Ionicons name="location-outline" size={18} color={colors.primary} /></View>
          <View style={styles.feedbackTitle}><Text style={styles.location}>{item.clientLocation}</Text><Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}</Text></View>
          <View style={styles.rating}><Ionicons name="star" size={13} color="#B9851E" /><Text style={styles.ratingValue}>{item.overall.toFixed(1)}</Text></View>
        </View>
        <View style={styles.categoryRow}><Text style={styles.category}>{item.category}</Text><Text style={styles.readOnly}>Read only</Text></View>
        {item.comments ? <View style={styles.comment}><Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.muted} /><Text style={styles.commentText}>{item.comments}</Text></View> : null}
        <View style={styles.miniScores}>
          <MiniScore label="Clean" value={item.cleanliness} />
          <MiniScore label="On time" value={item.punctuality} />
          <MiniScore label="Equipment" value={item.equipment} />
          <MiniScore label="Client" value={item.clientRelations} />
        </View>
      </Card>) : <EmptyState title="No feedback yet" body="Ratings recorded about your work will appear here." />}

      {data.total > 0 ? <View style={styles.pagination}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous feedback page"
          disabled={page <= 1 || loading}
          onPress={() => setPage((value) => Math.max(1, value - 1))}
          style={({ pressed }) => [styles.pageButton, (page <= 1 || loading) && styles.disabled, pressed && styles.pressed]}
        ><Ionicons name="chevron-back" size={17} color={colors.primary} /><Text style={styles.pageButtonText}>Previous</Text></Pressable>
        <View style={styles.pageChip}><Text style={styles.pageCurrent}>{data.pagination.page}</Text><Text style={styles.pageOf}>of {data.pagination.totalPages}</Text></View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next feedback page"
          disabled={!data.pagination.hasMore || loading}
          onPress={() => setPage((value) => value + 1)}
          style={({ pressed }) => [styles.pageButton, (!data.pagination.hasMore || loading) && styles.disabled, pressed && styles.pressed]}
        ><Text style={styles.pageButtonText}>Next</Text><Ionicons name="chevron-forward" size={17} color={colors.primary} /></Pressable>
      </View> : null}
    </> : null}
  </Screen>;
}

function Score({ label, value, icon }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.score}>
    <View style={styles.scoreIcon}><Ionicons name={icon} size={15} color={colors.primary} /></View>
    <View><Text style={styles.scoreValue}>{value ? value.toFixed(1) : '—'}</Text><Text style={styles.scoreLabel}>{label}</Text></View>
  </View>;
}

function MiniScore({ label, value }: { label: string; value: number }) {
  return <View style={styles.miniScore}><Text style={styles.miniValue}>{value.toFixed(1)}</Text><Text style={styles.miniLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  errorCard: { borderColor: '#F0C2BD', backgroundColor: '#FFF6F5' },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  hero: { gap: 16, backgroundColor: '#FBFAFF', borderColor: '#DCD7F4' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  heroCopy: { flex: 1 },
  heroLabel: { color: colors.primary, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: .8 },
  heroValue: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 1 },
  heroOutOf: { color: colors.muted, fontSize: 14, fontWeight: '800' },
  heroSub: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  score: { flexGrow: 1, flexBasis: 135, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface },
  scoreIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  scoreValue: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  scoreLabel: { color: colors.muted, fontSize: 9, lineHeight: 12, marginTop: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  sectionCopy: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  feedbackCard: { gap: 11 },
  feedbackHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  locationIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  feedbackTitle: { flex: 1, minWidth: 0 },
  location: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  date: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99, backgroundColor: '#FFF5D9' },
  ratingValue: { color: '#8A641D', fontSize: 11, fontWeight: '900' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  category: { color: colors.primaryDark, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, fontSize: 9, fontWeight: '900' },
  readOnly: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 10, borderRadius: 12, backgroundColor: '#F7F9FA' },
  commentText: { flex: 1, color: colors.ink, fontSize: 11, lineHeight: 17 },
  miniScores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  miniScore: { flexGrow: 1, flexBasis: 64, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: '#FCFDFD' },
  miniValue: { color: colors.ink, fontSize: 11, fontWeight: '900' },
  miniLabel: { color: colors.muted, fontSize: 8, marginTop: 1 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2, paddingBottom: 8 },
  pageButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  pageButtonText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  pageChip: { flexDirection: 'row', alignItems: 'baseline', gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99, backgroundColor: colors.primarySoft },
  pageCurrent: { color: colors.primaryDark, fontSize: 13, fontWeight: '900' },
  pageOf: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  disabled: { opacity: .4 },
  pressed: { opacity: .75 },
});
