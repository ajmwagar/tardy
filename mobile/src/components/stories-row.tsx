import { router } from 'expo-router';
import { memo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Story } from '@/data/types';
import { useAccount, useStore } from '@/state/store';
import { colors } from '@/theme';

import { Avatar, Hairline, Icon } from './ui';

export type StoryGroup = { authorId: string; stories: Story[] };

const StoryBubble = memo(function StoryBubble({ group }: { group: StoryGroup }) {
  const account = useAccount(group.authorId);
  const seen = useStore((s) => group.stories.every((st) => st.seen || s.seenStories.has(st.id)));
  return (
    <Pressable
      style={styles.bubble}
      onPress={() => router.push({ pathname: '/stories/[authorId]', params: { authorId: group.authorId } })}>
      <Avatar account={account} size={66} ring={seen ? 'seen' : 'unseen'} />
      <Text style={[styles.label, seen && styles.labelSeen]} numberOfLines={1}>
        {account?.handle}
      </Text>
    </Pressable>
  );
});

function YourStory() {
  const me = useAccount('me');
  return (
    <View style={styles.bubble}>
      <View style={styles.yourStory}>
        <Avatar account={me} size={70} />
        <View style={styles.plus}>
          <Icon name="plus" size={12} color="#fff" weight="bold" />
        </View>
      </View>
      <Text style={[styles.label, styles.labelSeen]}>Your story</Text>
    </View>
  );
}

export const StoriesRow = memo(function StoriesRow({ groups }: { groups: StoryGroup[] }) {
  return (
    <View>
      <FlatList
        data={groups}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(g) => g.authorId}
        ListHeaderComponent={YourStory}
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
    backgroundColor: colors.accent,
    borderWidth: 2.5,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: colors.text, fontSize: 11.5, maxWidth: 76 },
  labelSeen: { color: colors.textSecondary },
});
