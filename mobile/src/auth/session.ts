import { TardyApiError, type TardyApi } from '@/data/api';
import type { AuthCredential, AuthProvider, SignedIn } from '@/data/types';

/**
 * The auth state machine the root layout gates on:
 *
 *   unknown ──bootstrap──▶ signed_out ──signIn──▶ onboarding ──completeOnboarding──▶ signed_in
 *                 │            ▲  ▲                    │                                  │
 *                 └─(stored    │  └────── signOut ─────┴──────────────────────────────────┘
 *                    token)────┘ (expired/revoked)
 *
 * A stored token resumes straight to `onboarding` or `signed_in`. Failures surface as
 * `error` on `signed_out`; only unexpected failures during bootstrap (keychain broken,
 * server down) reject, so the root layout's fatal screen shows them.
 *
 * Pure TypeScript: the API, token storage, and identity provider are injected.
 */

export type AuthState =
  | { status: 'unknown' }
  | { status: 'signed_out'; signingIn: boolean; error: string | null }
  | { status: 'onboarding'; signedIn: SignedIn }
  | { status: 'signed_in'; signedIn: SignedIn };

/** Where the session token lives between launches. The app uses the keychain. */
export type TokenStorage = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

/**
 * Gets a one-time credential from a provider (browser round trip, native sheet).
 * Resolves null when the person cancels.
 */
export type IdentityProvider = {
  authorize(provider: AuthProvider): Promise<AuthCredential | null>;
};

export type AuthDeps = {
  api: Pick<TardyApi, 'signIn' | 'developmentSession' | 'resumeSession' | 'signOut' | 'completeOnboarding'>;
  storage: TokenStorage;
  identity: IdentityProvider;
  /** Loads per-viewer client state (account, follows). Runs before any gated screen shows. */
  onSignedIn(signedIn: SignedIn): Promise<void>;
  /**
   * Last calls the outgoing session makes before it is revoked (flush logs, unregister
   * push). A failure here is reported, but never keeps the person signed in.
   */
  beforeSignOut?(): Promise<void>;
  /** Drops per-viewer client state. */
  onSignedOut(): void | Promise<void>;
};

export type Auth = ReturnType<typeof createAuth>;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isUnauthenticated = (error: unknown) => error instanceof TardyApiError && error.code === 'unauthenticated';

export function createAuth(deps: AuthDeps) {
  let state: AuthState = { status: 'unknown' };
  const listeners = new Set<() => void>();

  const set = (next: AuthState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const signedOut = (error: string | null = null): AuthState => ({ status: 'signed_out', signingIn: false, error });

  /** Stores the (possibly rotated) token, loads viewer state, then opens the right gate. */
  async function enter(signedIn: SignedIn) {
    await deps.storage.set(signedIn.session.token);
    await deps.onSignedIn(signedIn);
    set({ status: signedIn.onboardedAt ? 'signed_in' : 'onboarding', signedIn });
  }

  async function restore(): Promise<void> {
    const token = await deps.storage.get();
    if (!token) return set(signedOut());
    let signedIn: SignedIn;
    try {
      signedIn = await deps.api.resumeSession(token);
    } catch (error) {
      if (!isUnauthenticated(error)) throw error;
      await deps.storage.clear();
      return set(signedOut(`You were signed out: ${describe(error)}.`));
    }
    await enter(signedIn);
  }

  /**
   * Shared by every sign-in method: obtain a credential (null = the user cancelled),
   * exchange it, enter. Failures land on the sign-in screen with the reason.
   */
  async function attempt(getCredential: () => Promise<AuthCredential | null>): Promise<void> {
    if (state.status !== 'signed_out') throw new Error(`Can't sign in from ${state.status}`);
    if (state.signingIn) return;
    set({ status: 'signed_out', signingIn: true, error: null });
    try {
      const credential = await getCredential();
      if (!credential) return set(signedOut());
      await enter(await deps.api.signIn(credential));
    } catch (error) {
      // `enter` may have stored the token before failing; don't resume a half sign-in.
      try {
        await deps.storage.clear();
      } finally {
        set(signedOut(`Sign-in failed: ${describe(error)}`));
      }
    }
  }

  let booting: Promise<void> | null = null;

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * Restores the stored session, if any. Idempotent: repeat calls (fast refresh, React
     * re-running effects) get the same promise, so it settles once per launch.
     */
    bootstrap(): Promise<void> {
      booting ??= restore();
      return booting;
    },

    /** One-tap providers (GitHub, Apple, Google, X): runs the provider's sheet, then signs in. */
    signIn(provider: AuthProvider): Promise<void> {
      return attempt(() => deps.identity.authorize(provider));
    },

    /** Passwordless email, with the code `api.requestEmailCode(email)` sent. */
    signInWithEmail(email: string, code: string): Promise<void> {
      return attempt(async () => ({ provider: 'email', email, code }));
    },

    /**
     * Developer bypass for testing: the normal `signIn`, then `completeOnboarding` with the
     * defaults, landing on the feed in one tap. No new credential type and no server
     * special case, so it only works where `signIn` itself succeeds without a real provider
     * (the mock backend); callers decide whether to offer it.
     */
    async signInForDevelopment(): Promise<void> {
      if (state.status !== 'signed_out' || state.signingIn) return;
      set({ status: 'signed_out', signingIn: true, error: null });
      try {
        await enter(await deps.api.developmentSession());
        if ((state as AuthState).status === 'onboarding') await this.completeOnboarding();
      } catch (error) {
        try {
          await deps.storage.clear();
        } finally {
          set(signedOut(`Preview sign-in failed: ${describe(error)}`));
        }
      }
    },

    /** Finishes onboarding. Rejects (staying in onboarding) if the server refuses. */
    async completeOnboarding(): Promise<void> {
      if (state.status !== 'onboarding') throw new Error(`Can't finish onboarding from ${state.status}`);
      const signedIn = await deps.api.completeOnboarding();
      if (!signedIn.onboardedAt) throw new Error('Server did not record onboarding as complete');
      set({ status: 'signed_in', signedIn });
    },

    /**
     * Always signs out on this device. If the server could not revoke the session, says so
     * on the sign-in screen rather than pretending it did.
     */
    async signOut(): Promise<void> {
      if (state.status !== 'onboarding' && state.status !== 'signed_in') throw new Error(`Can't sign out from ${state.status}`);
      const problems: string[] = [];
      for (const step of [deps.beforeSignOut, () => deps.api.signOut()]) {
        try {
          await step?.();
        } catch (error) {
          if (!isUnauthenticated(error)) problems.push(describe(error));
        }
      }
      await deps.storage.clear();
      await deps.onSignedOut();
      set(signedOut(problems.length ? `Signed out on this device, but the server didn't confirm: ${problems.join('; ')}` : null));
    },
  };
}
