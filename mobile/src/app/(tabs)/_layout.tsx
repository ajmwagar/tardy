import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useCallback, useEffect, useRef } from 'react';

import { haptic } from '@/components/ui';
import { badgeText } from '@/notifications/tray';
import { refreshUnread, useAccount, useStore } from '@/state/store';
import { colors } from '@/theme';
import { emitTabReselect } from '@/navigation/tab-reselect';

/**
 * Icon-only tabs: Home, Reels, Search (the middle), Messages, Profile. Notifications live
 * behind the alarm at the top right of Home, with its own unread badge.
 */
export default function TabsLayout() {
  const me = useAccount('me');
  const unread = useStore((s) => s.unread);

  useEffect(() => {
    void refreshUnread();
  }, []);

  // A selection tick when the tab actually changes; re-tapping the current tab stays silent.
  const current = useRef<string | null>(null);
  const listeners = useCallback(
    ({ route }: { route: { name: string } }) => ({
      focus: () => {
        current.current = route.name;
      },
      tabPress: (e: { data: { isPrevented: boolean } }) => {
        if (e.data.isPrevented) return;
        if (current.current === route.name) emitTabReselect(route.name);
        else haptic.selection();
      },
    }),
    [],
  );

  return (
    <NativeTabs backgroundColor={colors.bg} tintColor={colors.primary} screenListeners={listeners}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reels" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.square.stack', selected: 'play.square.stack.fill' }} />
        <NativeTabs.Trigger.Label hidden>Reels</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Icon sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }} />
        <NativeTabs.Trigger.Label hidden>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label hidden>Messages</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread.messages === 0}>{badgeText(unread.messages)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <NativeTabs.Trigger.Label hidden>{me?.handle ?? 'Profile'}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
