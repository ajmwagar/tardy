import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileView } from '@/components/profile-view';
import { Icon, PressableScale } from '@/components/ui';
import { useAccount } from '@/state/store';
import { colors, type } from '@/theme';

export default function MyProfileScreen() {
  const insets = useSafeAreaInsets();
  const me = useAccount('me');
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text style={type.title}>{me?.handle}</Text>
        <PressableScale onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings"><Icon name="line.3.horizontal" size={24} /></PressableScale>
      </View>
      {me && <ProfileView account={me} isMe />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
});
