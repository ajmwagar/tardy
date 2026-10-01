import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usesLabel } from '@/audio/plays';
import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Icon } from '@/components/ui';
import type { TrendingSound } from '@/data/types';
import { api } from '@/state/store';
import { colors } from '@/theme';

const soundKey = (s: TrendingSound) => s.trackId;

/**
 * Sounds trending in the last 24 hours, from creator-owned tracks with cleared rights. Opened
 * from a reel's sound row, which is highlighted if it's on the chart.
 */
export default function SoundsSheet() {
  const { trackId } = useLocalSearchParams<{ trackId?: string }>();
  const insets = useSafeAreaInsets();
  const [sounds, setSounds] = useState<TrendingSound[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSounds(await api.trendingSounds());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; load() sets state only after its request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const renderSound = useCallback(
    ({ item, index }: { item: TrendingSound; index: number }) => (
      <View
        style={[styles.row, item.trackId === trackId && styles.rowCurrent]}
        accessibilityLabel={`${index + 1}. ${item.title} by ${item.artistName}, ${usesLabel(item.uses24h)}`}>
        <Text style={styles.rank}>{index + 1}</Text>
        <View style={styles.art}>
          <Icon name="music.note" size={18} color={colors.onPrimary} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.artistName} · {usesLabel(item.uses24h)} · {item.plays24h.toLocaleString('en-US')} plays
          </Text>
        </View>
      </View>
    ),
    [trackId],
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <Text style={styles.heading} accessibilityRole="header">
        Trending sounds
      </Text>
      <Text style={styles.sub}>Last 24 hours · original audio only</Text>
      {error && !sounds ? (
        <ErrorState message="The charts didn't load." detail={error} onRetry={load} />
      ) : !sounds ? (
        <Pulse style={{ padding: 16, gap: 14 }}>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} style={{ height: 44, borderRadius: 10 }} />
          ))}
        </Pulse>
      ) : (
        <FlatList
          data={sounds}
          keyExtractor={soundKey}
          renderItem={renderSound}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="music.note"
              title="Nothing trending yet"
              message="Post a reel with an original sound to start the chart."
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  heading: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center', paddingTop: 18 },
  sub: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingTop: 2, paddingBottom: 10 },
  list: { paddingHorizontal: 12, paddingBottom: 16, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12 },
  rowCurrent: { backgroundColor: colors.elevated },
  rank: {
    width: 18,
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  art: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  text: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 12.5 },
});
