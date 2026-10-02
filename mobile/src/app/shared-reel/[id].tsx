import * as WebBrowser from 'expo-web-browser';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { Icon } from '@/components/ui';
import { VideoSurface } from '@/components/video-surface';
import { useSharedLink } from '@/share/use-shared-link';
import { colors } from '@/theme';

/** Full-screen viewer for a privately cached external reel shared into a conversation. */
export default function SharedReelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [focused, setFocused] = useState(false);
  const insets = useSafeAreaInsets();
  const { link, error } = useSharedLink(id);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerTransparent: true, headerTitle: '', headerTintColor: '#fff' }} />
      {error ? (
        <ErrorState message="This shared reel didn't load." detail={error} onRetry={() => router.back()} retryLabel="Go back" />
      ) : !link || link.status === 'queued' || link.status === 'processing' ? (
        <Pulse style={StyleSheet.absoluteFill}><SkeletonBlock style={StyleSheet.absoluteFill} /></Pulse>
      ) : link.mediaUrl ? (
        <>
          <VideoSurface
            media={{ type: 'video', url: link.mediaUrl, posterUrl: link.thumbnailUrl ?? '', width: 720, height: 1280, durationMs: 0 }}
            active={focused}
            fullBleed
          />
          <View pointerEvents="box-none" style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.copy}>
              {link.title ? <Text style={styles.title}>{link.title}</Text> : null}
              {link.caption ? <Text style={styles.caption} numberOfLines={5}>{link.caption}</Text> : null}
              <Pressable
                style={styles.original}
                onPress={() => void WebBrowser.openBrowserAsync(link.canonicalUrl)}
                accessibilityRole="link"
                accessibilityLabel="View original source">
                <Icon name="safari" size={15} color={colors.text} />
                <Text style={styles.originalText}>View original · {link.provider}</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : (
        <ErrorState
          message="This reel could not be cached."
          detail="The original link is still available."
          onRetry={() => void WebBrowser.openBrowserAsync(link.canonicalUrl)}
          retryLabel="View original"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', paddingHorizontal: 16 },
  copy: { maxWidth: '86%', gap: 8, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 17, lineHeight: 22, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 8 },
  caption: { color: '#fff', fontSize: 13, lineHeight: 18, textShadowColor: '#000', textShadowRadius: 8 },
  original: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7 },
  originalText: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
