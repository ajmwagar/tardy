import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

export default function Screen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>messages</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textSecondary },
});
