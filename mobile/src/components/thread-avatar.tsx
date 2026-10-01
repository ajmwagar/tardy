import { memo } from 'react';
import { View } from 'react-native';

import type { ThreadRef } from '@/data/types';
import { othersIn } from '@/share/thread-label';
import { useAccount } from '@/state/store';
import { colors } from '@/theme';

import { Avatar } from './ui';

/**
 * A thread's picture: the other person's avatar, or for a group two members overlapped
 * on a diagonal (back one top-left, front one bottom-right, cut out from the background).
 */
export const ThreadAvatar = memo(function ThreadAvatar({
  thread,
  me,
  size,
  background = colors.bg,
}: {
  thread: ThreadRef;
  me: string | undefined;
  size: number;
  background?: string;
}) {
  const [firstId, secondId] = othersIn(thread, me);
  const first = useAccount(firstId);
  const second = useAccount(secondId);
  if (!secondId) return <Avatar account={first} size={size} />;
  const small = Math.round(size * 0.68);
  const cut = Math.max(2, Math.round(size / 24));
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Avatar account={second} size={small} />
      <View
        style={{
          position: 'absolute',
          right: -cut,
          bottom: -cut,
          padding: cut,
          borderRadius: size,
          backgroundColor: background,
        }}>
        <Avatar account={first} size={small} />
      </View>
    </View>
  );
});
