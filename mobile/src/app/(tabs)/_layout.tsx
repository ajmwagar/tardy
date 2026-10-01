import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';

import { refreshUnread, useAccount, useStore } from '@/state/store';
import { colors } from '@/theme';

/** Icon-only tabs: Home, Reels, Messages, Alarms (notifications), Profile. */
export default function TabsLayout() {
  const me = useAccount('me');
  const unread = useStore((s) => s.unread);

  useEffect(() => {
    void refreshUnread();
  }, []);

  return (
    <NativeTabs backgroundColor={colors.bg} tintColor={colors.primary}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reels" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.square.stack', selected: 'play.square.stack.fill' }} />
        <NativeTabs.Trigger.Label hidden>Reels</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label hidden>Messages</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread.messages === 0}>{String(unread.messages)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Icon sf={{ default: 'alarm', selected: 'alarm.fill' }} />
        <NativeTabs.Trigger.Label hidden>Notifications</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread.notifications === 0}>{String(unread.notifications)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <NativeTabs.Trigger.Label hidden>{me?.handle ?? 'Profile'}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
