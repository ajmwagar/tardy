import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, FlatList, StyleSheet, Text, View } from 'react-native';

import { openWebCheckout } from '@/config';
import type { Story, StoryGroup } from '@/data/types';
import { useAccount, useStore } from '@/state/store';
import { BOOSTED_LABEL, isGroupBoosted, isGroupSeen, orderStoryTray, storyBubbleLabel, isGroupCloseFriends } from '@/stories/boost';
import { colors } from '@/theme';

import { Avatar, Hairline, Icon, PressableScale, type RingState } from './ui';

const openViewer = (authorId: string) => router.push({ pathname: '/stories/[authorId]', params: { authorId } });

/** Seen = seen on the server or watched on this device since the tray loaded. */
function useIsSeen(): (story: Story) => boolean {
  const watched = useStore((s) => s.seenStories);
  return useCallback((story: Story) => story.seen || watched.has(story.id), [watched]);
}

/**
 * Red for a live paid boost, grey otherwise; both darken once watched. Expiry is checked
 * against the time the bubble mounted; the tray reloads (and the server reorders it) on refresh.
 * No group (you have no stories): no ring.
 */
function useRing(group: StoryGroup | undefined): RingState {
  const isSeen = useIsSeen();
  const [now] = useState(Date.now);
  if (!group) return 'none';
  const seen = isGroupSeen(group, isSeen);
  if (isGroupBoosted(group, now)) return seen ? 'boostedSeen' : 'boosted';
  if (isGroupCloseFriends(group)) return seen ? 'closeFriendsSeen' : 'closeFriends';
  return seen ? 'seen' : 'unseen';
}

const isBoosted = (ring: RingState) => ring === 'boosted' || ring === 'boostedSeen';
const isSeenRing = (ring: RingState) => ring === 'seen' || ring === 'boostedSeen' || ring === 'closeFriendsSeen';

/** The paid-placement disclosure under a boosted bubble: the red ring alone is not one. */
function BoostedLabel() {
  return (
    <Text style={styles.boosted} numberOfLines={1} maxFontSizeMultiplier={1.4}>
      {BOOSTED_LABEL}
    </Text>
  );
}

const StoryBubble = memo(function StoryBubble({ group }: { group: StoryGroup }) {
  const account = useAccount(group.authorId);
  const ring = useRing(group);
  const boosted = isBoosted(ring);
  const seen = isSeenRing(ring);
  return (
    <PressableScale
      style={styles.bubble}
      scaleTo={0.95}
      onPress={() => openViewer(group.authorId)}
      accessibilityRole="button"
      accessibilityLabel={storyBubbleLabel(account?.handle, { boosted, seen })}>
      <Avatar account={account} size={66} ring={ring} />
      <Text style={[styles.label, seen && styles.labelSeen]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {account?.handle}
      </Text>
      {boosted && <BoostedLabel />}
    </PressableScale>
  );
});

/** Long-press on your own bubble: the way in to buying a boost (checkout is on the website). */
function openYourStoryMenu() {
  ActionSheetIOS.showActionSheetWithOptions({ options: ['Boost my story', 'Cancel'], cancelButtonIndex: 1 }, (index) => {
    if (index === 0) void openWebCheckout('boost');
  });
}

/** Your bubble: opens your stories when you have some; long-press to boost them. */
function YourStory({ group }: { group: StoryGroup | undefined }) {
  const me = useAccount('me');
  const ring = useRing(group);
  return (
    <PressableScale
      style={styles.bubble}
      scaleTo={0.95}
      onPress={group ? () => openViewer('me') : undefined}
      onLongPress={openYourStoryMenu}
      accessibilityRole="button"
      accessibilityLabel={isBoosted(ring) ? `Your story, ${BOOSTED_LABEL}` : 'Your story'}
      accessibilityHint="Long-press to boost your story">
      <View style={styles.yourStory}>
        {group ? <Avatar account={me} size={66} ring={ring} /> : <Avatar account={me} size={70} />}
        <View style={styles.plus}>
          <Icon name="plus" size={12} color="#fff" weight="bold" />
        </View>
      </View>
      <Text style={[styles.label, styles.labelSeen]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        Your story
      </Text>
      {isBoosted(ring) && <BoostedLabel />}
    </PressableScale>
  );
}

const renderBubble = ({ item }: { item: StoryGroup }) => <StoryBubble group={item} />;
const keyOf = (g: StoryGroup) => g.authorId;

export const StoriesRow = memo(function StoriesRow({ groups: serverOrder }: { groups: StoryGroup[] }) {
  // Re-apply the server's ordering rule with what was watched here, so a group moves to the
  // back the moment you finish it rather than on the next refresh.
  const isSeen = useIsSeen();
  const [now] = useState(Date.now);
  const groups = useMemo(() => orderStoryTray(serverOrder, now, isSeen), [serverOrder, now, isSeen]);
  const mine = groups.find((g) => g.authorId === 'me');
  const others = useMemo(() => (mine ? groups.filter((g) => g !== mine) : groups), [groups, mine]);
  return (
    <View>
      <FlatList
        data={others}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={keyOf}
        ListHeaderComponent={<YourStory group={mine} />}
        renderItem={renderBubble}
        contentContainerStyle={styles.row}
      />
      <Hairline />
    </View>
  );
});

const styles = StyleSheet.create({
  // The bottom padding holds the Boosted line, so a boost arriving never changes the tray's height.
  row: { paddingHorizontal: 8, paddingTop: 10, paddingBottom: 14, gap: 4 },
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
  boosted: { position: 'absolute', bottom: -13, color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
});
