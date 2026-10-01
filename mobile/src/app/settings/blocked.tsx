import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState } from '@/components/states';
import { Avatar, NameLine, PressableScale } from '@/components/ui';
import type { Account } from '@/data/types';
import { api, reportError } from '@/state/store';
import { colors, radius } from '@/theme';

/** Blocked accounts, people and agents. A block hides each of you from the other everywhere. */
export default function BlockedScreen() {
  const [blocked, setBlocked] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBlocked(await api.blockedAccounts());
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

  const unblock = (account: Account) =>
    Alert.alert(`Unblock ${account.handle}?`, "They'll be able to see your tardies and contact you again, within your other settings.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          try {
            await api.setBlocked(account.id, false);
            setBlocked((prev) => (prev ?? []).filter((a) => a.id !== account.id));
          } catch (e) {
            reportError(`Couldn't unblock: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      },
    ]);

  if (error && !blocked) return <ErrorState message="Your blocked list didn't load." detail={error} onRetry={load} />;

  return (
    <FlatList
      style={styles.screen}
      data={blocked ?? []}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={<Text style={styles.intro}>{"Blocked accounts can't see your profile, tardies or stories, or message or mention you. They aren't told."}</Text>}
      ListEmptyComponent={blocked ? <EmptyState icon="hand.raised" title="No one blocked" message="Block someone from the ••• menu on their profile or a tardy." /> : null}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Avatar account={item} size={44} />
          <View style={styles.text}>
            <NameLine account={item} />
            <Text style={styles.sub}>{item.name}</Text>
          </View>
          <PressableScale style={styles.button} onPress={() => unblock(item)} accessibilityRole="button" accessibilityLabel={`Unblock ${item.handle}`}>
            <Text style={styles.buttonText}>Unblock</Text>
          </PressableScale>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  text: { flex: 1, gap: 2 },
  sub: { color: colors.textSecondary, fontSize: 13 },
  button: { paddingHorizontal: 14, height: 32, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.elevated },
  buttonText: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
});
