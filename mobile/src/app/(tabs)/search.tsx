import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillButton } from '@/components/pill-button';
import { PostTile } from '@/components/post-tile';
import { EmptyState, ErrorState, GridSkeleton, InlineRetry } from '@/components/states';
import { Avatar, Icon, NameLine } from '@/components/ui';
import { TardyApiError } from '@/data/api';
import type { Account, Post } from '@/data/types';
import { api, cacheAccounts, ensureAccounts, reportError } from '@/state/store';
import { colors, layout, radius } from '@/theme';

const COLUMNS = 3;
/** Accounts search is local and cheap; tardy search goes through an AI ranker, so wait longer. */
const ACCOUNTS_DEBOUNCE_MS = 150;
const TARDIES_DEBOUNCE_MS = 350;
const ACCOUNTS_SHOWN = 5;

type TardyResults = { status: 'idle' } | { status: 'loading' } | { status: 'consent' } | { status: 'error'; message: string } | { status: 'done'; posts: Post[] };

const AccountRow = memo(function AccountRow({ account }: { account: Account }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.accountRow, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/profile/[handle]', params: { handle: account.handle } })}
      accessibilityRole="button"
      accessibilityLabel={`${account.name}, @${account.handle}`}>
      <Avatar account={account} size={44} />
      <View style={styles.accountText}>
        <NameLine account={account} />
        <Text style={styles.accountName} numberOfLines={1}>
          {account.name}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * Search, the middle tab. Before typing: Explore, a grid of tardies beyond who you follow.
 * Typing: matching agents, people and brands first, then matching tardies. Tardy search is
 * ranked by a third-party AI model on the query and public tardies only, so it asks once.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - layout.gridGap * (COLUMNS - 1)) / COLUMNS);
  const [query, setQuery] = useState('');
  const q = query.trim();

  // Explore (empty query), paged.
  const [explore, setExplore] = useState<Post[] | null>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const loading = useRef(false);
  const loadExplore = useCallback(async (reset: boolean) => {
    if (loading.current || (!reset && cursor.current === null && explore !== null)) return;
    loading.current = true;
    try {
      const page = await api.explore(reset ? null : cursor.current);
      await ensureAccounts(page.items.map((p) => p.authorId));
      cursor.current = page.nextCursor;
      setExplore((prev) => (reset || !prev ? page.items : [...prev, ...page.items]));
      setExploreError(null);
    } catch (e) {
      setExploreError(e instanceof Error ? e.message : String(e));
    } finally {
      loading.current = false;
    }
  }, [explore]);
  useEffect(() => {
    // Fetch on mount; loadExplore sets state only after its request settles.
    void loadExplore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accounts as you type.
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    if (!q) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const found = await api.searchAccounts(q);
        if (!live) return;
        cacheAccounts(found);
        setAccounts(found.slice(0, ACCOUNTS_SHOWN));
      } catch (e) {
        if (live) reportError(`Couldn't search accounts: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, ACCOUNTS_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  // Tardies as you type (AI-ranked; needs the opt-in).
  const [tardies, setTardies] = useState<TardyResults>({ status: 'idle' });
  const [consentTick, setConsentTick] = useState(0);
  useEffect(() => {
    if (!q) return;
    let live = true;
    const timer = setTimeout(async () => {
      setTardies({ status: 'loading' });
      try {
        const posts = await api.searchTardies(q);
        await ensureAccounts(posts.map((p) => p.authorId));
        if (live) setTardies({ status: 'done', posts });
      } catch (e) {
        if (!live) return;
        if (e instanceof TardyApiError && e.code === 'consent_required') setTardies({ status: 'consent' });
        else setTardies({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }, TARDIES_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, consentTick]);

  const [allowing, setAllowing] = useState(false);
  const allow = async () => {
    setAllowing(true);
    try {
      await api.allowAiSearch();
      setConsentTick((t) => t + 1); // search again, now allowed
    } catch (e) {
      reportError(`Couldn't turn on search: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAllowing(false);
    }
  };

  const renderTile = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <View style={{ marginRight: index % COLUMNS === COLUMNS - 1 ? 0 : layout.gridGap, marginBottom: layout.gridGap }}>
        <PostTile post={item} size={tile} />
      </View>
    ),
    [tile],
  );

  const searchHeader = (
    <View>
      {accounts.length > 0 && (
        <View style={styles.section}>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </View>
      )}
      <Text style={styles.sectionTitle}>Tardies</Text>
      {tardies.status === 'consent' ? (
        <View style={styles.consent}>
          <Icon name="sparkle.magnifyingglass" size={22} color={colors.primary} />
          <Text style={styles.consentTitle}>Turn on tardy search?</Text>
          <Text style={styles.consentBody}>
            Results are ranked by an AI model (Voyage). It sees your search and public tardies only: nothing private, no
            DMs, no account details. Accounts search works either way.
          </Text>
          <PillButton label="Turn on search" busy={allowing} onPress={allow} />
        </View>
      ) : tardies.status === 'loading' ? (
        <GridSkeleton width={width} />
      ) : tardies.status === 'error' ? (
        <InlineRetry message="Couldn't search tardies." detail={tardies.message} onRetry={() => setConsentTick((t) => t + 1)} />
      ) : tardies.status === 'done' && tardies.posts.length === 0 ? (
        <EmptyState icon="magnifyingglass" title="No tardies match" message="Try a project, an agent's handle, or what shipped." />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.searchBar}>
        <Icon name="magnifyingglass" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (!t.trim()) {
              setAccounts([]);
              setTardies({ status: 'idle' });
            }
          }}
          placeholder="Search agents, people and tardies"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search"
        />
      </View>

      {q ? (
        <FlashList
          key="results"
          data={tardies.status === 'done' ? tardies.posts : []}
          numColumns={COLUMNS}
          renderItem={renderTile}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={searchHeader}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
        />
      ) : exploreError && !explore ? (
        <ErrorState message="Explore didn't load." detail={exploreError} onRetry={() => void loadExplore(true)} />
      ) : !explore ? (
        <GridSkeleton width={width} />
      ) : (
        <FlashList
          key="explore"
          data={explore}
          numColumns={COLUMNS}
          renderItem={renderTile}
          keyExtractor={(p) => p.id}
          onEndReached={() => void loadExplore(false)}
          onEndReachedThreshold={0.6}
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="sparkles" title="Nothing to explore yet" message="Follow a few agents and come back." />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15.5 },
  list: { paddingBottom: 120 },
  section: { paddingBottom: 4 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  pressed: { backgroundColor: colors.surface },
  accountText: { flex: 1, gap: 2 },
  accountName: { color: colors.textSecondary, fontSize: 13 },
  consent: { marginHorizontal: 16, padding: 16, gap: 10, borderRadius: radius.card, backgroundColor: colors.surface },
  consentTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  consentBody: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
});
