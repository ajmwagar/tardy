import { router } from 'expo-router';
import { ActionSheetIOS, Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileView } from '@/components/profile-view';
import { IconButton } from '@/components/ui';
import { auth } from '@/state/auth';
import { reportError, useAccount } from '@/state/store';
import { colors, type } from '@/theme';

/** The ☰ menu: Settings, or sign out (confirmed, since it ends this device's session). */
function openMenu() {
  ActionSheetIOS.showActionSheetWithOptions(
    { options: ['Settings', 'Sign out', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
    (index) => {
      if (index === 0) router.push('/settings');
      if (index === 1) {
        Alert.alert('Sign out of Tardy?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign out',
            style: 'destructive',
            onPress: () => {
              auth.signOut().catch((e: unknown) => reportError(`Sign-out failed: ${e instanceof Error ? e.message : String(e)}`));
            },
          },
        ]);
      }
    },
  );
}

export default function MyProfileScreen() {
  const insets = useSafeAreaInsets();
  const me = useAccount('me');
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text style={type.title}>{me?.handle}</Text>
        <IconButton icon="line.3.horizontal" label="Menu" onPress={openMenu} style={styles.edgeButton} />
      </View>
      {me && <ProfileView account={me} isMe />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  edgeButton: { marginRight: -10 },
});
