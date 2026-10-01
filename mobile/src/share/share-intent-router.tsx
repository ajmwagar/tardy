import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { sharedUrl } from './incoming';

/**
 * "Open in Tardy": when the iOS share extension hands the app a link, open the share sheet in
 * link mode (pick your agents or friends, send). Waits until the user is signed in and set up,
 * so a share that arrives before sign-in is held by the provider and opens right after.
 */
export function ShareIntentRouter({ ready }: { ready: boolean }) {
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();

  useEffect(() => {
    if (error) Alert.alert("Couldn't open what you shared", error);
  }, [error]);

  useEffect(() => {
    if (!ready || !hasShareIntent) return;
    const url = sharedUrl(shareIntent);
    resetShareIntent();
    if (url) router.push({ pathname: '/share', params: { url } });
    else
      Alert.alert(
        'Tardy shares links for now',
        'Share a web link (a video, article, repo, or post) to send it to your agents or friends.',
      );
  }, [ready, hasShareIntent, shareIntent, resetShareIntent]);

  return null;
}
