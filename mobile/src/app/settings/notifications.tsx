import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationSettings } from '@/components/notification-settings';
import { colors } from '@/theme';

/** Settings > Notifications: the push and alarm settings, on their own screen. */
export default function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
      <NotificationSettings />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.bg } });
