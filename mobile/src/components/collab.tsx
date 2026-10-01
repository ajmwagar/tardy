import { router } from 'expo-router';
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native';

import { collabLabel, creditedIds } from '@/data/collab';
import type { Account, Post } from '@/data/types';
import { useAccount, useStore } from '@/state/store';
import { colors } from '@/theme';

import { Avatar } from './ui';

const openProfile = (account: Account | undefined) =>
  account && router.push({ pathname: '/profile/[handle]', params: { handle: account.handle } });

/**
 * The header for a collab tardy: two overlapped avatars and "a and b". Tapping it lists
 * everyone credited, so each collaborator's profile is one tap away.
 */
export function CollabHeader({ post, subtitle }: { post: Post; subtitle?: string }) {
  const accounts = useStore((s) => s.accounts);
  const author = useAccount(post.authorId);
  const second = useAccount(post.collaboratorIds?.[0]);
  const credited = creditedIds(post).flatMap((id) => accounts.get(id) ?? []);
  const label = collabLabel(credited.map((a) => a.handle));

  const choose = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Made together by', options: ['Cancel', ...credited.map((a) => a.handle)], cancelButtonIndex: 0 },
      (i) => i > 0 && openProfile(credited[i - 1]),
    );

  return (
    <Pressable
      style={styles.row}
      onPress={choose}
      accessibilityRole="button"
      accessibilityLabel={`${label}, collab. Choose a profile`}>
      <View style={styles.avatars}>
        <Avatar account={second} size={24} />
        <View style={styles.front}>
          <Avatar account={author} size={24} />
        </View>
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatars: { width: 32, height: 32 },
  front: { position: 'absolute', right: -2, bottom: -2, padding: 2, borderRadius: 16, backgroundColor: colors.surface },
  text: { flex: 1, justifyContent: 'center' },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
});
