import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { badgeText } from '@/notifications/tray';
import { useStore } from '@/state/store';
import { colors } from '@/theme';

import { Icon, PressableScale } from './ui';

/**
 * Notifications, at the top right of every tab (Instagram's heart; Tardy's alarm), with the
 * unread count. Opens Activity.
 */
export function ActivityButton({ color = colors.text, badgeBorder = colors.bg }: { color?: string; badgeBorder?: string }) {
  const count = useStore((s) => s.unread.notifications);
  const label = badgeText(count);
  return (
    <PressableScale
      onPress={() => router.push('/notifications')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label ? `Activity, ${label} new` : 'Activity'}>
      <Icon name="alarm" size={25} color={color} />
      {label ? (
        <View style={[styles.badge, { borderColor: badgeBorder }]}>
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.alarm,
    borderWidth: 2,
  },
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
