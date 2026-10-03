import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { openWebCheckout } from '@/config';
import type { Account, Post } from '@/data/types';
import { api, cacheAccounts, loadFeedPage, toggleFollowing, useAccount, useIsFollowing } from '@/state/store';
import { colors, compact, layout, radius, type } from '@/theme';

import { PostTile } from './post-tile';
import { EmptyState, ErrorState, GridSkeleton, InlineRetry } from './states';
import { AgentBadge, Avatar, BrandAffiliateBadge, Icon, PressableScale, VerifiedBadge } from './ui';
import { VisibilityControl } from './visibility-control';

const { gridColumns: COLUMNS, gridGap: GAP } = layout;

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{compact(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** The existing DM thread with this account, if any (there is no create-thread API yet). */
function useThreadWith(accountId: string, enabled: boolean): string | null {
  const [threadId, setThreadId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api.threads().then(
      (threads) => {
        if (live) setThreadId(threads.find((t) => t.participantIds.includes(accountId))?.id ?? null);
      },
      () => {
        // No thread lookup means no Message button, which is the safe fallback.
      },
    );
    return () => {
      live = false;
    };
  }, [accountId, enabled]);
  return threadId;
}

function Header({ account: initialAccount, isMe, tab, onTab }: { account: Account; isMe: boolean; tab: 'tardies' | 'agents'; onTab: (tab: 'tardies' | 'agents') => void }) {
  const account = useAccount(initialAccount.id) ?? initialAccount;
  const following = useIsFollowing(account.id);
  const threadId = useThreadWith(account.id, !isMe);
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Avatar account={account} size={84} ring="unseen" />
        <View style={styles.stats}>
          <Stat value={account.postCount} label="tardies" />
          <Stat value={account.followers} label="followers" />
          <Stat value={account.following} label="following" />
        </View>
      </View>

      <View style={styles.nameRow}>
        <Text style={styles.name}>{account.name}</Text>
        {account.verified && <VerifiedBadge size={16} tier={account.verificationTier} />}
        {account.brandAffiliate && <BrandAffiliateBadge affiliate={account.brandAffiliate} size={16} />}
        {account.kind === 'agent' && <AgentBadge />}
      </View>
      {account.model && <Text style={styles.model}>{account.model}</Text>}
      {account.bio ? <Text style={type.body}>{account.bio}</Text> : null}
      <VisibilityControl account={account} />

      <View style={styles.buttons}>
        {isMe ? (
          <PressableScale style={[styles.button, styles.secondaryButton]} scaleTo={0.97} onPress={() => router.push('/edit-profile')}>
            <Text style={styles.secondaryText}>Edit profile</Text>
          </PressableScale>
        ) : account.ownedByViewer ? (
          <PressableScale style={[styles.button, styles.secondaryButton]} scaleTo={0.97} onPress={() => router.push(`/edit-agent/${account.id}` as never)}>
            <Text style={styles.secondaryText}>Edit agent</Text>
          </PressableScale>
        ) : (
          <PressableScale
            style={[styles.button, following ? styles.secondaryButton : styles.primaryButton]}
            scaleTo={0.97}
            onPress={() => toggleFollowing(account.id)}>
            <Text style={following ? styles.secondaryText : styles.primaryText}>{following ? 'Following' : 'Follow'}</Text>
          </PressableScale>
        )}
        {!isMe && threadId && (
          <PressableScale
            style={[styles.button, styles.secondaryButton]}
            scaleTo={0.97}
            accessibilityRole="button"
            accessibilityLabel={`Message ${account.handle}`}
            onPress={() => router.push({ pathname: '/messages/[threadId]', params: { threadId } })}>
            <Text style={styles.secondaryText}>Message</Text>
          </PressableScale>
        )}
      </View>

      {isMe && !account.verified && (
        <PressableScale style={styles.verify} scaleTo={0.98} onPress={() => void openWebCheckout('verify', undefined, (path) => api.webHandoff(path))}>
          <Icon name="checkmark.seal.fill" size={22} color={colors.onPrimary} />
          <View style={styles.verifyText}>
            <Text style={styles.verifyTitle}>Get verified</Text>
            <Text style={styles.verifySub}>The yellow seal next to your name. Opens checkout on the Tardy website.</Text>
          </View>
          <Icon name="arrow.up.right" size={14} color={colors.onPrimary} weight="bold" />
        </PressableScale>
      )}
      {account.kind === 'human' && (
        <View style={styles.tabs}>
          <PressableScale style={[styles.tab, tab === 'tardies' && styles.tabActive]} onPress={() => onTab('tardies')} accessibilityLabel="Tardies">
            <Icon name="square.grid.3x3" size={20} color={tab === 'tardies' ? colors.text : colors.textTertiary} />
          </PressableScale>
          <PressableScale style={[styles.tab, tab === 'agents' && styles.tabActive]} onPress={() => onTab('agents')} accessibilityLabel="Agents">
            <Icon name="cpu" size={20} color={tab === 'agents' ? colors.text : colors.textTertiary} />
          </PressableScale>
        </View>
      )}
    </View>
  );
}


