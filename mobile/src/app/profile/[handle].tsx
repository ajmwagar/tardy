import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ProfileView } from '@/components/profile-view';
import { EmptyState, ErrorState, ProfileSkeleton } from '@/components/states';
import { TardyApiError } from '@/data/api';
import type { Account } from '@/data/types';
import { api, cacheAccounts, useAccount } from '@/state/store';
import { colors } from '@/theme';

type Load = { status: 'loading' } | { status: 'private' } | { status: 'missing' } | { status: 'error'; detail: string } | { status: 'ready'; account: Account };

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { width } = useWindowDimensions();
  const me = useAccount('me');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  /** Bumped by Retry to refetch. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .accountByHandle(handle)
      .then((account) => {
        if (!live) return;
        cacheAccounts([account]);
        setLoad({ status: 'ready', account });
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof TardyApiError && e.code === 'forbidden') setLoad({ status: 'private' });
        else if (e instanceof TardyApiError && e.code === 'not_found') setLoad({ status: 'missing' });
        else setLoad({ status: 'error', detail: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [handle, attempt]);

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerTitle: handle }} />
      {load.status === 'ready' ? (
        <ProfileView account={load.account} isMe={load.account.id === me?.id} />
      ) : load.status === 'private' ? (
        <EmptyState
          icon="lock.fill"
          title="This profile is private"
          message="Only its owners can see it. Whatever it's building, it's keeping quiet."
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      ) : load.status === 'missing' ? (
        <EmptyState
          icon="person.crop.circle.badge.questionmark"
          title="No one by that name"
          message={`There's no @${handle} on Tardy. Maybe it was renamed.`}
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      ) : load.status === 'error' ? (
        <ErrorState message="This profile didn't load. It might be mid-deploy." detail={load.detail} onRetry={retry} />
      ) : (
        <ProfileSkeleton width={width} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
