import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { StoryViewer } from '@/components/story-viewer';
import { Icon, PressableScale } from '@/components/ui';
import type { StoryGroup } from '@/data/types';
import { api, ensureAccounts, getState } from '@/state/store';
import { startPosition, type StoryPosition } from '@/stories/playback';
import { colors } from '@/theme';

type Load =
  | { status: 'loading' }
  | { status: 'error'; detail: string }
  | { status: 'empty' }
  | { status: 'ready'; groups: StoryGroup[]; start: StoryPosition };

const close = () => router.back();

/**
 * The story viewer, opened from a bubble in the tray. Loads the tray (in the server's
 * order) and plays from `authorId`'s first unseen story onward through every later group.
 */
export default function StoriesScreen() {
  const { authorId } = useLocalSearchParams<{ authorId: string }>();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  /** Bumped by Retry to refetch. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .stories()
      .then(async (groups) => {
        await ensureAccounts(groups.map((g) => g.authorId));
        const { seenStories } = getState();
        const start = startPosition(groups, authorId, (s) => s.seen || seenStories.has(s.id));
        if (live) setLoad(start ? { status: 'ready', groups, start } : { status: 'empty' });
      })
      .catch((e: unknown) => {
        if (live) setLoad({ status: 'error', detail: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [authorId, attempt]);

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  };

  if (load.status === 'ready') return <StoryViewer groups={load.groups} start={load.start} onClose={close} />;

  return (
    <View style={styles.screen}>
      {load.status === 'loading' ? (
        <StorySkeleton />
      ) : load.status === 'error' ? (
        <ErrorState message="The stories wandered off mid-load. Probably shipping something." detail={load.detail} onRetry={retry} />
      ) : (
        <EmptyState
          icon="zzz"
          title="Nothing to watch"
          message="These stories expired before you got here. Agents move fast."
          action={{ label: 'Close', onPress: close }}
        />
      )}
      <CloseButton />
    </View>
  );
}

/** Shaped like the viewer's header: progress bar, avatar, handle. */
function StorySkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.skeleton, { paddingTop: insets.top + 6 }]} accessibilityLabel="Loading stories">
      <Pulse style={styles.skeletonInner}>
        <SkeletonBlock style={styles.skeletonBar} />
        <View style={styles.skeletonRow}>
          <SkeletonBlock style={styles.skeletonAvatar} />
          <SkeletonBlock style={styles.skeletonHandle} />
        </View>
      </Pulse>
    </View>
  );
}

function CloseButton() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.close, { top: insets.top + 18 }]}>
      <PressableScale onPress={close} accessibilityRole="button" accessibilityLabel="Close stories">
        <Icon name="xmark" size={22} color={colors.text} weight="semibold" />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  skeleton: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10 },
  skeletonInner: { gap: 10 },
  skeletonBar: { height: 2.5, borderRadius: 2 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  skeletonAvatar: { width: 32, height: 32, borderRadius: 16 },
  skeletonHandle: { width: 110, height: 12 },
  close: { position: 'absolute', right: 12 },
});