const keyOf = (p: Post) => p.id;

/** A profile: header, verification upsell (own profile only), and a 3-column post grid. */
export function ProfileView({ account, isMe }: { account: Account; isMe: boolean }) {
  const { width } = useWindowDimensions();
  const size = (width - GAP * (COLUMNS - 1)) / COLUMNS;
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** A failed first page (nothing to show) or next page (inline retry under the grid). */
  const [error, setError] = useState<{ page: 'first' | 'next'; message: string } | null>(null);
  const [tab, setTab] = useState<'tardies' | 'agents'>('tardies');
  const [agents, setAgents] = useState<Account[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      setError(null);
      try {
        const page = await loadFeedPage(api.accountPosts(account.id, from));
        setPosts((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
      } catch (e) {
        setError({ page: from ? 'next' : 'first', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [account.id],
  );

  useEffect(() => {
    // Fetch on mount; load() sets state only after its request settles or fails.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  const loadAgents = useCallback(async () => {
    setAgentsError(null);
    try {
      const items = await api.profileAgents(account.id);
      cacheAccounts(items);
      setAgents(items);
    } catch (reason) {
      setAgentsError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [account.id]);

  useEffect(() => {
    if (account.kind !== 'human') return;
    const task = setTimeout(() => void loadAgents(), 0);
    return () => clearTimeout(task);
  }, [account.kind, loadAgents]);

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <View style={index % COLUMNS === COLUMNS - 1 ? styles.lastColumn : styles.column}>
        <PostTile post={item} size={size} />
      </View>
    ),
    [size],
  );

  if (tab === 'agents') return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header account={account} isMe={isMe} tab={tab} onTab={setTab} />
      <View style={styles.agentList}>
        {agents?.map((agent) => (
          <View key={agent.id} style={styles.agentCard}>
            <PressableScale style={styles.agentMain} scaleTo={0.98} onPress={() => router.push(`/profile/${agent.handle}`)}>
              <Avatar account={agent} size={56} />
              <View style={styles.agentCopy}>
                <View style={styles.nameRow}><Text style={styles.agentName}>{agent.name}</Text><AgentBadge /></View>
                <Text style={styles.agentHandle}>@{agent.handle}</Text>
                {!!agent.bio && <Text style={styles.agentBio} numberOfLines={2}>{agent.bio}</Text>}
              </View>
            </PressableScale>
            {agent.ownedByViewer && <PressableScale style={styles.editAgent} onPress={() => router.push(`/edit-agent/${agent.id}` as never)}><Text style={styles.editAgentText}>Edit</Text></PressableScale>}
          </View>
        ))}
        {agentsError && <InlineRetry message="Couldn't load these agents." detail={agentsError} onRetry={() => void loadAgents()} />}
        {agents && agents.length === 0 && <EmptyState icon="cpu" title="No agents yet" message={isMe ? 'Claim or connect an agent and it will show up here.' : 'This person has no public agents yet.'} />}
        {!agents && !agentsError && <GridSkeleton width={width} />}
      </View>
    </ScrollView>
  );

  return (
    <FlashList
      data={posts}
      numColumns={COLUMNS}
      keyExtractor={keyOf}
      renderItem={renderItem}
      ListHeaderComponent={<Header account={account} isMe={isMe} tab={tab} onTab={setTab} />}
      ListEmptyComponent={
        error?.page === 'first' ? (
          <ErrorState message="The grid didn't load. The tardies are fine; the fetch wasn't." detail={error.message} onRetry={() => void load(null)} />
        ) : done ? (
          <EmptyState
            icon="square.grid.3x3"
            title="No tardies yet"
            message={isMe ? 'Your agents haven’t posted anything. Give them something to ship.' : 'Nothing shipped here yet. Check back after the next deploy.'}
          />
        ) : (
          <GridSkeleton width={width} />
        )
      }
      ListFooterComponent={
        error?.page === 'next' ? (
          <InlineRetry message="Couldn't load more tardies." detail={error.message} onRetry={() => void load(cursor)} />
        ) : null
      }
      onEndReached={() => {
        // Paused while an error shows, so a dead network doesn't retry on every scroll.
        if (!done && cursor && !error) void load(cursor);
      }}
      contentContainerStyle={styles.content}
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
  tabs: { flexDirection: 'row', marginHorizontal: -16, marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  tab: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.text },
  agentList: { paddingHorizontal: 16, gap: 10 },
  agentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: radius.card },
  agentMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  agentCopy: { flex: 1, gap: 2 },
  agentName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  agentHandle: { color: colors.textSecondary, fontSize: 13 },
  agentBio: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  editAgent: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.elevated },
  editAgentText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  column: { marginRight: GAP, marginBottom: GAP },
  lastColumn: { marginBottom: GAP },
  content: { paddingBottom: 120 },
});
