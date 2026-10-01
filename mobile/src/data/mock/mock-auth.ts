import { TardyApiError } from '../api';
import type { AuthCredential, AuthProvider, Session } from '../types';

/**
 * The mock server's auth half: provider identities, sessions, onboarding, and handle
 * claims. `MockTardyApi` delegates to it. State survives relaunch through an injected
 * `MockPersistence` (the app passes the keychain; tests pass memory), standing in for
 * the server's database.
 */

/** One string slot the mock server keeps its database in. */
export type MockPersistence = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
};

/** Mock provider identities (`<provider>:<subject>`) and the Tardy accounts they own. */
export const MOCK_IDENTITIES: Readonly<Record<string, string>> = {
  'github:jamesmerrill': 'me',
  'apple:000123.james': 'me',
};

/**
 * Mock credentials: the code (GitHub) or identity token (Apple) is `mock:<subject>`.
 * A real server verifies these with the provider instead.
 */
export const mockCredential = {
  github: (login: string): AuthCredential => ({
    provider: 'github',
    code: `mock:${login}`,
    codeVerifier: 'mock-verifier',
    redirectUri: 'tardy://auth/github',
  }),
  apple: (subject: string): AuthCredential => ({
    provider: 'apple',
    identityToken: `mock:${subject}`,
    authorizationCode: 'mock-code',
    nonce: 'mock-nonce',
  }),
};

const SESSION_TTL_MS = 90 * 24 * 3_600_000;

type StoredSession = { accountId: string; provider: AuthProvider; expiresAt: string };

type Db = {
  v: 1;
  sessions: Record<string, StoredSession>;
  onboardedAt: Record<string, string>;
  handles: Record<string, string>;
};

const emptyDb = (): Db => ({ v: 1, sessions: {}, onboardedAt: {}, handles: {} });

function unauthenticated(message: string): never {
  throw new TardyApiError('unauthenticated', message);
}

function subjectOf(credential: AuthCredential): string {
  const proof = credential.provider === 'github' ? credential.code : credential.identityToken;
  return proof.startsWith('mock:') ? proof.slice('mock:'.length) : '';
}

export class MockAuthServer {
  private db: Db = emptyDb();
  private loaded: Promise<void> | null = null;
  private current: Session | null = null;

  constructor(
    private readonly persistence: MockPersistence | undefined,
    /** Starts signed in as this account (tests and fixtures); null starts signed out. */
    presetViewerId: string | null,
    private readonly now: () => number = Date.now,
  ) {
    if (presetViewerId) {
      const expiresAt = new Date(this.now() + SESSION_TTL_MS).toISOString();
      this.current = { token: 'preset', accountId: presetViewerId, provider: 'github', expiresAt };
      // A preset viewer is an existing, set-up account.
      this.db.onboardedAt[presetViewerId] = new Date(0).toISOString();
    }
  }

  /** Loads persisted state once; resolves with persisted handle claims to apply. */
  async load(): Promise<Readonly<Record<string, string>>> {
    this.loaded ??= (async () => {
      const raw = await this.persistence?.get();
      if (!raw) return;
      const parsed = JSON.parse(raw) as Db;
      if (parsed.v !== 1) throw new Error(`Mock server state has unknown version ${String(parsed.v)}`);
      this.db = { ...parsed, onboardedAt: { ...this.db.onboardedAt, ...parsed.onboardedAt } };
    })();
    await this.loaded;
    return this.db.handles;
  }

  private async save() {
    await this.persistence?.set(JSON.stringify(this.db));
  }

  /** The signed-in account id; throws `unauthenticated` when signed out, like a 401. */
  get viewerId(): string {
    return (this.current ?? unauthenticated('Not signed in')).accountId;
  }

  get session(): Session | null {
    return this.current;
  }

  async signIn(credential: AuthCredential): Promise<Session> {
    await this.load();
    const accountId = MOCK_IDENTITIES[`${credential.provider}:${subjectOf(credential)}`];
    if (!accountId) unauthenticated(`${credential.provider === 'github' ? 'GitHub' : 'Apple'} rejected the sign-in`);
    const token = `mock-session-${Math.random().toString(36).slice(2)}${this.now().toString(36)}`;
    const stored: StoredSession = {
      accountId,
      provider: credential.provider,
      expiresAt: new Date(this.now() + SESSION_TTL_MS).toISOString(),
    };
    this.db.sessions[token] = stored;
    await this.save();
    this.current = { token, ...stored };
    return this.current;
  }

  async resume(token: string): Promise<Session> {
    await this.load();
    const stored = this.db.sessions[token] ?? unauthenticated('Session not recognized');
    if (Date.parse(stored.expiresAt) <= this.now()) {
      delete this.db.sessions[token];
      await this.save();
      unauthenticated('Session expired');
    }
    this.current = { token, ...stored };
    return this.current;
  }

  async signOut(): Promise<void> {
    const session = this.current ?? unauthenticated('Not signed in');
    delete this.db.sessions[session.token];
    this.current = null;
    await this.save();
  }

  onboardedAt(accountId: string): string | null {
    return this.db.onboardedAt[accountId] ?? null;
  }

  async completeOnboarding(accountId: string): Promise<void> {
    this.db.onboardedAt[accountId] ??= new Date(this.now()).toISOString();
    await this.save();
  }

  async claimHandle(accountId: string, handle: string): Promise<void> {
    this.db.handles[accountId] = handle;
    await this.save();
  }
}
