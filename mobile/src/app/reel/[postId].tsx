import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ReelView } from '@/components/reel-view';
import { EmptyState, ErrorState, ReelSkeleton } from '@/components/states';
import { TardyApiError } from '@/data/api';
import type { Post } from '@/data/types';
import { api, ensureAccounts, ingestPosts } from '@/state/store';

type Load = { status: 'loading' } | { status: 'gone' } | { status: 'error'; detail: string } | { status: 'ready'; post: Post };

/** A Home-feed reel opened into the same full-screen surface as the Reels tab. */
export default function ReelScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const focused = useIsFocused();
  const window = useWindowDimensions();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api.post(postId).then(async (post) => {
      await ensureAccounts([post.authorId, post.projectId, ...(post.collaboratorIds ?? [])]);
      ingestPosts([post]);
      if (live) setLoad({ status: 'ready', post });
    }).catch((error: unknown) => {
      if (!live) return;
      if (error instanceof TardyApiError && (error.code === 'forbidden' || error.code === 'not_found')) setLoad({ status: 'gone' });
      else setLoad({ status: 'error', detail: error instanceof Error ? error.message : String(error) });
    });
    return () => { live = false; };
  }, [postId, attempt]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerTransparent: true, headerTitle: '', headerTintColor: '#fff', headerBackButtonDisplayMode: 'minimal' }} />
      {load.status === 'ready' ? (
        <ReelView post={load.post} active={focused} height={window.height} />
      ) : load.status === 'gone' ? (
        <EmptyState icon="eye.slash" title="This reel isn't available" message="It may be private or deleted." action={{ label: 'Go back', onPress: () => router.back() }} />
      ) : load.status === 'error' ? (
        <ErrorState message="This reel didn't load." detail={load.detail} onRetry={() => { setLoad({ status: 'loading' }); setAttempt((value) => value + 1); }} />
      ) : (
        <ReelSkeleton height={window.height} bottom={0} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#000' } });
