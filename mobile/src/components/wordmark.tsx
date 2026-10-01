import { Text, View } from 'react-native';

import { colors, type } from '@/theme';

/**
 * The lowercase rounded "tardy" wordmark with its red dot, as in the home header.
 * `scale` grows it for the sign-in screen.
 */
export function Wordmark({ scale = 1 }: { scale?: number }) {
  const dot = 8 * scale;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 * scale }}>
      <Text style={[type.wordmark, { fontSize: type.wordmark.fontSize * scale, letterSpacing: type.wordmark.letterSpacing * scale }]}>
        tardy
      </Text>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: colors.alarm, marginBottom: dot }} />
    </View>
  );
}
