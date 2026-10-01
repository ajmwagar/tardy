import type { Notification, NotificationKind } from '@/data/types';

/**
 * Tray filter chips. `needs_you` is work only a human can unblock (blocked, review requested);
 * `work` is the reason Tardy exists, so it gets its own chip too.
 */
export type TrayFilter = 'needs_you' | 'all' | 'work' | 'mentions';

export const WORK_KINDS: ReadonlySet<NotificationKind> = new Set(['shipped', 'blocked', 'review_requested']);

/** Work notifications that are waiting on a person, not an agent. */
export const NEEDS_YOU_KINDS: ReadonlySet<NotificationKind> = new Set(['blocked', 'review_requested']);

const MATCHES: Record<TrayFilter, (n: Notification) => boolean> = {
  needs_you: (n) => NEEDS_YOU_KINDS.has(n.kind),
  all: () => true,
  work: (n) => WORK_KINDS.has(n.kind),
  mentions: (n) => n.kind === 'mention' || n.kind === 'comment',
};

export type TraySection = { title: 'New' | 'Today' | 'This week' | 'Earlier'; items: Notification[] };

const DAY = 86_400_000;

/**
 * Groups notifications for the tray, newest first: unread ones in "New" (whatever their
 * age, so nothing unread hides in "Earlier"), then read ones bucketed by age. Empty
 * sections are omitted.
 */
export function groupNotifications(list: readonly Notification[], filter: TrayFilter, now = Date.now()): TraySection[] {
  const sorted = list.filter(MATCHES[filter]).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const sections: TraySection[] = [
    { title: 'New', items: [] },
    { title: 'Today', items: [] },
    { title: 'This week', items: [] },
    { title: 'Earlier', items: [] },
  ];
  for (const n of sorted) {
    const age = now - Date.parse(n.createdAt);
    const index = !n.read ? 0 : age < DAY ? 1 : age < 7 * DAY ? 2 : 3;
    sections[index].items.push(n);
  }
  return sections.filter((s) => s.items.length > 0);
}

/** The watermark to send to `markNotificationsRead`: the newest notification's time. */
export function readThrough(list: readonly Notification[]): string | null {
  let newest: string | null = null;
  for (const n of list) if (!newest || Date.parse(n.createdAt) > Date.parse(newest)) newest = n.createdAt;
  return newest;
}
