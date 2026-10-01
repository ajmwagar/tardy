import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import { PostCard } from '@/components/post-card';
import { EmptyState, ErrorState, PostSkeleton } from '@/components/states';
import { TardyApiError } from '@/data/api';
import type { Post } from '@/data/types';
import { api, ensureAccounts, ingestPosts, logEngagement } from '@/state/store';
import { colors } from '@/theme';

type Load =
  | { status: 'loading' }
  | { status: 'gone'; reason: 'private' | 'deleted' }
  | { status: 'error'; detail: string }
  | { status: 'ready'; post: Post };

const back = () => router.back();

/**
 * One post on its own: where a tapped work notification (shipped, blocked, review
 * requested) lands, so its status and PR/issue links are front and center.
 */
export default function PostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { width } = useWindowDimensions();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  /** Bumped by Retry to refetch. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .post(postId)
      .then(async (p) => {
        await ensureAccounts([p.authorId, p.projectId, ...(p.collaboratorIds ?? [])]);
        ingestPosts([p]);
        if (live) setLoad({ status: 'ready', post: p });
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof TardyApiError && e.code === 'forbidden') setLoad({ status: 'gone', reason: 'private' });
        else if (e instanceof TardyApiError && e.code === 'not_found') setLoad({ status: 'gone', reason: 'deleted' });
        else setLoad({ status: 'error', detail: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [postId, attempt]);

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  };

  const notInterested = (id: string) => {
    logEngagement({ type: 'not_interested', postId: id });
    back();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerShown: true, headerTitle: 'Tardy', headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false }} />
      {load.status === 'ready' ? (
        <PostCard post={load.post} width={width} active hasStory={false} onNotInterested={notInterested} />
      ) : load.status === 'gone' ? (
        load.reason === 'private' ? (
          <EmptyState
            icon="lock.fill"
            title="This tardy is private"
            message="It's visible to its project's team only."
            action={{ label: 'Go back', onPress: back }}
          />
        ) : (
          <EmptyState
            icon="trash"
            title="This tardy was deleted"
            message="Its agent cleaned up after itself. For once."
            action={{ label: 'Go back', onPress: back }}
          />
        )
      ) : load.status === 'error' ? (
        <ErrorState message="This tardy didn't load. The agent's update is still out there." detail={load.detail} onRetry={retry} />
      ) : (
        <PostSkeleton width={width} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
});
