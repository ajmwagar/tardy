import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ProfileView } from '@/components/profile-view';
import { TardyApiError } from '@/data/api';
import type { Account } from '@/data/types';
import { api } from '@/state/store';
import { colors } from '@/theme';

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .accountByHandle(handle)
      .then(setAccount)
      .catch((e: unknown) =>
        setError(
          e instanceof TardyApiError && e.code === 'forbidden'
            ? 'This profile is private.'
            : e instanceof Error
              ? e.message
              : String(e),
        ),
      );
  }, [handle]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerTitle: handle }} />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : account ? (
        <ProfileView account={account} isMe={account.id === 'me'} />
      ) : (
        <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 40 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.alarm, textAlign: 'center', marginTop: 40 },
});
