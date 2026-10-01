import type { TardyApi } from '../api';
import type { Page, Post } from '../types';

/**
 * Dev-only fault injection: a decorator over any `TardyApi` that adds latency, throws on
 * demand, empties feeds, or breaks video URLs, so every loading/empty/error state in the
 * app can be shown without touching the network or the mock itself.
 *
 * Off by default. In production builds the switch is constructed unavailable
 * (`__DEV__` is false), `withFaults` returns the wrapped API untouched (no proxy is ever
 * installed), and `FaultSwitch.set` throws. There is no code path that turns it on.
 *
 * Errors the wrapped API throws itself (e.g. `TardyApiError('forbidden')`) pass through
 * unchanged; injected ones are `InjectedFault`.
 */

/** Which kind of call a failure rate applies to. */
export type FaultTarget =
  /** First page of a feed (`cursor === null`): the "feed failed to load" state. */
  | 'firstPage'
  /** Any later page: the inline "load more failed" state. */
  | 'nextPage'
  /** Likes, saves, alarms, follows, and other writes: optimistic rollback. */
  | 'interactions'
  /** Everything else (accounts, stories, trending, engagement log, ...). */
  | 'other';

export type Faults = {
  /** Extra delay before every call, in ms. */
  latencyMs: number;
  /** Probability (0 to 1) that a call of each kind throws `InjectedFault`. Missing = 0. */
  failureRate: Readonly<Partial<Record<FaultTarget, number>>>;
  /** Feeds come back with no items and no next page. */
  emptyFeeds: boolean;
  /** Every video in served posts points at a URL that cannot load. */
  brokenVideo: boolean;
};

export const NO_FAULTS: Faults = Object.freeze({ latencyMs: 0, failureRate: Object.freeze({}), emptyFeeds: false, brokenVideo: false });

/** Paged feeds; their last argument is the cursor. */
const FEED_METHODS = new Set<string>(['homeFeed', 'reelsFeed', 'accountPosts'] satisfies (keyof TardyApi)[]);
/** Writes the client applies optimistically (or that the user is waiting on). */
const INTERACTION_METHODS = new Set<string>([
  'setLiked',
  'setSaved',
  'setAlarm',
  'setReposted',
  'setFollowing',
  'setVisibility',
  'sendMessage',
] satisfies (keyof TardyApi)[]);

export const BROKEN_VIDEO_URL = 'https://broken.tardy.invalid/reel.m3u8';

export class InjectedFault extends Error {
  constructor(readonly method: string) {
    super(`Injected fault: ${method}`);
    this.name = 'InjectedFault';
  }
}

export class FaultSwitch {
  private faults: Faults = NO_FAULTS;

  /** `available` is false in production builds; nothing can then enable faults. */
  constructor(readonly available: boolean) {}

  get current(): Faults {
    return this.faults;
  }

  get active(): boolean {
    const f = this.faults;
    return f.latencyMs > 0 || f.emptyFeeds || f.brokenVideo || Object.values(f.failureRate).some((r) => (r ?? 0) > 0);
  }

  /** Replaces the active faults (unspecified fields fall back to off). Throws if unavailable. */
  set(faults: Partial<Faults>): void {
    if (!this.available) throw new Error('Fault injection is dev-only and cannot be enabled in this build.');
    for (const [target, rate] of Object.entries(faults.failureRate ?? {})) {
      if (rate === undefined || !(rate >= 0 && rate <= 1)) throw new RangeError(`failureRate.${target} must be in [0, 1], got ${rate}`);
    }
    if (faults.latencyMs !== undefined && !(faults.latencyMs >= 0)) throw new RangeError(`latencyMs must be >= 0, got ${faults.latencyMs}`);
    this.faults = { ...NO_FAULTS, ...faults };
  }

  reset(): void {
    this.faults = NO_FAULTS;
  }
}

/** The app's switch. Available only in dev builds. */
export const faults = new FaultSwitch(typeof __DEV__ !== 'undefined' && __DEV__);

/** One-tap presets for the dev menu, one per state worth seeing. */
export const FAULT_PRESETS: readonly { label: string; faults: Partial<Faults> }[] = [
  { label: 'Slow network (2.5 s)', faults: { latencyMs: 2500 } },
  { label: 'Feeds fail to load', faults: { latencyMs: 600, failureRate: { firstPage: 1 } } },
  { label: 'Next page fails', faults: { failureRate: { nextPage: 1 } } },
  { label: 'Likes, saves, follows fail', faults: { failureRate: { interactions: 1 } } },
  { label: 'Flaky (30% of everything fails)', faults: { failureRate: { firstPage: 0.3, nextPage: 0.3, interactions: 0.3, other: 0.3 } } },
  { label: 'Empty feeds', faults: { emptyFeeds: true } },
  { label: 'Broken video', faults: { brokenVideo: true } },
];

function classify(method: string, args: unknown[]): FaultTarget {
  if (FEED_METHODS.has(method)) return args[args.length - 1] == null ? 'firstPage' : 'nextPage';
  if (INTERACTION_METHODS.has(method)) return 'interactions';
  return 'other';
}

const isPost = (v: unknown): v is Post =>
  typeof v === 'object' && v !== null && 'authorId' in v && 'caption' in v && Array.isArray((v as Post).media);

const breakPost = (p: Post): Post => ({
  ...p,
  media: p.media.map((m) => (m.type === 'video' ? { ...m, url: BROKEN_VIDEO_URL } : m)),
});

/** Rewrites videos in whatever shape a call returns: a post, a list of posts, or a page. */
function breakVideos(value: unknown): unknown {
  if (isPost(value)) return breakPost(value);
  if (Array.isArray(value)) return value.map(breakVideos);
  if (typeof value === 'object' && value !== null && 'items' in value && Array.isArray((value as Page<unknown>).items)) {
    return { ...value, items: (value as Page<unknown>).items.map(breakVideos) };
  }
  return value;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps `api` so every call consults `faults` first. Returns `api` itself when the switch
 * is unavailable, so production builds run the real object with no indirection.
 * `random` is injectable for deterministic tests.
 */
export function withFaults<T extends TardyApi>(api: T, faults: FaultSwitch, random: () => number = Math.random): T {
  if (!faults.available) return api;
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return async (...args: unknown[]) => {
        const f = faults.current;
        if (f.latencyMs > 0) await sleep(f.latencyMs);
        const kind = classify(prop, args);
        const rate = f.failureRate[kind] ?? 0;
        if (rate > 0 && random() < rate) throw new InjectedFault(prop);
        if (f.emptyFeeds && FEED_METHODS.has(prop)) return { items: [], nextCursor: null } satisfies Page<never>;
        const result: unknown = await value.apply(target, args);
        return f.brokenVideo ? breakVideos(result) : result;
      };
    },
  });
}
