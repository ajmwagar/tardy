import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Account } from '@/data/types';
import { api, cacheAccounts, reportError, useAccount } from '@/state/store';
import { colors } from '@/theme';

import { Avatar, haptic, Icon, PressableScale } from './ui';

/**
 * Your avatar with a "Generate new" button: the server makes a fresh one each tap, so nobody
 * has a blank picture and nobody has to find a photo to get started.
 */
export function GenerateAvatar({ account: initial, size = 88 }: { account: Account; size?: number }) {
  // The store's copy once there is one (it updates on Generate); the given one until then.
  const account = useAccount(initial.id) ?? initial;
  const [busy, setBusy] = useState(false);

  const roll = async () => {
    setBusy(true);
    try {
      cacheAccounts([await api.generateAvatar()]);
      haptic.selection();
    } catch (e) {
      reportError(`Couldn't make a new picture: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Avatar account={account} size={size} />
      <PressableScale
        style={styles.button}
        onPress={roll}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Generate a new profile picture"
        accessibilityState={{ busy }}>
        {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Icon name="dice" size={15} color={colors.text} />}
        <Text style={styles.label}>Generate new</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: colors.elevated },
  label: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
});
