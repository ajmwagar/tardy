import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect, useState } from 'react';

import { api, useAccount } from '@/state/store';
import { colors } from '@/theme';

/** Instagram's tab order, icon-only: Home, Reels, Messages, Notifications, Profile. */
export default function TabsLayout() {
  const me = useAccount('me');
  const [unread, setUnread] = useState({ messages: 0, notifications: 0 });

  useEffect(() => {
    Promise.all([api.threads(), api.notifications()]).then(([threads, notifications]) =>
      setUnread({
        messages: threads.reduce((n, t) => n + t.unreadCount, 0),
        notifications: notifications.filter((n) => !n.read).length,
      }),
    );
  }, []);

  return (
    <NativeTabs backgroundColor={colors.bg} tintColor={colors.text}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reels" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.rectangle', selected: 'play.rectangle.fill' }} />
        <NativeTabs.Trigger.Label hidden>Reels</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
        <NativeTabs.Trigger.Label hidden>Messages</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread.messages === 0}>{String(unread.messages)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Icon sf={{ default: 'heart', selected: 'heart.fill' }} />
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
