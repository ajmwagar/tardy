import { router } from 'expo-router';
import { memo, useState } from 'react';
import { ActionSheetIOS, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { openWebCheckout } from '@/config';
import type { StoryGroup } from '@/data/types';
import { useAccount, useStore } from '@/state/store';
import { isGroupBoosted } from '@/stories/boost';
import { colors } from '@/theme';

import { Avatar, Hairline, Icon, type RingState } from './ui';

const openViewer = (authorId: string) => router.push({ pathname: '/stories/[authorId]', params: { authorId } });

/**
 * Boosted beats seen: a paid boost keeps its red ring until it expires. Expiry is checked
 * against the time the bubble mounted; the tray reloads (and the server reorders it) on refresh.
 */
function useRing(group: StoryGroup): RingState {
  const seen = useStore((s) => group.stories.every((st) => st.seen || s.seenStories.has(st.id)));
  const [now] = useState(Date.now);
  if (isGroupBoosted(group, now)) return 'boosted';
  return seen ? 'seen' : 'unseen';
}

const StoryBubble = memo(function StoryBubble({ group }: { group: StoryGroup }) {
  const account = useAccount(group.authorId);
  const ring = useRing(group);
  return (
    <Pressable style={styles.bubble} onPress={() => openViewer(group.authorId)}>
      <Avatar account={account} size={66} ring={ring} />
      <Text style={[styles.label, ring === 'seen' && styles.labelSeen]} numberOfLines={1}>
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

export const StoriesRow = memo(function StoriesRow({ groups }: { groups: StoryGroup[] }) {
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
