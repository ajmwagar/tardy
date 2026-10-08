import { useSyncExternalStore } from 'react';

import { sessionTokenStorage } from '@/auth/keychain';
import { createAuth, type AuthState } from '@/auth/session';
import { mockIdentity } from '@/data/mock/mock-identity';
import { createNativeIdentity } from '@/auth/native-identity';
import { unregisterPush } from '@/notifications/push';

import { api, bootstrap, flushEngagement, resetViewerState, usesMockBackend } from './store';

/** The app's auth instance; `_layout.tsx` gates on its state. */
export const auth = createAuth({
  api,
  storage: sessionTokenStorage,
  identity: usesMockBackend ? mockIdentity : createNativeIdentity((challenge, link) => api.beginGithubSignIn(challenge, link)),
  onSignedIn: () => bootstrap(),
  // While the outgoing session can still authenticate: send its engagement log, and
  // unregister this device's push token so the next person here gets none of its pushes.
  beforeSignOut: async () => {
    await Promise.all([flushEngagement(), unregisterPush()]);
  },
  onSignedOut: resetViewerState,
});

export function useAuth<T = AuthState>(select: (s: AuthState) => T = (s) => s as T): T {
  return useSyncExternalStore(auth.subscribe, () => select(auth.getState()));
}
