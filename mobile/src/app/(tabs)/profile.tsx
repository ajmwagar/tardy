import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityButton } from '@/components/activity-button';
import { ProfileView } from '@/components/profile-view';
import { IconButton } from '@/components/ui';
import { useAccount } from '@/state/store';
import { colors, type } from '@/theme';

export default function MyProfileScreen() {
  const insets = useSafeAreaInsets();
  const me = useAccount('me');
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text style={type.title} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">{me?.handle}</Text>
        <View style={styles.actions}>
          <ActivityButton />
          {/* ☰ opens Settings and privacy directly, like Instagram; log out lives at its bottom. */}
          <IconButton icon="line.3.horizontal" label="Settings and privacy" onPress={() => router.push('/settings')} style={styles.edgeButton} />
        </View>
      </View>
      {me && <ProfileView account={me} isMe />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  edgeButton: { marginRight: -10 },
});
