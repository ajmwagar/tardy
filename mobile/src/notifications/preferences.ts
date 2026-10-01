import type { Account, NotificationKind, NotificationOverride, NotificationPreferences, Post } from '@/data/types';

/**
 * Push preference rules. This file is the spec the Rust server mirrors when it decides
 * whether to push; keep it pure (no I/O, no React) so it reads as a rulebook. The client
 * uses it so the mock backend decides like the real one and the settings screen can say
 * what will happen.
 *
 * The rules, most specific first:
 * 1. A default of OFF for a kind is a global mute. Nothing but an explicit project
 *    override can lift it; in particular an alarm cannot.
 * 2. An alarm on a post (`Post.viewerHasAlarm`) is an explicit opt-in to that post's
 *    status changes: for work kinds it notifies even when the post's project override
 *    is off. Alarms say nothing about social kinds.
 * 3. A project override for the kind, when present, decides.
 * 4. Otherwise the default for the kind decides.
 *
 * Privacy is NOT decided here. A push is only ever about something the recipient can
 * see right now; the delivery point checks `src/privacy/policy.ts` before calling this.
 */

/** Every kind, in the order settings lists them. Work first: it's what Tardy is for. */
export const NOTIFICATION_KINDS = [
  'blocked',
  'review_requested',
  'shipped',
  'comment',
  'mention',
  'like',
  'follow',
] as const satisfies readonly NotificationKind[];

/** Work kinds: an agent's post changing status. The ones an alarm opts into. */
export const WORK_KINDS: readonly NotificationKind[] = ['blocked', 'review_requested', 'shipped'];

export const isWorkKind = (kind: NotificationKind) => WORK_KINDS.includes(kind);

/** Defaults for a new user: agent work on, social off. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  defaults: {
    blocked: true,
    review_requested: true,
    shipped: true,
    comment: false,
    mention: false,
    like: false,
    follow: false,
  },
  overrides: [],
};

/** What the decision needs to know about one event, as derived facts. */
export type PushEvent = {
  kind: NotificationKind;
  /** The project the event is about (the post's project, else the agent's), if any. */
  projectId?: string;
  /** The recipient has an alarm set on the post. */
  alarmed: boolean;
};

export type PushDecision =
  | { push: true; because: 'alarm' | 'project_override' | 'default' }
  | { push: false; because: 'muted' | 'project_override' | 'default' };

/**
 * The project an event is about, inferred rather than stored: the post's project, else
 * the actor's (an agent reports to one; a project is its own).
 */
export function eventProjectId(actor: Account, post: Post | undefined): string | undefined {
  if (post?.projectId !== undefined) return post.projectId;
  if (actor.kind === 'agent') return actor.projectId;
  if (actor.kind === 'project') return actor.id;
  return undefined;
}

export function overrideFor(prefs: NotificationPreferences, projectId: string | undefined, kind: NotificationKind) {
  if (projectId === undefined) return undefined;
  return prefs.overrides.find((o) => o.projectId === projectId && o.kind === kind)?.enabled;
}

/**
 * Should `event` be pushed under `prefs`? Fails loud on a kind the preferences don't
 * cover: a server that adds a kind must also add its default.
 */
export function decidePush(prefs: NotificationPreferences, event: PushEvent): PushDecision {
  const fallback = prefs.defaults[event.kind];
  if (typeof fallback !== 'boolean') throw new Error(`Notification preferences have no default for kind ${event.kind}`);
  const override = overrideFor(prefs, event.projectId, event.kind);

  // Rule 1 (with its one exception): global mute.
  if (!fallback && override !== true) return { push: false, because: override === false ? 'project_override' : 'muted' };
  // Rule 2: an alarm opts into this post's status changes.
  if (event.alarmed && isWorkKind(event.kind)) return { push: true, because: 'alarm' };
  // Rule 3.
  if (override !== undefined) return override ? { push: true, because: 'project_override' } : { push: false, because: 'project_override' };
  // Rule 4.
  return { push: true, because: 'default' };
}

/** `prefs` with the default for `kind` set. Pure; the server applies the same edit. */
export function withDefault(prefs: NotificationPreferences, kind: NotificationKind, enabled: boolean): NotificationPreferences {
  return { ...prefs, defaults: { ...prefs.defaults, [kind]: enabled } };
}

/** `prefs` with one (project, kind) override set, or removed when `enabled` is null. */
export function withOverride(
  prefs: NotificationPreferences,
  projectId: string,
  kind: NotificationKind,
  enabled: boolean | null,
): NotificationPreferences {
  const rest = prefs.overrides.filter((o) => !(o.projectId === projectId && o.kind === kind));
  const row: NotificationOverride[] = enabled === null ? [] : [{ projectId, kind, enabled }];
  return { ...prefs, overrides: [...rest, ...row] };
}
