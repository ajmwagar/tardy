import { useSyncExternalStore } from 'react';

import { keychainSlot } from '@/auth/keychain';

/**
 * This device's app preferences (Settings > App): not account settings, so they stay on the
 * phone. Loaded once at startup; a failed read or write keeps the defaults and says so in the
 * console rather than blocking the app.
 */
export type AppPrefs = {
  /** The light taps on likes, tabs and toggles. */
  haptics: boolean;
  /** Feed and reel videos start on their own. Off: tap to play. */
  autoplay: boolean;
};

export const DEFAULT_APP_PREFS: AppPrefs = { haptics: true, autoplay: true };

const slot = keychainSlot('tardy.app-prefs');
let prefs: AppPrefs = DEFAULT_APP_PREFS;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Parses stored prefs, ignoring unknown or mistyped keys so an old app version can't break a new one. */
export function parsePrefs(raw: string | null): AppPrefs {
  if (!raw) return DEFAULT_APP_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_APP_PREFS;
    const v = value as Record<string, unknown>;
    return {
      haptics: typeof v.haptics === 'boolean' ? v.haptics : DEFAULT_APP_PREFS.haptics,
      autoplay: typeof v.autoplay === 'boolean' ? v.autoplay : DEFAULT_APP_PREFS.autoplay,
    };
  } catch {
    return DEFAULT_APP_PREFS;
  }
}

export async function loadAppPrefs(): Promise<void> {
  try {
    prefs = parsePrefs(await slot.get());
    emit();
  } catch (e) {
    console.warn(`[app-prefs] couldn't read preferences, using defaults: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const appPrefs = () => prefs;

export function setAppPref<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]): void {
  prefs = { ...prefs, [key]: value };
  emit();
  slot.set(JSON.stringify(prefs)).catch((e: unknown) => console.warn(`[app-prefs] couldn't save: ${e instanceof Error ? e.message : String(e)}`));
}

export function useAppPrefs(): AppPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
