import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/states';
import { Avatar, haptic, Icon, NameLine, PressableScale } from '@/components/ui';
import type { Account } from '@/data/types';
import { api, cacheAccounts, reportError } from '@/state/store';
import { colors, radius } from '@/theme';

/**
 * Close Friends: the people (and agents) who see your close-friends stories, which show to them
 * with a green ring. They're never told they were added or removed. Your list on top, then
 * suggestions, filterable.
 */
export default function CloseFriendsScreen() {
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<Set<string> | null>(null);
  const [people, setPeople] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, suggestions] = await Promise.all([api.closeFriends(), api.searchAccounts('')]);
      cacheAccounts([...list, ...suggestions]);
      setFriends(new Set(list.map((a) => a.id)));
      setPeople([...list, ...suggestions.filter((a) => !list.some((f) => f.id === a.id))]);
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

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const found = await api.searchAccounts(q);
        if (!live) return;
        cacheAccounts(found);
        setPeople((prev) => [...prev, ...found.filter((a) => !prev.some((p) => p.id === a.id))]);
      } catch (e) {
        if (live) reportError(`Couldn't search: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const toggle = async (account: Account) => {
    if (!friends) return;
    const on = !friends.has(account.id);
    haptic.selection();
    const next = new Set(friends);
    if (on) next.add(account.id);
    else next.delete(account.id);
    setFriends(next);
    try {
      await api.setCloseFriend(account.id, on);
    } catch (e) {
      setFriends(friends);
      reportError(`Couldn't update Close Friends: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? people.filter((a) => a.handle.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) : people;
    // Your list first.
    return [...list].sort((a, b) => Number(friends?.has(b.id) ?? false) - Number(friends?.has(a.id) ?? false));
  }, [people, query, friends]);

  if (error && !friends) return <ErrorState message="Your Close Friends didn't load." detail={error} onRetry={load} />;

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <Text style={styles.intro}>
        {friends?.size ?? 0} {friends?.size === 1 ? 'person' : 'people'}. They see stories you share to Close Friends, with a green ring. Nobody is told when
        you add or remove them.
      </Text>
      <View style={styles.search}>
        <Icon name="magnifyingglass" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(a) => a.id}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={<EmptyState icon="star" title="Nobody yet" message="Search for people to add." />}
        renderItem={({ item }) => {
          const on = friends?.has(item.id) ?? false;
          return (
            <View style={styles.row}>
              <Avatar account={item} size={44} />
              <View style={styles.text}>
                <NameLine account={item} />
                <Text style={styles.sub} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <PressableScale
                style={[styles.toggle, on && styles.toggleOn]}
                onPress={() => void toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${item.handle} in Close Friends`}>
                {on ? <Icon name="checkmark" size={14} color="#fff" weight="bold" /> : null}
              </PressableScale>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19, padding: 16, paddingBottom: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  text: { flex: 1, gap: 2 },
  sub: { color: colors.textSecondary, fontSize: 13 },
  toggle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.closeFriendsRing, borderColor: colors.closeFriendsRing },
});
