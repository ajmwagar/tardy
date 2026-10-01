import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorToast } from '@/components/states';
import { usePushNotifications } from '@/notifications/use-push-notifications';
import { auth, useAuth } from '@/state/auth';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.separator, primary: colors.primary },
};

export default function RootLayout() {
  const [error, setError] = useState<string | null>(null);
  // Gate: signed out → sign-in; signed in, not set up → onboarding; otherwise the app.
  const gate = useAuth((s) => s.status);
  usePushNotifications();

  useEffect(() => {
    auth
      .bootstrap()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => SplashScreen.hideAsync());
  }, []);

  if (error) {
    return (
      <View style={styles.fatal}>
        <Text style={styles.fatalTitle}>Tardy couldn&apos;t start</Text>
        <Text style={styles.fatalDetail}>{error}</Text>
      </View>
    );
  }
  if (gate === 'unknown') return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={gate === 'signed_out'}>
            <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={gate === 'onboarding'}>
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={gate === 'signed_in'}>
          <Stack.Screen
            name="(tabs)"
            options={{ scrollEdgeEffects: { top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" } }}
          />
          <Stack.Screen
            name="profile/[handle]"
            options={{ headerShown: true, headerBackButtonDisplayMode: 'minimal', headerTitle: '', headerShadowVisible: false }}
          />
          <Stack.Screen
            name="messages/[threadId]"
            options={{ headerShown: true, headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false }}
          />
          <Stack.Screen
            name="comments/[postId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.6, 1],
              sheetGrabberVisible: true,
              sheetCornerRadius: 16,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          <Stack.Screen name="stories/[authorId]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="post/[postId]" />
          <Stack.Screen
            name="edit-profile"
            options={{ presentation: 'modal', headerShown: true, headerTitle: 'Edit profile', headerShadowVisible: false }}
          />
          <Stack.Screen
            name="settings"
            options={{ headerShown: true, headerBackButtonDisplayMode: 'minimal', headerTitle: 'Settings', headerShadowVisible: false }}
          />
          </Stack.Protected>
        </Stack>
        <ErrorToast />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fatal: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  fatalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  fatalDetail: { color: colors.textSecondary, textAlign: 'center' },
});
