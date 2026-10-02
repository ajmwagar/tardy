import * as SecureStore from 'expo-secure-store';

/**
 * One keychain (iOS) / Keystore-backed (Android) string slot. Readable after first
 * unlock so background work (push) can use the session; never synced to other devices
 * or restored from backups.
 */
export function keychainSlot(key: string) {
  const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
  return {
    get: () => SecureStore.getItemAsync(key, options),
    set: (value: string) => SecureStore.setItemAsync(key, value, options),
    clear: () => SecureStore.deleteItemAsync(key, options),
  };
}

/** The signed-in session's token: the only auth state the client persists. */
const previewIdentity = process.env.EXPO_PUBLIC_TARDY_DEV_EMAIL?.trim().toLowerCase();
const previewKey = previewIdentity?.replace(/[^a-z0-9._-]/g, '_');
export const sessionTokenStorage = keychainSlot(__DEV__ && previewKey ? `tardy.session.dev.${previewKey}` : 'tardy.session');
