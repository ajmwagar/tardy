import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Avatar, haptic, Icon, IconButton, PressableScale } from '@/components/ui';
import type { Notification, NotificationKind, Post } from '@/data/types';
import { payloadFor } from '@/notifications/payload';
import { routeForPayload } from '@/notifications/routing';
import { groupNotifications, readThrough, type TrayFilter } from '@/notifications/tray';
import { api, ensureAccounts, refreshUnread, toggleFollowing, useAccount, useIsFollowing } from '@/state/store';
import { colors, radius, status as statusStyles, timeAgo, type } from '@/theme';

/** The small badge on the actor's avatar: what kind of thing happened, at a glance. */
const KIND_BADGE: Record<NotificationKind, { symbol: SFSymbol; color: string }> = {
  shipped: { symbol: 'checkmark.seal.fill', color: statusStyles.shipped.color },
  blocked: { symbol: 'light.beacon.max.fill', color: colors.alarm },
  review_requested: { symbol: 'eye.fill', color: statusStyles.needs_review.color },
  like: { symbol: 'hand.thumbsup.fill', color: colors.primary },
  comment: { symbol: 'bubble.left.fill', color: colors.text },
  mention: { symbol: 'at', color: colors.text },
  follow: { symbol: 'person.fill.badge.plus', color: colors.text },
};

const FILTERS: { key: TrayFilter; label: string }[] = [
  { key: 'needs_you', label: 'Needs you' },
  { key: 'all', label: 'All' },
  { key: 'work', label: 'Work' },
  { key: 'mentions', label: 'Mentions' },
];

type Row = { type: 'header'; title: string } | { type: 'item'; n: Notification };

/** Post thumbnail for the right edge; quietly absent if the post is gone or hidden. */
function Thumb({ postId }: { postId: string }) {
  const [post, setPost] = useState<Post | null>(null);
  useEffect(() => {
    api.post(postId).then(setPost, () => setPost(null));
  }, [postId]);
  const media = post?.media[0];
  const uri = media?.type === 'video' ? media.posterUrl : media?.url;
  if (!uri) return <View style={styles.thumb} />;
  return <Image source={uri} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />;
}

function FollowBack({ accountId }: { accountId: string }) {
  const following = useIsFollowing(accountId);
  return (
    <PressableScale
      scaleTo={0.95}
      style={[styles.follow, following ? styles.followingButton : styles.followButton]}
      onPress={() => toggleFollowing(accountId)}>
      <Text style={following ? styles.followingText : styles.followText}>{following ? 'Following' : 'Follow back'}</Text>
    </PressableScale>
  );
}

const NotificationRow = memo(function NotificationRow({ n }: { n: Notification }) {
  const actor = useAccount(n.actorId);
  const badge = KIND_BADGE[n.kind];

  const open = async () => {
    const route = await routeForPayload(payloadFor(n), api);
    if (route.notice) Alert.alert('Not available', route.notice);
    else router.push(route.href);
  };

  return (
    <Pressable style={({ pressed }) => [styles.row, !n.read && styles.rowUnread, pressed && styles.rowPressed]} onPress={open}>
      <View>
        <Avatar account={actor} size={44} />
        <View style={styles.badge}>
          <Icon name={badge.symbol} size={11} color={badge.color} weight="bold" />
        </View>
      </View>
      <Text style={styles.text} numberOfLines={3}>
        <Text style={styles.actor}>{actor?.handle ?? 'someone'} </Text>
        {n.text}
        <Text style={styles.time}> {timeAgo(n.createdAt)}</Text>
      </Text>
      {n.kind === 'follow' ? <FollowBack accountId={n.actorId} /> : n.postId ? <Thumb postId={n.postId} /> : null}
    </Pressable>
  );
});

function TraySkeleton() {
  return (
    <Pulse style={{ paddingHorizontal: 16, paddingTop: 16, gap: 18 }}>
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <SkeletonBlock style={{ width: 44, height: 44, borderRadius: 22 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock style={{ width: '85%', height: 11 }} />
            <SkeletonBlock style={{ width: '50%', height: 10 }} />
          </View>
          <SkeletonBlock style={{ width: 44, height: 44, borderRadius: 8 }} />
        </View>
      ))}
    </Pulse>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrayFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await api.notifications();
      await ensureAccounts(items.map((n) => n.actorId));
      setList(items);
      setError(null);
      // Seen means read: clear the badge now; rows stay highlighted until the next visit.
      const through = readThrough(items);
      if (through) {
        await api.markNotificationsRead(through);
        void refreshUnread();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows = useMemo<Row[]>(
    () =>
      list
        ? groupNotifications(list, filter).flatMap((s) => [
            { type: 'header' as const, title: s.title },
            ...s.items.map((n) => ({ type: 'item' as const, n })),
          ])
        : [],
    [list, filter],
  );

  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {FILTERS.map((f) => (
        <PressableScale
          key={f.key}
          scaleTo={0.95}
          style={[styles.chip, filter === f.key && styles.chipActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === f.key }}
          onPress={() => {
            if (filter === f.key) return;
            haptic.selection();
            setFilter(f.key);
          }}>
          <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
        </PressableScale>
      ))}
    </ScrollView>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text style={type.title}>Activity</Text>
        <IconButton icon="slider.horizontal.3" size={22} label="Notification settings" onPress={() => router.push('/settings')} style={styles.edgeButton} />
      </View>

      {error && !list ? (
        <ErrorState message="The alarms didn't go off. Ironic." detail={error} onRetry={load} />
      ) : !list ? (
        <TraySkeleton />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => (r.type === 'header' ? `h-${r.title}` : r.n.id)}
          getItemType={(r) => r.type}
          renderItem={({ item }) =>
            item.type === 'header' ? <Text style={styles.section}>{item.title}</Text> : <NotificationRow n={item.n} />
          }
          ListHeaderComponent={chips}
          ListEmptyComponent={
            filter === 'needs_you' ? (
              <EmptyState icon="checkmark.circle" title="All clear" message="Nothing needs you. Your agents are self-sufficient, for now." />
            ) : filter === 'work' ? (
              <EmptyState icon="checkmark.seal" title="No work news" message="Nothing shipped, nothing blocked. Either peace or denial." />
            ) : (
              <EmptyState icon="alarm" title="All quiet" message="No activity yet. Your agents are heads-down, allegedly." />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.textSecondary}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  edgeButton: { marginRight: -10 },
  chips: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.elevated },
  chipActive: { backgroundColor: colors.text },
  chipText: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  chipTextActive: { color: colors.bg },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  rowUnread: { backgroundColor: 'rgba(255,194,26,0.06)' },
  rowPressed: { backgroundColor: colors.surface },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  text: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 19 },
  actor: { fontWeight: '800' },
  time: { color: colors.textTertiary },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.elevated },
  follow: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  followButton: { backgroundColor: colors.primary },
  followingButton: { backgroundColor: colors.elevated },
  followText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  followingText: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
