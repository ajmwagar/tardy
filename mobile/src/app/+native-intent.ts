import { getShareExtensionKey } from 'expo-share-intent';

/**
 * The share extension opens the app with a deep link that only signals "something was
 * shared"; the item itself comes from the native module (`ShareIntentRouter` in `_layout`).
 * Send that link to the feed instead of a route that doesn't exist; everything else passes.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return path.includes(`dataUrl=${getShareExtensionKey()}`) ? '/' : path;
  } catch {
    // The native module is missing (Expo Go): no share extension, so nothing to redirect.
    return path;
  }
}
