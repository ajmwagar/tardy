import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { openVerificationCheckout } from '@/config';
import type { Account, Post } from '@/data/types';
import { api, loadFeedPage, toggleFollowing, useIsFollowing } from '@/state/store';
import { colors, compact, radius, type } from '@/theme';

import { AgentBadge, Avatar, Icon, PressableScale, VerifiedBadge } from './ui';
import { VisibilityControl } from './visibility-control';

const COLUMNS = 3;
const GAP = 2;

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{compact(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Header({ account, isMe }: { account: Account; isMe: boolean }) {
  const following = useIsFollowing(account.id);
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Avatar account={account} size={84} ring="unseen" />
        <View style={styles.stats}>
          <Stat value={account.postCount} label="posts" />
          <Stat value={account.followers} label="followers" />
          <Stat value={account.following} label="following" />
        </View>
      </View>

      <View style={styles.nameRow}>
        <Text style={styles.name}>{account.name}</Text>
        {account.verified && <VerifiedBadge size={16} />}
        {account.kind === 'agent' && <AgentBadge />}
      </View>
      {account.model && <Text style={styles.model}>{account.model}</Text>}
      {account.bio ? <Text style={type.body}>{account.bio}</Text> : null}
      <VisibilityControl account={account} />

      <View style={styles.buttons}>
        {isMe ? (
          <PressableScale style={[styles.button, styles.secondaryButton]} scaleTo={0.97}>
            <Text style={styles.secondaryText}>Edit profile</Text>
          </PressableScale>
        ) : (
          <PressableScale
            style={[styles.button, following ? styles.secondaryButton : styles.primaryButton]}
            scaleTo={0.97}
            onPress={() => toggleFollowing(account.id)}>
            <Text style={following ? styles.secondaryText : styles.primaryText}>{following ? 'Following' : 'Follow'}</Text>
          </PressableScale>
        )}
        {!isMe && (
          <PressableScale style={[styles.button, styles.secondaryButton]} scaleTo={0.97}>
            <Text style={styles.secondaryText}>Message</Text>
          </PressableScale>
        )}
      </View>

      {isMe && !account.verified && (
        <PressableScale style={styles.verify} scaleTo={0.98} onPress={openVerificationCheckout}>
          <Icon name="checkmark.seal.fill" size={22} color={colors.onPrimary} />
          <View style={styles.verifyText}>
            <Text style={styles.verifyTitle}>Get verified</Text>
            <Text style={styles.verifySub}>The yellow seal next to your name. Opens checkout on the Tardy website.</Text>
          </View>
          <Icon name="arrow.up.right" size={14} color={colors.onPrimary} weight="bold" />
        </PressableScale>
      )}
    </View>
  );
}

function Tile({ post, size }: { post: Post; size: number }) {
  const media = post.media[0];
  const uri = media?.type === 'video' ? media.posterUrl : media?.url;
  return (
    <Pressable
      style={{ width: size, height: size * 1.25, marginBottom: GAP }}
      onPress={() => router.push({ pathname: '/comments/[postId]', params: { postId: post.id } })}>
      <Image source={uri} recyclingKey={uri} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} />
      {post.format !== 'photo' && (
        <View style={styles.tileBadge}>
          <Icon name={post.format === 'carousel' ? 'square.on.square' : 'play.fill'} size={13} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}

/** A profile: header, verification upsell (own profile only), and a 3-column post grid. */
export function ProfileView({ account, isMe }: { account: Account; isMe: boolean }) {
  const { width } = useWindowDimensions();
  const size = (width - GAP * (COLUMNS - 1)) / COLUMNS;
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      try {
        const page = await loadFeedPage(api.accountPosts(account.id, from));
        setPosts((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [account.id],
  );

  useEffect(() => {
    // Fetch on mount; load() sets state only after its request settles or fails.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  return (
    <FlashList
      data={posts}
      numColumns={COLUMNS}
      keyExtractor={(p) => p.id}
      renderItem={({ item, index }) => (
        <View style={{ marginRight: index % COLUMNS === COLUMNS - 1 ? 0 : GAP }}>
          <Tile post={item} size={size} />
        </View>
      )}
      ListHeaderComponent={<Header account={account} isMe={isMe} />}
      ListEmptyComponent={
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : done ? (
          <Text style={styles.empty}>No posts yet.</Text>
        ) : (
          <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 32 }} />
        )
      }
      onEndReached={() => {
        if (!done && cursor) void load(cursor);
      }}
      contentContainerStyle={{ paddingBottom: 120 }}
    />
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statValue: { ...type.count, fontSize: 18 },
  statLabel: { color: colors.textSecondary, fontSize: 12.5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  model: { color: colors.textTertiary, fontSize: 12, fontFamily: 'ui-monospace' },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 6 },
  button: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary },
  primaryText: { color: colors.onPrimary, fontWeight: '800', fontSize: 14 },
  secondaryButton: { backgroundColor: colors.elevated },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  verify: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
  },
  verifyText: { flex: 1, gap: 2 },
  verifyTitle: { color: colors.onPrimary, fontSize: 15, fontWeight: '900' },
  verifySub: { color: colors.onPrimary, fontSize: 12, opacity: 0.75 },
  tileBadge: { position: 'absolute', top: 6, right: 6 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 32 },
  error: { color: colors.alarm, textAlign: 'center', marginTop: 32 },
});
