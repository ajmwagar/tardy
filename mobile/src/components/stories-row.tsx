import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { openWebCheckout } from '@/config';
import type { Story, StoryGroup } from '@/data/types';
import { useAccount, useStore } from '@/state/store';
import { isGroupBoosted, isGroupSeen, orderStoryTray } from '@/stories/boost';
import { colors } from '@/theme';

import { Avatar, Hairline, Icon, type RingState } from './ui';

const openViewer = (authorId: string) => router.push({ pathname: '/stories/[authorId]', params: { authorId } });

/** Seen = seen on the server or watched on this device since the tray loaded. */
function useIsSeen(): (story: Story) => boolean {
  const watched = useStore((s) => s.seenStories);
  return useCallback((story: Story) => story.seen || watched.has(story.id), [watched]);
}

/**
 * Red for a live paid boost, grey otherwise; both darken once watched. Expiry is checked
 * against the time the bubble mounted; the tray reloads (and the server reorders it) on refresh.
 */
function useRing(group: StoryGroup): RingState {
  const seen = isGroupSeen(group, useIsSeen());
  const [now] = useState(Date.now);
  if (isGroupBoosted(group, now)) return seen ? 'boostedSeen' : 'boosted';
  return seen ? 'seen' : 'unseen';
}

const StoryBubble = memo(function StoryBubble({ group }: { group: StoryGroup }) {
  const account = useAccount(group.authorId);
  const ring = useRing(group);
  return (
    <Pressable style={styles.bubble} onPress={() => openViewer(group.authorId)}>
      <Avatar account={account} size={66} ring={ring} />
      <Text style={[styles.label, (ring === 'seen' || ring === 'boostedSeen') && styles.labelSeen]} numberOfLines={1}>
        {account?.handle}
      </Text>
    </Pressable>
  );
});

/** Long-press on your own bubble: the way in to buying a boost (checkout is on the website). */
function openYourStoryMenu() {
  ActionSheetIOS.showActionSheetWithOptions({ options: ['Boost my story', 'Cancel'], cancelButtonIndex: 1 }, (index) => {
    if (index === 0) void openWebCheckout('boost');
  });
}

function YourStoryAvatar({ group }: { group: StoryGroup }) {
  const me = useAccount('me');
  return <Avatar account={me} size={66} ring={useRing(group)} />;
}

/** Your bubble: opens your stories when you have some; long-press to boost them. */
function YourStory({ group }: { group: StoryGroup | undefined }) {
  const me = useAccount('me');
  return (
    <Pressable
      style={styles.bubble}
      onPress={group ? () => openViewer('me') : undefined}
      onLongPress={openYourStoryMenu}
      accessibilityRole="button"
      accessibilityLabel="Your story"
      accessibilityHint="Long-press to boost your story">
      <View style={styles.yourStory}>
        {group ? <YourStoryAvatar group={group} /> : <Avatar account={me} size={70} />}
        <View style={styles.plus}>
          <Icon name="plus" size={12} color="#fff" weight="bold" />
        </View>
      </View>
      <Text style={[styles.label, styles.labelSeen]}>Your story</Text>
    </Pressable>
  );
}

export const StoriesRow = memo(function StoriesRow({ groups: serverOrder }: { groups: StoryGroup[] }) {
  // Re-apply the server's ordering rule with what was watched here, so a group moves to the
  // back the moment you finish it rather than on the next refresh.
  const isSeen = useIsSeen();
  const [now] = useState(Date.now);
  const groups = useMemo(() => orderStoryTray(serverOrder, now, isSeen), [serverOrder, now, isSeen]);
  const mine = groups.find((g) => g.authorId === 'me');
  return (
    <View>
      <FlatList
        data={mine ? groups.filter((g) => g !== mine) : groups}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(g) => g.authorId}
        ListHeaderComponent={<YourStory group={mine} />}
        renderItem={({ item }) => <StoryBubble group={item} />}
        contentContainerStyle={styles.row}
      />
      <Hairline />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 8, paddingVertical: 10, gap: 4 },
  bubble: { width: 82, alignItems: 'center', gap: 5 },
  yourStory: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center' },
  plus: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    borderWidth: 2.5,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: colors.text, fontSize: 11.5, maxWidth: 76 },
  labelSeen: { color: colors.textSecondary },
});
