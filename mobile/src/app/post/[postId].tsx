import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { PostCard } from '@/components/post-card';
import { TardyApiError } from '@/data/api';
import type { Post } from '@/data/types';
import { api, ensureAccounts, ingestPosts, logEngagement } from '@/state/store';
import { colors } from '@/theme';

/**
 * One post on its own: where a tapped work notification (shipped, blocked, review
 * requested) lands, so its status and PR/issue links are front and center.
 */
export default function PostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { width } = useWindowDimensions();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .post(postId)
      .then(async (p) => {
        await ensureAccounts([p.authorId, p.projectId]);
        ingestPosts([p]);
        if (live) setPost(p);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(
          e instanceof TardyApiError
            ? e.code === 'forbidden'
              ? 'This post is private.'
              : 'This post was deleted.'
            : e instanceof Error
              ? e.message
              : String(e),
        );
      });
    return () => {
      live = false;
    };
  }, [postId]);

  const notInterested = (id: string) => {
    logEngagement({ type: 'not_interested', postId: id });
    router.back();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerShown: true, headerTitle: 'Post', headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false }} />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : post ? (
        <PostCard post={post} width={width} active hasStory={false} onNotInterested={notInterested} />
      ) : (
        <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 40 }} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  error: { color: colors.alarm, textAlign: 'center', marginTop: 40 },
});
