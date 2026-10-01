import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '@/state/store';
import { colors } from '@/theme';

import { Icon, PressableScale } from './ui';

/**
 * Suggested tardies waiting for your swipe, next to the alarm on Home. Hidden when there are
 * none; rechecked whenever Home comes back into view.
 */
export function SuggestionsButton() {
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      api
        .postSuggestions()
        .then((list) => live && setCount(list.length))
        .catch(() => {
          // A badge isn't worth a toast; the review screen reports its own errors.
        });
      return () => {
        live = false;
      };
    }, []),
  );

  if (count === 0) return null;
  return (
    <PressableScale onPress={() => router.push('/review')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${count} suggested tardies to review`}>
      <Icon name="rectangle.stack" size={24} />
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
      </View>
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
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: { color: colors.onPrimary, fontSize: 10.5, fontWeight: '800' },
});
